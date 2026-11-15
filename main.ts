import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  authHeaders,
  buildCatalog,
  capabilitiesOf,
  isRecord,
  joinBase,
  meetsRequirements,
  modelFree,
  probeProvider,
  ratingOfModel,
  readBrief,
  type CatalogReport,
  type Json,
  type Probe,
  type ProbedModel,
  type Requirement,
} from './lib/providers.ts';
import {
  anthropicError,
  anthropicModelList,
  anthropicToOpenAI,
  openAIError,
  openAIModelList,
  type ServedModel,
} from './lib/wire.ts';
import {
  asAnthropicJson,
  asOpenAIJson,
  normalizeJsonAnswer,
  openAIRequestToAnthropic,
  openAIRequestToGemini,
  type ClientWire,
  type NormalizedAnswer,
  type UpstreamWire,
} from './lib/transforms.ts';
import { bridgeSse } from './lib/stream.ts';
import { preflightSse } from './lib/sse-preflight.ts';
import { permanentlyUnavailable } from './lib/provider-errors.ts';
import { waitForDrainOrClose } from './lib/response-flow.ts';

const PROTOCOL_VERSION = 1;
const POLL_INTERVAL_MS = 100;
const PROBE_TIMEOUT_MS = 5000;
const PROVIDER_TIMEOUT_MS = 15000;
const MAX_BODY_BYTES = 32 * 1024 * 1024;
const ENV_URL = (process.env.MAKEFUN_ENV_URL ?? '').replace(/\/+$/, '');
const PROMPT_FILE = process.env.MAKEFUN_PROMPT_FILE ?? '';
const brief = readBrief(PROMPT_FILE);
let probes: Probe[] = [];
let catalog: CatalogReport = { providers: [] };
let manifestIndex = 0;
const providerAttempts = new Map<string, number>();
const disabledProviders = new Set<string>();

function log(message: string): void {
  process.stderr.write(`aggregator: ${message}\n`);
}

async function load(): Promise<void> {
  if (brief.error !== null) log(brief.error);
  probes = await Promise.all(brief.directory.providers.map((provider) => probeProvider(ENV_URL, provider, PROBE_TIMEOUT_MS)));
  for (const probe of probes) if (!probe.ok && probe.error !== null) log(probe.error);
  catalog = buildCatalog(ENV_URL, probes, brief.ratings);
}

const byId = (a: ProbedModel, b: ProbedModel): number => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

function servedModels(): ServedModel[] {
  const out: ServedModel[] = [];
  const seen = new Set<string>();
  for (const probe of probes) {
    if (!probe.ok) continue;
    for (const model of [...probe.models].sort(byId)) {
      const row = ratingOfModel(brief.ratings, probe.provider.id, model.id);
      if (!modelFree(model, row) || seen.has(model.id)) continue;
      seen.add(model.id);
      out.push({ id: model.id, provider: probe.provider.id, display_name: model.display_name });
    }
  }
  return out;
}

interface Route {
  probe: Probe;
  model: ProbedModel;
  rating: number;
}

function responseFormatRequestsJson(body: Json): boolean {
  if (!isRecord(body.response_format)) return false;
  return body.response_format.type === 'json_object' || body.response_format.type === 'json_schema';
}

/** Filter to legal free models, rank by sealed quality, and balance exact rating ties deterministically. */
function candidatesFor(requires: Requirement, body: Json, client: ClientWire): Route[] {
  const routes: Route[] = [];
  for (const probe of probes) {
    if (!probe.ok || disabledProviders.has(probe.provider.id)) continue;
    // The simulated Anthropic parser cannot carry OpenAI response_format; preserve JSON mode on other wires.
    if (client === 'openai' && responseFormatRequestsJson(body) && probe.provider.wire === 'anthropic') continue;
    for (const model of probe.models) {
      const row = ratingOfModel(brief.ratings, probe.provider.id, model.id);
      if (!modelFree(model, row)) continue;
      if (!meetsRequirements(requires, capabilitiesOf(model, row))) continue;
      routes.push({ probe, model, rating: row?.rating_milli ?? 0 });
    }
  }
  routes.sort((a, b) =>
    b.rating - a.rating ||
    (providerAttempts.get(a.probe.provider.id) ?? 0) - (providerAttempts.get(b.probe.provider.id) ?? 0) ||
    (a.probe.provider.id < b.probe.provider.id ? -1 : a.probe.provider.id > b.probe.provider.id ? 1 : 0) ||
    byId(a.model, b.model),
  );
  return routes;
}

function requirementsFromBody(body: Json): Requirement {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  let vision = false;
  for (const message of messages) {
    if (!isRecord(message) || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (isRecord(block) && (block.type === 'image' || block.type === 'image_url')) vision = true;
    }
  }
  const format = isRecord(body.response_format) ? body.response_format.type : undefined;
  return { tools: Array.isArray(body.tools) && body.tools.length > 0, vision, json: format === 'json_object' || format === 'json_schema' };
}

function requirementsFor(body: Json): Requirement {
  const entry = brief.workload?.manifest[manifestIndex];
  manifestIndex += 1;
  return entry?.requires ?? requirementsFromBody(body);
}

async function readJson(req: IncomingMessage): Promise<Json | null> {
  const declaredLength = req.headers['content-length'];
  if (typeof declaredLength === 'string' && /^\d+$/.test(declaredLength) && Number(declaredLength) > MAX_BODY_BYTES) {
    req.resume();
    return null;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = false;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      tooLarge = true;
      chunks.length = 0;
      continue;
    }
    if (!tooLarge) chunks.push(buffer);
  }
  if (tooLarge || !chunks.length) return null;
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

function sendError(res: ServerResponse, wire: ClientWire, status: number, type: string, message: string): void {
  if (wire === 'anthropic') sendJson(res, status, anthropicError(type, message));
  else sendJson(res, status, openAIError(message, type, null));
}

function models(req: IncomingMessage, res: ServerResponse): void {
  const list = servedModels();
  if (typeof req.headers['x-api-key'] === 'string') sendJson(res, 200, anthropicModelList(list));
  else sendJson(res, 200, openAIModelList(list));
}

function pathFor(route: Route, stream: boolean): string {
  const base = joinBase(ENV_URL, route.probe.provider.base);
  if (route.probe.provider.wire === 'gemini') {
    const operation = stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
    return `${base}/v1beta/models/${encodeURIComponent(route.model.id)}:${operation}`;
  }
  return `${base}${route.probe.provider.wire === 'anthropic' ? '/v1/messages' : '/v1/chat/completions'}`;
}

function upstreamBody(route: Route, body: Json, client: ClientWire): Json {
  const wire = route.probe.provider.wire;
  if (client === 'anthropic' && wire === 'anthropic') return { ...body, model: route.model.id };
  if (client === 'openai') {
    if (wire === 'openai') {
      const out: Json = { ...body, model: route.model.id };
      if (body.stream === true) out.stream_options = { ...(isRecord(body.stream_options) ? body.stream_options : {}), include_usage: true };
      return out;
    }
    if (wire === 'anthropic') return openAIRequestToAnthropic(body, route.model.id);
    return openAIRequestToGemini(body, route.model.id);
  }
  const canonical = anthropicToOpenAI(body, route.model.id);
  if (wire === 'openai') {
    if (canonical.stream === true) canonical.stream_options = { include_usage: true };
    return canonical;
  }
  if (wire === 'anthropic') return openAIRequestToAnthropic(canonical, route.model.id);
  return openAIRequestToGemini(canonical, route.model.id);
}

async function callProvider(route: Route, body: Json, stream: boolean, signal?: AbortSignal): Promise<Response> {
  const wire = route.probe.provider.wire;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...authHeaders(route.probe.provider.auth, route.probe.provider.key),
  };
  if (wire === 'anthropic') headers['anthropic-version'] = '2023-06-01';
  if (stream) headers.accept = 'text/event-stream';
  return fetch(pathFor(route, stream), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(PROVIDER_TIMEOUT_MS)]) : AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
}

function upstreamErrorText(body: string, wire: UpstreamWire): { code: string; message: string } {
  try {
    const parsed: unknown = JSON.parse(body);
    if (!isRecord(parsed)) return { code: '', message: body };
    if (wire === 'openai') {
      const err = isRecord(parsed.error) ? parsed.error : {};
      return { code: typeof err.code === 'string' ? err.code : '', message: typeof err.message === 'string' ? err.message : body };
    }
    if (wire === 'anthropic') {
      const err = isRecord(parsed.error) ? parsed.error : {};
      return { code: typeof err.type === 'string' ? err.type : '', message: typeof err.message === 'string' ? err.message : body };
    }
    const err = isRecord(parsed.error) ? parsed.error : {};
    return { code: typeof err.status === 'string' ? err.status : '', message: typeof err.message === 'string' ? err.message : body };
  } catch {
    return { code: '', message: body };
  }
}

type RequestAnswer = { answer: NormalizedAnswer; stream: false; requestedModel: string } | { stream: true; upstream: ReadableStream<Uint8Array>; wire: UpstreamWire; requestedModel: string; model: string } | { errorStatus: number; error: string };

async function answerRequest(body: Json, client: ClientWire, requires: Requirement, signal?: AbortSignal): Promise<RequestAnswer> {
  const stream = body.stream === true;
  const requestedModel = typeof body.model === 'string' && body.model !== '' ? body.model : 'auto';
  const routes = candidatesFor(requires, body, client);
  const attemptedThisRequest = new Set<string>();
  let lastError = 'no free model on the directory meets this request';
  for (const route of routes) {
    const providerId = route.probe.provider.id;
    if (attemptedThisRequest.has(providerId)) continue;
    attemptedThisRequest.add(providerId);
    providerAttempts.set(providerId, (providerAttempts.get(providerId) ?? 0) + 1);
    const wire = route.probe.provider.wire as UpstreamWire;
    try {
      const request = upstreamBody(route, body, client);
      const upstream = await callProvider(route, request, stream, signal);
      if (!upstream.ok) {
        const text = await upstream.text();
        const detail = upstreamErrorText(text, wire);
        lastError = `${providerId} returned HTTP ${upstream.status}: ${detail.message.slice(0, 300)}`;
        if (permanentlyUnavailable(upstream.status, detail.code, detail.message)) disabledProviders.add(providerId);
        continue;
      }
      if (stream) {
        if (upstream.body === null) {
          lastError = `${providerId} returned an empty streaming body`;
          continue;
        }
        const checked = await preflightSse(upstream.body, signal);
        if (!checked.ok) {
          lastError = `${providerId} returned an invalid stream: ${checked.error}`;
          if (permanentlyUnavailable(checked.status ?? 0, checked.code ?? '', checked.error)) disabledProviders.add(providerId);
          if (signal?.aborted) break;
          continue;
        }
        return { stream: true, upstream: checked.stream, wire, requestedModel, model: route.model.id };
      }
      const raw: unknown = await upstream.json();
      if (!isRecord(raw)) {
        lastError = `${providerId} returned a non-object JSON response`;
        continue;
      }
      return { answer: normalizeJsonAnswer(wire, raw, route.model.id), stream: false, requestedModel };
    } catch (err) {
      lastError = `${providerId} failed: ${(err as Error).message}`;
      if (signal?.aborted) break;
    }
  }
  return { errorStatus: 503, error: lastError };
}

async function handleGeneration(req: IncomingMessage, res: ServerResponse, client: ClientWire): Promise<void> {
  const body = await readJson(req);
  if (body === null) return sendError(res, client, 400, 'invalid_request_error', 'the request body is not one JSON object');
  const disconnect = new AbortController();
  const onClose = () => { if (!res.writableEnded) disconnect.abort(new Error('client disconnected')); };
  res.once('close', onClose);
  const result = await answerRequest(body, client, requirementsFor(body), disconnect.signal);
  if (disconnect.signal.aborted || res.destroyed) {
    if ('stream' in result && result.stream) await result.upstream.cancel(new Error('client disconnected before stream handoff')).catch(() => {});
    res.off('close', onClose);
    return;
  }
  if ('error' in result) {
    res.off('close', onClose);
    return sendError(res, client, result.errorStatus, client === 'anthropic' ? 'overloaded_error' : 'no_free_model', result.error);
  }
  if (result.stream) {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
    try {
      for await (const event of bridgeSse(result.upstream, { wire: result.wire, client, model: client === 'anthropic' ? result.requestedModel : result.model })) {
        if (disconnect.signal.aborted || res.destroyed) break;
        if (!res.write(event) && !await waitForDrainOrClose(res)) break;
      }
      if (!res.destroyed) res.end();
    } catch (error) {
      if (!res.destroyed) res.destroy(error as Error);
    } finally {
      res.off('close', onClose);
    }
    return;
  }
  res.off('close', onClose);
  sendJson(res, 200, client === 'openai' ? asOpenAIJson(result.answer) : asAnthropicJson(result.answer, result.requestedModel));
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://entry');
  if (req.method === 'GET' && url.pathname === '/v1/models') return models(req, res);
  if (req.method === 'POST' && url.pathname === '/v1/chat/completions') return handleGeneration(req, res, 'openai');
  if (req.method === 'POST' && url.pathname === '/v1/messages') return handleGeneration(req, res, 'anthropic');
  sendError(res, url.pathname === '/v1/messages' ? 'anthropic' : 'openai', 404, 'not_found', `no route ${req.method ?? ''} ${url.pathname}`);
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '0.0.0.0', () => resolve());
  });
}

async function register(port: number, report: CatalogReport): Promise<void> {
  const response = await fetch(`${ENV_URL}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ protocol_version: PROTOCOL_VERSION, port, catalog: report }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`POST ${ENV_URL}/register answered HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const reply: unknown = await response.json();
  if (isRecord(reply) && typeof reply.requests === 'number') log(`registered: ${reply.requests} requests`);
}

function poll(server: Server): void {
  let inFlight = false;
  const timer = setInterval(() => {
    if (inFlight) return;
    inFlight = true;
    void (async () => {
      try {
        const response = await fetch(`${ENV_URL}/work`, { signal: AbortSignal.timeout(2000) });
        if (response.status === 200) {
          const work: unknown = await response.json();
          if (isRecord(work) && work.done === true) {
            clearInterval(timer);
            server.close();
            process.exit(0);
          }
        }
      } catch {
        // A failed poll is harmless; the next deterministic tick retries.
      } finally {
        inFlight = false;
      }
    })();
  }, POLL_INTERVAL_MS);
}

async function start(): Promise<void> {
  await load();
  if (process.argv.includes('--list')) {
    const text = `${JSON.stringify(catalog)}\n`;
    await new Promise<void>((resolve) => process.stdout.write(text, () => resolve()));
    process.exit(0);
  }
  if (ENV_URL === '') throw new Error('MAKEFUN_ENV_URL is not set');
  const server = createServer((req, res) => {
    void handle(req, res).catch((err: unknown) => {
      log((err as Error).stack ?? String(err));
      if (!res.headersSent) sendError(res, req.url?.startsWith('/v1/messages') === true ? 'anthropic' : 'openai', 500, 'internal_error', 'the server failed to answer');
      else res.end();
    });
  });
  await listen(server);
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('the server has no port');
  if (address.port === 8080) throw new Error('the OS picked 8080, which the env owns on one layout: restart the trial');
  log(`listening on 0.0.0.0:${address.port} with ${catalog.providers.length} providers and ${servedModels().length} free models`);
  await register(address.port, catalog);
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));
  poll(server);
}

try {
  await start();
} catch (err) {
  log((err as Error).stack ?? String(err));
  process.exit(1);
}
