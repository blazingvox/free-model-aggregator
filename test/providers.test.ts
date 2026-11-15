import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  authHeaders, buildCatalog, capabilitiesOf, documentsIn, joinBase, meetsRequirements,
  modelFree, probeProvider, readBrief, ratingOfModel,
  type Probe, type ProviderDirectoryEntry, type ProbedModel,
} from '../lib/providers.ts';

function withBrief(text: string, run: (path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'provider-brief-'));
  const path = join(dir, 'brief.txt');
  try { writeFileSync(path, text); run(path); } finally { rmSync(dir, { recursive: true, force: true }); }
}

const provider = (overrides: Partial<ProviderDirectoryEntry> = {}): ProviderDirectoryEntry => ({
  id: 'p', name: 'Provider', wire: 'openai', auth: 'bearer', base: '/p', key_env: 'P_KEY', key: 'secret-key', ...overrides,
});
const model = (overrides: Partial<ProbedModel> = {}): ProbedModel => ({
  id: 'm', display_name: 'Model', free: null, context_length: null, tools: null, vision: null, json: null, ...overrides,
});

test('schema document extraction balances nested objects, ignores quoted braces, and skips malformed or incomplete text', () => {
  const valid = JSON.stringify({ schema: 'one', nested: { text: 'escaped \\" { still text }' } });
  const documents = documentsIn(`prefix {broken: {x: 1}} {"schema": "unfinished" ${valid} {"schema":"later"}`);
  assert.deepEqual(documents.map((doc) => doc.schema), ['one', 'later']);
});

test('brief parsing validates provider rows and normalizes ratings and workload values', () => {
  const text = [
    JSON.stringify({ schema: 'free-model-aggregator-01/providers/v1', providers: [
      { id: 'ok', wire: 'gemini', auth: 'x-goog-api-key', path: '/g' },
      { id: 'bad-auth', wire: 'openai', auth: 'basic', path: '/x' },
      { id: 'bad-base', wire: 'openai', path: '  ' },
      { id: 'abs', wire: 'anthropic', base_url: 'https://local.invalid/root/' },
    ] }),
    JSON.stringify({ schema: 'free-model-aggregator-01/ratings/v1', ratings: [
      { model: 'm', provider: 'ok', rating_milli: 3.5, context_length: 100, tools: true, free: true },
      { model: '', provider: 'ok', rating_milli: 'bad' },
    ], best: [{ id: 'm', rating_milli: 4 }, { id: '' }] }),
    JSON.stringify({ schema: 'free-model-aggregator-01/workload/v1', manifest: [
      { id: 'r', api: 'anthropic', stream: true, weight: 2, requires: { tools: true, min_context: 50 } },
      { id: 'skip' },
    ] }),
  ].join('\n');
  withBrief(text, (path) => {
    const brief = readBrief(path);
    assert.equal(brief.error, null);
    assert.deepEqual(brief.directory.providers.map((p) => p.id), ['ok', 'abs']);
    assert.equal(brief.directory.providers[0].auth, 'x-goog-api-key');
    assert.equal(brief.directory.providers[1].base, 'https://local.invalid/root/');
    assert.deepEqual(brief.ratings?.ratings[0], { model: 'm', provider: 'ok', rating_milli: 3.5, context_length: 100, tools: true, vision: false, json: false, free: true });
    assert.deepEqual(brief.ratings?.best, [{ id: 'm', rating_milli: 4 }]);
    assert.deepEqual(brief.workload?.manifest, [
      { id: 'r', api: 'anthropic', stream: true, weight: 2, requires: { tools: true, vision: false, json: false, min_context: 50 } },
      { id: 'skip', api: 'openai', stream: false, weight: 1, requires: { tools: false, vision: false, json: false } },
    ]);
  });
});

test('base joining and every supported auth scheme preserve their documented wire forms', () => {
  assert.equal(joinBase('http://env///', '/p/a/'), 'http://env/p/a');
  assert.equal(joinBase('http://env/', 'p/a'), 'http://env/p/a');
  assert.equal(joinBase('http://env/', ''), 'http://env');
  assert.equal(joinBase('http://env', 'https://other/root/'), 'https://other/root');
  assert.deepEqual(authHeaders('bearer', 'k'), { authorization: 'Bearer k' });
  assert.deepEqual(authHeaders('x-api-key', 'k'), { 'x-api-key': 'k' });
  assert.deepEqual(authHeaders('x-goog-api-key', 'k'), { 'x-goog-api-key': 'k' });
  assert.deepEqual(authHeaders('none', 'k'), {});
  assert.deepEqual(authHeaders('bearer', ''), {});
});

test('model parsing normalizes all three listing formats, metadata, and zero pricing', async () => {
  const originalFetch = globalThis.fetch;
  const listed: Record<string, unknown>[] = [
    { data: [
      { id: 'oa', name: 'ignored', display_name: 'OpenAI Name', context_length: 4096, free: true, pricing: { prompt: '1' } },
      { id: 'zero', pricing: { prompt: '0', completion: 0 } },
      { id: 'unknown-price', pricing: { prompt: 'n/a' } },
    ] },
    { data: [{ id: 'an', display_name: 'Anthropic Name', context_window: 200000, tools: true, vision: true, json: true, free: false }] },
    { models: [{ name: 'models/gm', displayName: 'Gemini Name', inputTokenLimit: 8192, supportedGenerationMethods: ['generateContent'], pricing: { input: 0, output: 0 } }] },
  ];
  let ix = 0;
  globalThis.fetch = (async () => new Response(JSON.stringify(listed[ix++]), { status: 200 })) as typeof fetch;
  try {
    const open = await probeProvider('http://env', provider(), 1000);
    const anth = await probeProvider('http://env', provider({ wire: 'anthropic', auth: 'x-api-key' }), 1000);
    const gem = await probeProvider('http://env', provider({ wire: 'gemini', auth: 'x-goog-api-key' }), 1000);
    assert.deepEqual(open.models.map((m) => [m.id, m.display_name, m.context_length, m.free]), [
      ['oa', 'OpenAI Name', 4096, true], ['zero', 'zero', null, true], ['unknown-price', 'unknown-price', null, null],
    ]);
    assert.deepEqual(anth.models.map((m) => [m.id, m.display_name, m.context_length, m.free, m.tools, m.vision, m.json]), [['an', 'Anthropic Name', 200000, false, true, true, true]]);
    assert.deepEqual(gem.models.map((m) => [m.id, m.display_name, m.context_length, m.free]), [['gm', 'Gemini Name', 8192, true]]);
  } finally { globalThis.fetch = originalFetch; }
});

test('quality table overrides listing free and capabilities; unknown required capabilities fail closed', () => {
  const listed = model({ free: true, context_length: 1000, tools: true, vision: true, json: true });
  const row = { model: 'm', provider: 'p', rating_milli: 1, context_length: 200, tools: false, vision: false, json: false, free: false };
  assert.equal(modelFree(listed, row), false);
  assert.deepEqual(capabilitiesOf(listed, row), { context_length: 200, tools: false, vision: false, json: false });
  assert.equal(modelFree(model({ free: true }), null), true);
  assert.equal(meetsRequirements({ tools: true }, { context_length: null, tools: null, vision: null, json: null }), false);
  assert.equal(meetsRequirements({ min_context: 1 }, { context_length: null, tools: null, vision: null, json: null }), false);
  assert.equal(meetsRequirements({ min_context: 100 }, capabilitiesOf(listed, null)), true);
  assert.equal(ratingOfModel({ schema: '', ratings: [row], best: [] }, 'p', 'm')?.rating_milli, 1);
});

test('catalog deduplicates model IDs and sorts models deterministically while retaining provider order', () => {
  const makeProbe = (id: string, models: ProbedModel[]): Probe => ({ provider: provider({ id, base: `/${id}` }), ok: true, status: 200, models, error: null });
  const catalog = buildCatalog('', [
    makeProbe('z', [model({ id: 'b', free: true }), model({ id: 'a', free: true }), model({ id: 'b', free: false })]),
    makeProbe('a', [model({ id: 'c', free: true })]),
  ], null);
  assert.deepEqual(catalog.providers.map((p) => p.id), ['z', 'a']);
  assert.deepEqual(catalog.providers[0].models.map((m) => [m.id, m.free]), [['a', true], ['b', true]]);
});

test('probe failures tolerate HTTP and invalid JSON and never echo provider keys', async () => {
  const originalFetch = globalThis.fetch;
  const seen: Array<{ url: string; headers: Headers }> = [];
  globalThis.fetch = (async (input, init) => {
    seen.push({ url: String(input), headers: new Headers(init?.headers) });
    if (seen.length === 1) return new Response('no', { status: 429 });
    if (seen.length === 2) return new Response('{invalid', { status: 200 });
    throw new Error('socket mentioned secret-key while failing');
  }) as typeof fetch;
  try {
    const http = await probeProvider('http://env', provider(), 1000);
    const json = await probeProvider('http://env', provider(), 1000);
    const thrown = await probeProvider('http://env', provider(), 1000);
    assert.equal(http.ok, false); assert.equal(http.status, 429); assert.match(http.error ?? '', /HTTP 429/);
    assert.equal(json.ok, false); assert.equal(json.status, 0);
    assert.equal(thrown.ok, false); assert.doesNotMatch(thrown.error ?? '', /secret-key/); assert.match(thrown.error ?? '', /\[redacted\]/);
    assert.equal(seen[0].url, 'http://env/p/v1/models');
    assert.equal(seen[0].headers.get('authorization'), 'Bearer secret-key');
  } finally { globalThis.fetch = originalFetch; }
});
