import test from 'node:test';
import assert from 'node:assert/strict';
import {
  asAnthropicJson,
  asAnthropicSse,
  asOpenAIJson,
  asOpenAISse,
  normalizeJsonAnswer,
  normalizeStreamAnswer,
  openAIRequestToAnthropic,
  openAIRequestToGemini,
  parseSseFrames,
} from './lib/transforms.ts';
import type { Json } from './lib/providers.ts';

const MODEL = 'fixture-model';

test('SSE parser follows field syntax, ignores comments, and dispatches a final frame', () => {
  const parsed = parseSseFrames('\uFEFF:keepalive\r\nevent: update\r\ndata: first\r\ndata\r\ndata: third\r\nunknown: ignored\r\n\r\ndata: [DONE]');
  assert.deepEqual(parsed, [
    { event: 'update', data: 'first\n\nthird' },
    { event: null, data: '[DONE]' },
  ]);
});

test('JSON normalization preserves tool calls, stop reasons, and usage on every upstream wire', () => {
  const inputs: Array<{ wire: 'openai' | 'anthropic' | 'gemini'; body: Json; expectedStop: string }> = [
    { wire: 'openai', body: { id: 'oa-1', choices: [{ message: { content: 'answer', tool_calls: [{ id: 'call-a', function: { name: 'lookup', arguments: '{"q":"x"}' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 11, completion_tokens: 4 } }, expectedStop: 'tool_calls' },
    { wire: 'anthropic', body: { id: 'msg-1', content: [{ type: 'text', text: 'answer' }, { type: 'tool_use', id: 'call-a', name: 'lookup', input: { q: 'x' } }], stop_reason: 'tool_use', usage: { input_tokens: 11, output_tokens: 4 } }, expectedStop: 'tool_calls' },
    { wire: 'gemini', body: { responseId: 'gm-1', candidates: [{ content: { parts: [{ text: 'answer' }, { functionCall: { name: 'lookup', args: { q: 'x' } } }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 4 } }, expectedStop: 'stop' },
  ];
  for (const input of inputs) {
    const answer = normalizeJsonAnswer(input.wire, input.body, MODEL);
    assert.equal(answer.text, 'answer', input.wire);
    assert.deepEqual(answer.toolCalls[0], { id: input.wire === 'gemini' ? 'call_0' : 'call-a', name: 'lookup', arguments: { q: 'x' } }, input.wire);
    assert.equal(answer.finishReason, input.expectedStop, input.wire);
    assert.equal(answer.promptTokens, 11, input.wire);
    assert.equal(answer.completionTokens, 4, input.wire);
  }

  const openAI = asOpenAIJson(normalizeJsonAnswer('anthropic', inputs[1].body, MODEL));
  assert.equal((openAI.choices as Json[])[0].finish_reason, 'tool_calls');
  assert.equal((openAI.usage as Json).total_tokens, 15);
  const anthropic = asAnthropicJson(normalizeJsonAnswer('openai', inputs[0].body, MODEL), 'client-model');
  assert.equal(anthropic.stop_reason, 'tool_use');
  assert.equal((anthropic.usage as Json).output_tokens, 4);
});

test('SSE normalization handles OpenAI deltas, Anthropic events, and Gemini chunks', () => {
  const streams: Array<{ wire: 'openai' | 'anthropic' | 'gemini'; body: string; stop: string }> = [
    { wire: 'openai', body: [
      'data: {"id":"s-oa","choices":[{"delta":{"content":"ans"}}]}',
      'data: {"choices":[{"delta":{"content":"wer"}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-s","function":{"name":"lookup","arguments":"{\\"q\\":"}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"x\\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":11,"completion_tokens":4}}',
      'data: [DONE]',
    ].join('\n\n'), stop: 'tool_calls' },
    { wire: 'anthropic', body: [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"s-an","usage":{"input_tokens":11}}}',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"answer"}}',
      'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"call-s","name":"lookup","input":{}}}',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"q\\":\\"x\\"}"}}',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":4}}',
      'event: message_stop\ndata: {"type":"message_stop"}',
    ].join('\n\n'), stop: 'tool_calls' },
    { wire: 'gemini', body: [
      'data: {"responseId":"s-gm","candidates":[{"content":{"parts":[{"text":"answer"}]}}]}',
      'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"lookup","args":{"q":"x"}}}]},"finishReason":"MAX_TOKENS"}],"usageMetadata":{"promptTokenCount":11,"candidatesTokenCount":4}}',
    ].join('\n\n'), stop: 'length' },
  ];
  for (const stream of streams) {
    const answer = normalizeStreamAnswer(stream.wire, stream.body, MODEL);
    assert.equal(answer.text, 'answer', stream.wire);
    assert.equal(answer.toolCalls[0]?.name, 'lookup', stream.wire);
    assert.deepEqual(answer.toolCalls[0]?.arguments, { q: 'x' }, stream.wire);
    assert.equal(answer.finishReason, stream.stop, stream.wire);
    assert.equal(answer.promptTokens, 11, stream.wire);
    assert.equal(answer.completionTokens, 4, stream.wire);
  }
});

test('client SSE serializers emit terminal events and retain tool and usage data', () => {
  const answer = normalizeJsonAnswer('anthropic', { id: 'msg-1', content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 'c1', name: 'lookup', input: { q: 1 } }], stop_reason: 'max_tokens', usage: { input_tokens: 3, output_tokens: 2 } }, MODEL);
  const openAI = asOpenAISse(answer);
  assert.match(openAI, /"finish_reason":"length"/);
  assert.match(openAI, /"total_tokens":5/);
  assert.match(openAI, /data: \[DONE\]/);
  const anthropic = asAnthropicSse(answer, 'requested-model');
  assert.match(anthropic, /"stop_reason":"max_tokens"/);
  assert.match(anthropic, /"output_tokens":2/);
  assert.match(anthropic, /"name":"lookup"/);
});

test('request transforms retain prior messages, tool definitions, and JSON response settings', () => {
  const request: Json = {
    messages: [
      { role: 'system', content: 'rules' },
      { role: 'user', content: 'find' },
      { role: 'assistant', tool_calls: [{ id: 'c1', function: { name: 'lookup', arguments: '{"q":1}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: 'found' },
    ],
    tools: [{ type: 'function', function: { name: 'lookup', parameters: { type: 'object' } } }],
    tool_choice: 'required', response_format: { type: 'json_object' }, max_tokens: 24, stream: true,
  };
  const anthropic = openAIRequestToAnthropic(request, MODEL);
  assert.equal(anthropic.system, 'rules');
  assert.equal((anthropic.messages as Json[]).length, 3);
  assert.deepEqual(anthropic.tool_choice, { type: 'any' });
  const gemini = openAIRequestToGemini(request, MODEL);
  assert.equal((gemini.generationConfig as Json).responseMimeType, 'application/json');
  assert.deepEqual(gemini.toolConfig, { functionCallingConfig: { mode: 'ANY' } });
  assert.equal((gemini.tools as Json[]).length, 1);
});
