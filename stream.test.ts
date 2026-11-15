import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { SseDecoder, bridgeSse } from './lib/stream.ts';
import { preflightSse } from './lib/sse-preflight.ts';
import { permanentlyUnavailable } from './lib/provider-errors.ts';
import { waitForDrainOrClose } from './lib/response-flow.ts';

test('SSE decoder handles split UTF-8, CRLF, comments, and multiline data', () => {
  const decoder = new SseDecoder();
  const bytes = new TextEncoder().encode(': ping\r\nevent: message\r\ndata: {"text":"☃"}\r\ndata: tail\r\n\r\n');
  const split = bytes.indexOf(0xe2) + 1;
  assert.deepEqual(decoder.push(bytes.slice(0, split)), []);
  assert.deepEqual(decoder.push(bytes.slice(split)), [{ event: 'message', data: '{"text":"☃"}\ntail', id: null, retry: null }]);
  assert.deepEqual(decoder.finish(), []);
});

test('SSE decoder flushes final unterminated event and ignores malformed extension lines', () => {
  const decoder = new SseDecoder();
  assert.deepEqual(decoder.push(new TextEncoder().encode('x-unknown: ok\ndata: first\rdata: second')), []);
  assert.deepEqual(decoder.finish(), [{ event: null, data: 'first\nsecond', id: null, retry: null }]);
});

test('SSE decoder drops oversized frames and resumes at the next event', () => {
  const decoder = new SseDecoder(8);
  const frames = decoder.push(new TextEncoder().encode(`data: too-large\n\ndata: ok\n\n`));
  assert.deepEqual(frames.map((frame) => frame.data), ['ok']);
});

test('SSE decoder bounds a line that has not reached its newline yet', () => {
  const decoder = new SseDecoder(8);
  assert.deepEqual(decoder.push(new TextEncoder().encode('data: 123456789012345')), []);
  assert.deepEqual(decoder.push(new TextEncoder().encode('still oversized\n\ndata: ok\n\n')).map((frame) => frame.data), ['ok']);
});

test('bridge emits an OpenAI client delta before the upstream completes', async () => {
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}\n\n')); } });
  const iterator = bridgeSse(stream, { wire: 'anthropic', client: 'openai', model: 'm' });
  const first = await iterator.next();
  assert.match(first.value ?? '', /"role":"assistant"/);
  assert.match(first.value ?? '', /"content":"hello"/);
  await iterator.return?.();
});

test('bridge cancels upstream when its consumer returns early', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n')); },
    cancel() { cancelled = true; },
  });
  const iterator = bridgeSse(stream, { wire: 'openai', client: 'anthropic', model: 'm' });
  await iterator.next();
  await iterator.return?.();
  assert.equal(cancelled, true);
});

function source(...frames: string[]): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(frames.join(''));
  return new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
}

test('SSE preflight cancels a provider body whose first frame is an error', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('event: error\ndata: {"error":{"message":"busy"}}\n\n')); },
    cancel() { cancelled = true; },
  });
  const result = await preflightSse(body);
  assert.deepEqual(result, { ok: false, error: 'busy' });
  assert.equal(cancelled, true);
});

test('SSE preflight accepts and replays an OpenAI terminal frame byte for byte', async () => {
  const bytes = new TextEncoder().encode(': keepalive\r\ndata: [DONE]\r\n\r\n');
  const result = await preflightSse(source(new TextDecoder().decode(bytes)));
  assert.equal(result.ok, true);
  if (result.ok) {
    const replayed = await Array.fromAsync(result.stream);
    assert.deepEqual(replayed, [bytes]);
  }
});

function trackedAbortSignal() {
  const controller = new AbortController();
  const signal = controller.signal;
  let listeners = 0;
  const add = signal.addEventListener.bind(signal);
  const remove = signal.removeEventListener.bind(signal);
  signal.addEventListener = ((...args: Parameters<AbortSignal['addEventListener']>) => { listeners += 1; return add(...args); }) as typeof signal.addEventListener;
  signal.removeEventListener = ((...args: Parameters<AbortSignal['removeEventListener']>) => { listeners -= 1; return remove(...args); }) as typeof signal.removeEventListener;
  return { controller, signal, listenerCount: () => listeners };
}

test('SSE preflight keeps abort ownership after handoff and cancels before replay consumption', async () => {
  let cancelled = false;
  const tracked = trackedAbortSignal();
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('data: {"ok":true}\n\n')); },
    cancel() { cancelled = true; },
  });
  const result = await preflightSse(body, tracked.signal);
  assert.equal(tracked.listenerCount(), 1);
  tracked.controller.abort(new Error('disconnect'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelled, true);
  assert.equal(tracked.listenerCount(), 0);
  assert.equal(result.ok, true);
  if (result.ok) {
    const replayed = await Array.fromAsync(result.stream);
    assert.deepEqual(replayed, [new TextEncoder().encode('data: {"ok":true}\n\n')]);
  }
});

test('SSE preflight aborts a replay read waiting on the upstream and cleans up', async () => {
  let cancelled = false;
  let release!: (controller: ReadableStreamDefaultController<Uint8Array>) => void;
  const tracked = trackedAbortSignal();
  const body = new ReadableStream<Uint8Array>({
    start() { release = (next) => next.enqueue(new TextEncoder().encode('data: {"ok":true}\n\n')); },
    pull(controller) { if (cancelled) return; if (release) { const send = release; release = undefined as never; send(controller); } },
    cancel() { cancelled = true; },
  });
  const result = await preflightSse(body, tracked.signal);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const waiting = result.stream.getReader();
  await waiting.read();
  const pending = waiting.read();
  tracked.controller.abort(new Error('disconnect'));
  assert.equal((await pending).done, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelled, true);
  assert.equal(tracked.listenerCount(), 0);
});

test('SSE preflight cleans abort ownership on normal EOF and explicit replay cancel', async () => {
  const trackedEof = trackedAbortSignal();
  const eof = await preflightSse(source('data: {"ok":true}\n\n'), trackedEof.signal);
  assert.equal(eof.ok, true);
  if (eof.ok) {
    const reader = eof.stream.getReader();
    assert.equal((await reader.read()).done, false);
    assert.equal((await reader.read()).done, true);
  }
  assert.equal(trackedEof.listenerCount(), 0);

  let cancelled = false;
  const trackedCancel = trackedAbortSignal();
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('data: {"ok":true}\n\n')); },
    cancel() { cancelled = true; },
  });
  const result = await preflightSse(body, trackedCancel.signal);
  assert.equal(result.ok, true);
  if (result.ok) await result.stream.cancel('stop');
  assert.equal(cancelled, true);
  assert.equal(trackedCancel.listenerCount(), 0);
});

test('SSE preflight rejects event:error with [DONE] but preserves ordinary [DONE]', async () => {
  const error = await preflightSse(source('event: error\ndata: [DONE]\n\n'));
  assert.equal(error.ok, false);
  if (!error.ok) assert.match(error.error, /malformed SSE JSON/);
  const bytes = new TextEncoder().encode('data: [DONE]\n\n');
  const done = await preflightSse(source(new TextDecoder().decode(bytes)));
  assert.equal(done.ok, true);
  if (done.ok) assert.deepEqual(await Array.fromAsync(done.stream), [bytes]);
});

test('SSE preflight extracts string error codes and nested quota metadata', async () => {
  const stringError = await preflightSse(source('data: {"error":"insufficient_quota"}\n\n'));
  assert.deepEqual(stringError, { ok: false, error: 'insufficient_quota', code: 'insufficient_quota' });
  const nested = await preflightSse(source('data: {"error":{"message":"daily credits exhausted","code":"quota_exceeded","status":429}}\n\n'));
  assert.deepEqual(nested, { ok: false, error: 'daily credits exhausted', code: 'quota_exceeded', status: 429 });
  if (!nested.ok) assert.equal(permanentlyUnavailable(nested.status ?? 0, nested.code ?? '', nested.error), true);
});

test('transient SSE preflight errors remain eligible for retry', async () => {
  const result = await preflightSse(source('event: error\ndata: {"error":{"message":"upstream is busy","code":"overloaded"}}\n\n'));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(permanentlyUnavailable(result.status ?? 0, result.code ?? '', result.error), false);
});

test('SSE preflight replays valid provider bytes unchanged', async () => {
  const pieces = [new TextEncoder().encode(': heartbeat\r\nevent: message\r\ndata: {"text":"☃"}\r\n\r\n'), new TextEncoder().encode('data: tail\n\n')];
  const body = new ReadableStream<Uint8Array>({ start(controller) { for (const piece of pieces) controller.enqueue(piece); controller.close(); } });
  const result = await preflightSse(body);
  assert.equal(result.ok, true);
  if (result.ok) {
    const replayed: Uint8Array[] = [];
    for await (const part of result.stream) replayed.push(part);
    assert.deepEqual(replayed, pieces);
  }
});

test('SSE preflight fails over on an empty stream', async () => {
  const result = await preflightSse(new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } }));
  assert.deepEqual(result, { ok: false, error: 'provider stream ended before its first data frame' });
});

test('SSE preflight waits for a split UTF-8 CRLF event before replay', async () => {
  const chunks = [
    new TextEncoder().encode('event: message\r\ndata: {"text":"'),
    new Uint8Array([0xe2, 0x98]),
    new Uint8Array([0x83]),
    new TextEncoder().encode('"}\r'),
    new TextEncoder().encode('\n\r\n'),
  ];
  const body = new ReadableStream<Uint8Array>({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } });
  const result = await preflightSse(body);
  assert.equal(result.ok, true);
  if (result.ok) {
    const replayed: Uint8Array[] = [];
    for await (const part of result.stream) replayed.push(part);
    assert.deepEqual(replayed, chunks);
  }
});

test('provider stream errors become terminal errors in both client protocols', async () => {
  const openAI = await Array.fromAsync(bridgeSse(source('data: {"error":{"message":"bad","code":"upstream_bad"}}\n\n'), { wire: 'gemini', client: 'openai', model: 'm' }));
  assert.match(openAI.join(''), /"error":\{"message":"bad","type":"upstream_bad","code":"upstream_bad"\}/);
  assert.doesNotMatch(openAI.join(''), /finish_reason|\[DONE\]/);

  const anthropic = await Array.fromAsync(bridgeSse(source('event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"try later"}}\n\n'), { wire: 'anthropic', client: 'anthropic', model: 'm' }));
  assert.match(anthropic.join(''), /event: error/);
  assert.match(anthropic.join(''), /"message":"try later"/);
  assert.doesNotMatch(anthropic.join(''), /message_stop/);
});

test('Gemini function calls receive stable OpenAI tool identity and type', async () => {
  const events = await Array.fromAsync(bridgeSse(source('data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"lookup","args":{"q":"x"}}}]}}]}\n\n'), { wire: 'gemini', client: 'openai', model: 'm' }));
  const text = events.join('');
  assert.match(text, /"index":0,"id":"call_0","type":"function"/);
  assert.match(text, /"name":"lookup"/);
  assert.ok(text.includes('"arguments":"{\\"q\\":\\"x\\"}"'));
});

test('Anthropic client closes text before tool and stops each content block once', async () => {
  const events = await Array.fromAsync(bridgeSse(source(
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"call-1","name":"lookup","input":{}}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{}"}}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"call-2","name":"lookup2","input":{}}}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":2}}\n\n',
  ), { wire: 'anthropic', client: 'anthropic', model: 'm' }));
  const text = events.join('');
  assert.ok(text.indexOf('"type":"text_delta"') < text.indexOf('"type":"tool_use"'));
  assert.equal((text.match(/event: content_block_stop/g) ?? []).length, 3);
  assert.ok(text.indexOf('event: content_block_stop') < text.lastIndexOf('"name":"lookup2"'));
  assert.ok(text.indexOf('event: message_delta') < text.indexOf('event: message_stop'));
});

test('backpressure wait distinguishes close from drain and releases both listeners', async () => {
  const response = Object.assign(new EventEmitter(), { destroyed: false, writableEnded: false });
  const closed = waitForDrainOrClose(response as never);
  response.emit('close');
  assert.equal(await closed, false);
  assert.equal(response.listenerCount('drain'), 0);
  assert.equal(response.listenerCount('close'), 0);

  const drained = waitForDrainOrClose(response as never);
  response.emit('drain');
  assert.equal(await drained, true);
  assert.equal(response.listenerCount('drain'), 0);
  assert.equal(response.listenerCount('close'), 0);
});
