import { isRecord, type Json } from './providers.ts';

export type UpstreamWire = 'openai' | 'anthropic' | 'gemini';
export type ClientWire = 'openai' | 'anthropic';

export interface ToolCall {
  id: string;
  name: string;
  arguments: Json;
}

export interface NormalizedAnswer {
  id: string;
  model: string;
  text: string;
  toolCalls: ToolCall[];
  finishReason: string;
  promptTokens: number;
  completionTokens: number;
}

const record = (value: unknown): Json => isRecord(value) ? value : {};
const string = (value: unknown, fallback = ''): string => typeof value === 'string' ? value : fallback;
const number = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : 0;

function blocksText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.flatMap((part) => isRecord(part) && part.type === 'text' && typeof part.text === 'string' ? [part.text] : []).join('\n');
}

function jsonObject(value: unknown): Json {
  if (isRecord(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function parseDataUrl(value: string): { media: string; data: string } | null {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(value);
  if (!m || m[2] !== ';base64') return null;
  return { media: m[1] || 'image/png', data: m[3] };
}

function anthropicImageFromOpenAI(url: string): Json | null {
  const data = parseDataUrl(url);
  if (data) return { type: 'image', source: { type: 'base64', media_type: data.media, data: data.data } };
  if (/^https?:\/\//i.test(url)) return { type: 'image', source: { type: 'url', url } };
  return null;
}

function anthropicContentFromOpenAI(content: unknown): unknown {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const out: Json[] = [];
  for (const raw of content) {
    if (!isRecord(raw)) continue;
    if (raw.type === 'text' && typeof raw.text === 'string') out.push({ type: 'text', text: raw.text });
    else if (raw.type === 'image_url' && isRecord(raw.image_url) && typeof raw.image_url.url === 'string') {
      const image = anthropicImageFromOpenAI(raw.image_url.url);
      if (image) out.push(image);
    }
  }
  return out;
}

/** Translate OpenAI Chat Completions input to the Anthropic Messages wire. */
export function openAIRequestToAnthropic(body: Json, model: string): Json {
  const source = Array.isArray(body.messages) ? body.messages.filter(isRecord) : [];
  const systemParts: string[] = [];
  const messages: Json[] = [];
  for (const message of source) {
    const role = string(message.role);
    if (role === 'system' || role === 'developer') {
      const t = blocksText(message.content);
      if (t !== '') systemParts.push(t);
      continue;
    }
    if (role === 'tool' || role === 'function') {
      const result: Json = {
        type: 'tool_result',
        tool_use_id: string(message.tool_call_id, string(message.name)),
        content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? ''),
      };
      const previous = messages[messages.length - 1];
      if (previous && previous.role === 'user' && Array.isArray(previous.content) && previous.content.some((x) => isRecord(x) && x.type === 'tool_result')) {
        (previous.content as Json[]).push(result);
      } else messages.push({ role: 'user', content: [result] });
      continue;
    }
    if (role === 'assistant') {
      const content: Json[] = [];
      const text = blocksText(message.content);
      if (text !== '') content.push({ type: 'text', text });
      if (Array.isArray(message.tool_calls)) {
        for (const raw of message.tool_calls) {
          if (!isRecord(raw)) continue;
          const fn = record(raw.function);
          content.push({
            type: 'tool_use',
            id: string(raw.id, `call_${content.length}`),
            name: string(fn.name),
            input: jsonObject(fn.arguments),
          });
        }
      }
      messages.push({ role: 'assistant', content: content.length === 1 && content[0].type === 'text' ? (content[0] as Json).text : content });
      continue;
    }
    if (role === 'user') messages.push({ role: 'user', content: anthropicContentFromOpenAI(message.content) });
  }

  const out: Json = { model, max_tokens: number(body.max_tokens) || number(body.max_completion_tokens) || 1024, messages };
  if (systemParts.length > 0) out.system = systemParts.join('\n');
  if (typeof body.temperature === 'number') out.temperature = body.temperature;
  if (typeof body.top_p === 'number') out.top_p = body.top_p;
  if (Array.isArray(body.stop) && body.stop.length > 0) out.stop_sequences = body.stop;
  if (Array.isArray(body.tools)) {
    const tools = body.tools.flatMap((raw) => {
      if (!isRecord(raw)) return [];
      const fn = record(raw.function);
      if (typeof fn.name !== 'string') return [];
      return [{ name: fn.name, description: string(fn.description), input_schema: isRecord(fn.parameters) ? fn.parameters : { type: 'object', properties: {} } }];
    });
    if (tools.length) out.tools = tools;
  }
  const choice = body.tool_choice;
  if (choice === 'auto' || choice === undefined) out.tool_choice = { type: 'auto' };
  else if (choice === 'required') out.tool_choice = { type: 'any' };
  else if (isRecord(choice)) {
    const fn = record(choice.function);
    if (typeof fn.name === 'string') out.tool_choice = { type: 'tool', name: fn.name };
  }
  if (body.stream === true) out.stream = true;
  return out;
}

function geminiPartsFromOpenAI(content: unknown): Json[] {
  if (typeof content === 'string') return content === '' ? [] : [{ text: content }];
  if (!Array.isArray(content)) return [];
  const parts: Json[] = [];
  for (const raw of content) {
    if (!isRecord(raw)) continue;
    if (raw.type === 'text' && typeof raw.text === 'string') parts.push({ text: raw.text });
    else if (raw.type === 'image_url' && isRecord(raw.image_url) && typeof raw.image_url.url === 'string') {
      const url = raw.image_url.url;
      const parsed = parseDataUrl(url);
      if (parsed) parts.push({ inlineData: { mimeType: parsed.media, data: parsed.data } });
      else if (/^https?:\/\//i.test(url)) parts.push({ fileData: { mimeType: 'image/*', fileUri: url } });
    }
  }
  return parts;
}

/** Translate OpenAI Chat Completions input to Gemini generateContent. */
export function openAIRequestToGemini(body: Json, model: string): Json {
  const messages = Array.isArray(body.messages) ? body.messages.filter(isRecord) : [];
  const systemParts: Json[] = [];
  const contents: Json[] = [];
  for (const message of messages) {
    const role = string(message.role);
    if (role === 'system' || role === 'developer') {
      const text = blocksText(message.content);
      if (text !== '') systemParts.push({ text });
    } else if (role === 'assistant') {
      const parts = geminiPartsFromOpenAI(message.content);
      if (Array.isArray(message.tool_calls)) {
        for (const raw of message.tool_calls) {
          if (!isRecord(raw)) continue;
          const fn = record(raw.function);
          parts.push({ functionCall: { name: string(fn.name), args: jsonObject(fn.arguments) } });
        }
      }
      contents.push({ role: 'model', parts: parts.length ? parts : [{ text: '' }] });
    } else if (role === 'tool' || role === 'function') {
      contents.push({ role: 'user', parts: [{ functionResponse: { name: string(message.name, string(message.tool_call_id, 'tool')), response: { content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? '') } } }] });
    } else if (role === 'user') {
      contents.push({ role: 'user', parts: geminiPartsFromOpenAI(message.content) });
    }
  }
  const config: Json = {};
  const max = number(body.max_tokens) || number(body.max_completion_tokens);
  if (max) config.maxOutputTokens = max;
  if (typeof body.temperature === 'number') config.temperature = body.temperature;
  if (typeof body.top_p === 'number') config.topP = body.top_p;
  if (Array.isArray(body.stop) && body.stop.length) config.stopSequences = body.stop;
  const format = record(body.response_format);
  if (format.type === 'json_object' || format.type === 'json_schema') config.responseMimeType = 'application/json';

  const tools: Json[] = [];
  if (Array.isArray(body.tools)) {
    const declarations = body.tools.flatMap((raw) => {
      if (!isRecord(raw)) return [];
      const fn = record(raw.function);
      if (typeof fn.name !== 'string') return [];
      return [{ name: fn.name, description: string(fn.description), parameters: isRecord(fn.parameters) ? fn.parameters : { type: 'object', properties: {} } }];
    });
    if (declarations.length) tools.push({ functionDeclarations: declarations });
  }
  const choice = body.tool_choice;
  const toolConfig: Json | null = choice === 'required' ? { functionCallingConfig: { mode: 'ANY' } } : choice === 'none' ? { functionCallingConfig: { mode: 'NONE' } } : isRecord(choice) ? { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [string(record(choice.function).name)] } } : null;
  return {
    contents,
    ...(systemParts.length ? { systemInstruction: { parts: systemParts } } : {}),
    ...(tools.length ? { tools } : {}),
    ...(toolConfig ? { toolConfig } : {}),
    ...(Object.keys(config).length ? { generationConfig: config } : {}),
  };
}

function stopToOpenAI(reason: unknown, wire: UpstreamWire): string {
  const value = string(reason);
  if (wire === 'anthropic') {
    if (value === 'max_tokens') return 'length';
    if (value === 'tool_use') return 'tool_calls';
    if (value === 'refusal') return 'content_filter';
    return 'stop';
  }
  if (wire === 'gemini') {
    if (value === 'MAX_TOKENS') return 'length';
    if (value === 'SAFETY' || value === 'RECITATION' || value === 'BLOCKLIST') return 'content_filter';
    return 'stop';
  }
  return value || 'stop';
}

function usageFromOpenAI(raw: unknown): { prompt: number; completion: number } {
  const u = record(raw);
  return { prompt: number(u.prompt_tokens), completion: number(u.completion_tokens) };
}

export function normalizeJsonAnswer(wire: UpstreamWire, raw: Json, model: string): NormalizedAnswer {
  if (wire === 'openai') {
    const choices = Array.isArray(raw.choices) ? raw.choices : [];
    const choice = record(choices[0]);
    const message = record(choice.message);
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    const toolCalls: ToolCall[] = calls.flatMap((c, i) => {
      if (!isRecord(c)) return [];
      const fn = record(c.function);
      return [{ id: string(c.id, `call_${i}`), name: string(fn.name), arguments: jsonObject(fn.arguments) }];
    });
    if (isRecord(message.function_call)) toolCalls.push({ id: 'call_0', name: string(record(message.function_call).name), arguments: jsonObject(record(message.function_call).arguments) });
    const usage = usageFromOpenAI(raw.usage);
    return { id: string(raw.id, 'chatcmpl-agg'), model, text: blocksText(message.content), toolCalls, finishReason: stopToOpenAI(choice.finish_reason, wire), promptTokens: usage.prompt, completionTokens: usage.completion };
  }
  if (wire === 'anthropic') {
    const content = Array.isArray(raw.content) ? raw.content : [];
    let text = '';
    const toolCalls: ToolCall[] = [];
    for (const block of content) {
      if (!isRecord(block)) continue;
      if (block.type === 'text' && typeof block.text === 'string') text += block.text;
      else if (block.type === 'tool_use') toolCalls.push({ id: string(block.id, `call_${toolCalls.length}`), name: string(block.name), arguments: jsonObject(block.input) });
    }
    const usage = record(raw.usage);
    return { id: string(raw.id, 'msg_agg'), model, text, toolCalls, finishReason: stopToOpenAI(raw.stop_reason, wire), promptTokens: number(usage.input_tokens), completionTokens: number(usage.output_tokens) };
  }
  const candidates = Array.isArray(raw.candidates) ? raw.candidates : [];
  const candidate = record(candidates[0]);
  const content = record(candidate.content);
  const parts = Array.isArray(content.parts) ? content.parts : [];
  let text = '';
  const toolCalls: ToolCall[] = [];
  for (const part of parts) {
    if (!isRecord(part)) continue;
    if (typeof part.text === 'string') text += part.text;
    if (isRecord(part.functionCall)) toolCalls.push({ id: `call_${toolCalls.length}`, name: string(part.functionCall.name), arguments: jsonObject(part.functionCall.args) });
  }
  const usage = record(raw.usageMetadata);
  return { id: string(raw.responseId, 'gemini-agg'), model, text, toolCalls, finishReason: stopToOpenAI(candidate.finishReason, wire), promptTokens: number(usage.promptTokenCount), completionTokens: number(usage.candidatesTokenCount) };
}

/** OpenAI Chat Completions JSON response with stable, wire-correct fields. */
export function asOpenAIJson(answer: NormalizedAnswer): Json {
  const message: Json = { role: 'assistant', content: answer.text || null };
  if (answer.toolCalls.length) message.tool_calls = answer.toolCalls.map((t) => ({ id: t.id, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.arguments) } }));
  return {
    id: answer.id,
    object: 'chat.completion',
    created: 1767225600,
    model: answer.model,
    choices: [{ index: 0, message, finish_reason: answer.finishReason }],
    usage: { prompt_tokens: answer.promptTokens, completion_tokens: answer.completionTokens, total_tokens: answer.promptTokens + answer.completionTokens },
  };
}

/** Anthropic Messages JSON response with stable, wire-correct fields. */
export function asAnthropicJson(answer: NormalizedAnswer, requestedModel: string): Json {
  const content: Json[] = [];
  if (answer.text !== '') content.push({ type: 'text', text: answer.text });
  for (const t of answer.toolCalls) content.push({ type: 'tool_use', id: t.id, name: t.name, input: t.arguments });
  if (!content.length) content.push({ type: 'text', text: '' });
  const stop = answer.finishReason === 'length' ? 'max_tokens' : answer.finishReason === 'tool_calls' ? 'tool_use' : answer.finishReason === 'content_filter' ? 'refusal' : 'end_turn';
  return {
    id: answer.id.startsWith('msg_') ? answer.id : `msg_${answer.id}`,
    type: 'message',
    role: 'assistant',
    model: requestedModel,
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: answer.promptTokens, output_tokens: answer.completionTokens },
  };
}

export interface SseFrame { event: string | null; data: string }

/** Parse complete SSE frames, honoring field syntax and the final unterminated frame. */
export function parseSseFrames(text: string): SseFrame[] {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const out: SseFrame[] = [];
  let event: string | null = null;
  let data: string[] = [];

  const dispatch = () => {
    if (data.length) out.push({ event, data: data.join('\n') });
    event = null;
    data = [];
  };

  for (const line of normalized.split('\n')) {
    if (line === '') {
      dispatch();
      continue;
    }
    if (line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    const field = separator < 0 ? line : line.slice(0, separator);
    const value = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /, '');
    if (field === 'data') data.push(value);
    else if (field === 'event') event = value;
  }
  dispatch();
  return out;
}

function jsonPayloads(frames: SseFrame[]): Json[] {
  const out: Json[] = [];
  for (const frame of frames) {
    const payload = frame.data.trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const value: unknown = JSON.parse(payload);
      if (isRecord(value)) out.push(value);
    } catch { /* Ignore keep-alives and non-JSON extension frames. */ }
  }
  return out;
}

export function normalizeStreamAnswer(wire: UpstreamWire, text: string, model: string): NormalizedAnswer {
  const frames = parseSseFrames(text);
  let answer: NormalizedAnswer = { id: 'chatcmpl-agg', model, text: '', toolCalls: [], finishReason: 'stop', promptTokens: 0, completionTokens: 0 };
  if (wire === 'openai') {
    const calls = new Map<number, { id: string; name: string; args: string }>();
    for (const chunk of jsonPayloads(frames)) {
      if (typeof chunk.id === 'string') answer.id = chunk.id;
      const usage = usageFromOpenAI(chunk.usage);
      if (isRecord(chunk.usage)) { answer.promptTokens = usage.prompt; answer.completionTokens = usage.completion; }
      const choice = record(Array.isArray(chunk.choices) ? chunk.choices[0] : undefined);
      const delta = record(choice.delta);
      if (typeof delta.content === 'string') answer.text += delta.content;
      if (Array.isArray(delta.tool_calls)) for (const raw of delta.tool_calls) {
        if (!isRecord(raw)) continue;
        const index = number(raw.index);
        const call = calls.get(index) ?? { id: '', name: '', args: '' };
        if (typeof raw.id === 'string') call.id = raw.id;
        const fn = record(raw.function);
        if (typeof fn.name === 'string') call.name += fn.name;
        if (typeof fn.arguments === 'string') call.args += fn.arguments;
        calls.set(index, call);
      }
      if (typeof choice.finish_reason === 'string') answer.finishReason = choice.finish_reason;
    }
    answer.toolCalls = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([i, c]) => ({ id: c.id || `call_${i}`, name: c.name, arguments: jsonObject(c.args) }));
    return answer;
  }
  if (wire === 'anthropic') {
    const tools = new Map<number, { id: string; name: string; args: string }>();
    for (const frame of frames) {
      let raw: unknown;
      try { raw = JSON.parse(frame.data); } catch { continue; }
      if (!isRecord(raw)) continue;
      if (frame.event === 'message_start' && isRecord(raw.message)) {
        answer.id = string(raw.message.id, answer.id);
        const usage = record(raw.message.usage);
        answer.promptTokens = number(usage.input_tokens);
      } else if (frame.event === 'content_block_start') {
        const block = record(raw.content_block);
        if (block.type === 'tool_use') tools.set(number(raw.index), { id: string(block.id), name: string(block.name), args: '' });
      } else if (frame.event === 'content_block_delta') {
        const delta = record(raw.delta);
        if (delta.type === 'text_delta' && typeof delta.text === 'string') answer.text += delta.text;
        else if (delta.type === 'input_json_delta') {
          const tool = tools.get(number(raw.index));
          if (tool) tool.args += string(delta.partial_json);
        }
      } else if (frame.event === 'message_delta') {
        const delta = record(raw.delta);
        if (typeof delta.stop_reason === 'string') answer.finishReason = stopToOpenAI(delta.stop_reason, wire);
        answer.completionTokens = number(record(raw.usage).output_tokens);
      }
    }
    answer.toolCalls = [...tools.entries()].sort((a, b) => a[0] - b[0]).map(([, t], i) => ({ id: t.id || `call_${i}`, name: t.name, arguments: jsonObject(t.args) }));
    return answer;
  }
  const calls = new Map<number, { id: string; name: string; args: string }>();
  for (const chunk of jsonPayloads(frames)) {
    if (typeof chunk.responseId === 'string') answer.id = chunk.responseId;
    const usage = record(chunk.usageMetadata);
    if (Object.keys(usage).length) { answer.promptTokens = number(usage.promptTokenCount); answer.completionTokens = number(usage.candidatesTokenCount); }
    const candidate = record(Array.isArray(chunk.candidates) ? chunk.candidates[0] : undefined);
    const content = record(candidate.content);
    const parts = Array.isArray(content.parts) ? content.parts : [];
    for (const part of parts) {
      if (!isRecord(part)) continue;
      if (typeof part.text === 'string') answer.text += part.text;
      if (isRecord(part.functionCall)) {
        const index = calls.size;
        const fn = part.functionCall;
        calls.set(index, { id: `call_${index}`, name: string(fn.name), args: JSON.stringify(jsonObject(fn.args)) });
      }
    }
    if (typeof candidate.finishReason === 'string') answer.finishReason = stopToOpenAI(candidate.finishReason, wire);
  }
  answer.toolCalls = [...calls.values()].map((t) => ({ id: t.id, name: t.name, arguments: jsonObject(t.args) }));
  return answer;
}

function sse(event: string | null, data: unknown): string {
  return `${event === null ? '' : `event: ${event}\n`}data: ${JSON.stringify(data)}\n\n`;
}

/** Rebuild a valid OpenAI stream from a normalized answer (finish, usage, then [DONE]). */
export function asOpenAISse(answer: NormalizedAnswer): string {
  const id = answer.id || 'chatcmpl-agg';
  const chunk = (delta: Json, finish: string | null) => ({ id, object: 'chat.completion.chunk', created: 1767225600, model: answer.model, choices: [{ index: 0, delta, finish_reason: finish }] });
  const out = [sse(null, chunk({ role: 'assistant', content: '' }, null))];
  if (answer.text) out.push(sse(null, chunk({ content: answer.text }, null)));
  for (let i = 0; i < answer.toolCalls.length; i++) {
    const t = answer.toolCalls[i];
    out.push(sse(null, chunk({ tool_calls: [{ index: i, id: t.id, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.arguments) } }] }, null)));
  }
  out.push(sse(null, chunk({}, answer.finishReason || 'stop')));
  out.push(sse(null, { id, object: 'chat.completion.chunk', created: 1767225600, model: answer.model, choices: [], usage: { prompt_tokens: answer.promptTokens, completion_tokens: answer.completionTokens, total_tokens: answer.promptTokens + answer.completionTokens } }));
  out.push('data: [DONE]\n\n');
  return out.join('');
}

/** Rebuild a valid Anthropic stream with usage in message_start and ordered tool/text blocks. */
export function asAnthropicSse(answer: NormalizedAnswer, requestedModel: string): string {
  const out = [sse('message_start', { type: 'message_start', message: { id: answer.id.startsWith('msg_') ? answer.id : `msg_${answer.id}`, type: 'message', role: 'assistant', model: requestedModel, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: answer.promptTokens, output_tokens: 0 } } })];
  let index = 0;
  if (answer.text !== '') {
    out.push(sse('content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } }));
    out.push(sse('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: answer.text } }));
    out.push(sse('content_block_stop', { type: 'content_block_stop', index }));
    index += 1;
  }
  for (const tool of answer.toolCalls) {
    out.push(sse('content_block_start', { type: 'content_block_start', index, content_block: { type: 'tool_use', id: tool.id, name: tool.name, input: {} } }));
    out.push(sse('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(tool.arguments) } }));
    out.push(sse('content_block_stop', { type: 'content_block_stop', index }));
    index += 1;
  }
  if (index === 0) {
    out.push(sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }));
    out.push(sse('content_block_stop', { type: 'content_block_stop', index: 0 }));
  }
  const stop = answer.finishReason === 'length' ? 'max_tokens' : answer.finishReason === 'tool_calls' ? 'tool_use' : answer.finishReason === 'content_filter' ? 'refusal' : 'end_turn';
  out.push(sse('message_delta', { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: answer.completionTokens } }));
  out.push(sse('message_stop', { type: 'message_stop' }));
  return out.join('');
}
