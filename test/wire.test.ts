import test from 'node:test';
import assert from 'node:assert/strict';
import { anthropicToOpenAI, geminiToOpenAI, openAIToGemini, openAIToAnthropic, stopReasonOf, nativeAnthropicToOpenAI, openAIToNativeAnthropic, openAIEventsFromCompletion, collectVendorStream, collectOpenAIStream, anthropicEventsFromOpenAI } from '../lib/wire.ts';

test('Anthropic histories preserve system, tools, image and tool results', () => {
  const x = anthropicToOpenAI({ system: 'rules', max_tokens: 40, messages: [{ role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'lookup', input: { q: 'x' } }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'found' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'YQ==' } }] }], tools: [{ name: 'lookup', input_schema: { type: 'object' } }] }, 'm');
  assert.equal(x.model, 'm'); assert.equal((x.messages as any[])[0].role, 'system');
  assert.equal((x.messages as any[])[1].tool_calls[0].id, 'c1');
  assert.equal((x.messages as any[])[2].tool_call_id, 'c1');
  assert.equal((x.messages as any[])[3].content[0].image_url.url, 'data:image/png;base64,YQ==');
});

test('Gemini request and response wires map generation, tools, usage and finish reasons', () => {
  const req = openAIToGemini({ messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'hello' }], max_tokens: 23, response_format: { type: 'json_object' }, tools: [{ type: 'function', function: { name: 'f', parameters: { type: 'object' } } }] });
  assert.equal((req.generationConfig as any).maxOutputTokens, 23);
  assert.equal((req.generationConfig as any).responseMimeType, 'application/json');
  assert.equal((req.tools as any[])[0].functionDeclarations[0].name, 'f');
  const out = geminiToOpenAI({ candidates: [{ content: { parts: [{ text: 'ok' }, { functionCall: { name: 'f', args: { a: 1 } } }] }, finishReason: 'MAX_TOKENS' }], usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2 } }, 'm');
  assert.equal((out.choices as any[])[0].finish_reason, 'length'); assert.equal((out.usage as any).prompt_tokens, 4);
  assert.equal(stopReasonOf('tool_calls'), 'tool_use');
});

test('OpenAI tool result and stop reason conversion', () => {
  const out = openAIToAnthropic({ choices: [{ message: { content: 'done', tool_calls: [{ id: 'c', function: { name: 'f', arguments: '{"x":1}' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 7, completion_tokens: 3 } }, 'm');
  assert.equal((out.content as any[])[1].input.x, 1); assert.equal(out.stop_reason, 'tool_use');
});

test('Gemini cross-wire tool history pairs function responses with their declared function name', () => {
  const out = openAIToGemini({ messages: [
    { role: 'assistant', tool_calls: [{ id: 'call-id', function: { name: 'lookup', arguments: '{"q":"x"}' } }] },
    { role: 'tool', tool_call_id: 'call-id', content: '{"value":1}' },
  ] });
  const contents = (out.contents as any[]);
  assert.equal(contents[0].role, 'model'); assert.equal(contents[0].parts[0].functionCall.name, 'lookup');
  assert.equal(contents[1].parts.find((p: any) => p.functionResponse)?.functionResponse.name, 'lookup');
});

test('OpenAI to Anthropic upstream conversion retains system, limits, JSON, tools, images and tool history', () => {
  const body = openAIToNativeAnthropic({ max_tokens: 77, stop: ['END'], response_format: { type: 'json_object' }, messages: [
    { role: 'system', content: 'obey this system prompt' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'c1', function: { name: 'lookup', arguments: '{"q":1}' } }] },
    { role: 'tool', tool_call_id: 'c1', content: 'result' },
    { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,YQ==' } }] },
  ], tools: [{ type: 'function', function: { name: 'lookup', description: 'find', parameters: { type: 'object' } } }] }, 'm');
  assert.equal(body.model, 'm'); assert.equal(body.max_tokens, 77); assert.equal((body as any).system, 'obey this system prompt');
  assert.deepEqual((body as any).stop_sequences, ['END']);
  assert.equal((body as any).messages[0].content[0].type, 'tool_use');
  assert.equal((body as any).messages[1].content[0].type, 'tool_result');
  assert.equal((body as any).messages[2].content[0].source.media_type, 'image/png');
  assert.equal((body as any).tools[0].input_schema.type, 'object');
});

test('Anthropic response normalization keeps tool calls, usage, and stop mapping', () => {
  const out = nativeAnthropicToOpenAI({ id: 'msg1', content: [{ type: 'text', text: 'x' }, { type: 'tool_use', id: 'c', name: 'f', input: { a: 1 } }], stop_reason: 'tool_use', usage: { input_tokens: 11, output_tokens: 5 } }, 'm');
  const choice = (out.choices as any[])[0];
  assert.equal(choice.finish_reason, 'tool_calls'); assert.deepEqual(choice.message.tool_calls[0].function, { name: 'f', arguments: '{"a":1}' });
  assert.deepEqual(out.usage, { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 });
});

test('normalized completion emits ordered OpenAI SSE frames including streamed tool deltas and usage', () => {
  const frames = [...openAIEventsFromCompletion({ id: 'x', model: 'm', choices: [{ message: { role: 'assistant', content: 'ok', tool_calls: [{ id: 'c', type: 'function', function: { name: 'f', arguments: '{"a":1}' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 3, completion_tokens: 2 } })];
  assert.match(frames[0], /"role":"assistant"/); assert.ok(frames.some((f) => f.includes('"arguments":"{\\"a\\":1}"')));
  assert.ok(frames.some((f) => f.includes('"finish_reason":"tool_calls"'))); assert.ok(frames.some((f) => f.includes('"usage":{"prompt_tokens":3')));
  assert.equal(frames.at(-1), 'data: [DONE]\n\n');
});

test('Anthropic upstream SSE is reassembled across split frames with tool input, stop, and usage', async () => {
  const text = [
    'event: message_start\ndata: {"type":"message_start","message":{"id":"m","usage":{"input_tokens":9}}}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"c","name":"f","input":{}}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"x\\":1}"}}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":2}}\n\n',
  ].join('');
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes.slice(0, 65)); c.enqueue(bytes.slice(65)); c.close(); } });
  const out = await collectVendorStream(stream, 'anthropic');
  assert.equal((out.content as any[])[0].input.x, 1); assert.equal(out.stop_reason, 'tool_use');
  assert.deepEqual(out.usage, { input_tokens: 9, output_tokens: 2 });
});

test('Gemini upstream SSE chunks combine text and function calls with final usage', async () => {
  const data = [
    'data: {"candidates":[{"content":{"parts":[{"text":"hi"}]}}]}\n\n',
    'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"f","args":{"x":1}}}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":4,"candidatesTokenCount":3}}\n\n',
  ].join('');
  const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(data)); c.close(); } });
  const out = geminiToOpenAI(await collectVendorStream(stream, 'gemini'), 'm');
  const message = (out.choices as any[])[0].message;
  assert.equal(message.content, 'hi'); assert.equal(JSON.parse(message.tool_calls[0].function.arguments).x, 1);
  assert.deepEqual(out.usage, { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 });
});

test('OpenAI SSE aggregation restores accurate usage for Anthropic client streams', async () => {
  const data = [
    'data: {"id":"c","model":"m","choices":[{"delta":{"content":"hello"},"finish_reason":null}]}\n\n',
    'data: {"id":"c","model":"m","choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
    'data: {"id":"c","model":"m","choices":[],"usage":{"prompt_tokens":12,"completion_tokens":4,"total_tokens":16}}\n\n',
    'data: [DONE]\n\n',
  ].join('');
  const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(data)); c.close(); } });
  const out = await collectOpenAIStream(stream);
  assert.equal((out.choices as any[])[0].message.content, 'hello'); assert.deepEqual(out.usage, { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 });
  const converted: string[] = [];
  const encoder = new TextEncoder();
  for await (const event of anthropicEventsFromOpenAI(new ReadableStream({ start(c) { for (const x of openAIEventsFromCompletion(out)) c.enqueue(encoder.encode(x)); c.close(); } }), 'm', (out.usage as any).prompt_tokens)) converted.push(event);
  const start = JSON.parse(converted[0].split('data: ')[1]);
  assert.equal(start.message.usage.input_tokens, 12);
});

test('Anthropic SSE parser handles UTF-8, CRLF and frames split across chunks with ordered tool events', async () => {
  const enc = new TextEncoder();
  const frames = [
    'data: {"choices":[{"delta":{"content":"hé"},"finish_reason":null}]}\r\n\r\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"f","arguments":"{\\"x\\":"}}]},"finish_reason":null}]}\r\n\r\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]},"finish_reason":"tool_calls"}]}\r\n\r\n',
    'data: {"choices":[],"usage":{"prompt_tokens":8,"completion_tokens":2}}\r\n\r\n', 'data: [DONE]\r\n\r\n',
  ].join('');
  const bytes = enc.encode(frames);
  const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes.slice(0, 43)); c.enqueue(bytes.slice(43, 121)); c.enqueue(bytes.slice(121)); c.close(); } });
  const events: string[] = [];
  for await (const e of (await import('../lib/wire.ts')).anthropicEventsFromOpenAI(stream, 'model')) events.push(e);
  const names = events.map((e) => e.match(/^event: ([^\n]+)/)?.[1]).filter(Boolean);
  assert.equal(names[0], 'message_start'); assert.ok(names.indexOf('content_block_start') < names.indexOf('content_block_delta'));
  assert.equal(names.at(-2), 'message_delta'); assert.equal(names.at(-1), 'message_stop');
  assert.ok(events.join('').includes('hé')); assert.ok(events.join('').includes('"output_tokens":2'));
});
