import { isRecord } from './providers.ts';
import type { ClientWire, UpstreamWire } from './transforms.ts';

export interface SseFrame { event: string | null; data: string; id: string | null; retry: string | null }

/** Incremental SSE parser. Its retained frame is capped so a broken peer cannot grow memory forever. */
export class SseDecoder {
  private readonly text = new TextDecoder();
  private pending = '';
  private data: string[] = [];
  private event: string | null = null;
  private id: string | null = null;
  private retry: string | null = null;
  private first = true;
  private dropping = false;
  private readonly maxFrameBytes: number;
  constructor(maxFrameBytes = 1024 * 1024) {
    this.maxFrameBytes = maxFrameBytes;
    if (!Number.isSafeInteger(maxFrameBytes) || maxFrameBytes < 1) throw new RangeError('maxFrameBytes must be positive');
  }

  push(bytes: Uint8Array): SseFrame[] {
    this.pending += this.text.decode(bytes, { stream: true });
    return this.consume(false);
  }

  finish(): SseFrame[] {
    this.pending += this.text.decode();
    return this.consume(true);
  }

  private consume(eof: boolean): SseFrame[] {
    const out: SseFrame[] = [];
    if (this.first && this.pending.length) {
      this.pending = this.pending.replace(/^\uFEFF/, '');
      this.first = false;
    }
    let start = 0;
    for (let i = 0; i < this.pending.length; i++) {
      const c = this.pending.charCodeAt(i);
      if (c !== 10 && c !== 13) continue;
      if (c === 13 && i === this.pending.length - 1 && !eof) break;
      const line = this.pending.slice(start, i);
      if (c === 13 && this.pending.charCodeAt(i + 1) === 10) i++;
      start = i + 1;
      const frame = this.line(line);
      if (frame) out.push(frame);
    }
    this.pending = this.pending.slice(start);
    if (eof) {
      if (this.pending !== '') { const frame = this.line(this.pending); if (frame) out.push(frame); this.pending = ''; }
      const frame = this.dispatch();
      if (frame) out.push(frame);
    }
    if (this.pending.length > this.maxFrameBytes) {
      this.pending = '';
      this.data = [];
      this.event = null;
      this.id = null;
      this.retry = null;
      this.dropping = true;
    }
    return out;
  }

  private line(line: string): SseFrame | null {
    if (line === '') { this.dropping = false; return this.dispatch(); }
    if (this.dropping) return null;
    const size = line.length + this.data.reduce((n, part) => n + part.length, 0);
    if (size > this.maxFrameBytes) { this.data = []; this.event = null; this.id = null; this.retry = null; this.dropping = true; return null; }
    if (line.startsWith(':')) return null;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') this.data.push(value);
    else if (field === 'event') this.event = value;
    else if (field === 'id' && !value.includes('\0')) this.id = value;
    else if (field === 'retry' && /^\d+$/.test(value)) this.retry = value;
    return null;
  }

  private dispatch(): SseFrame | null {
    const frame = this.data.length ? { event: this.event, data: this.data.join('\n'), id: this.id, retry: this.retry } : null;
    this.data = [];
    this.event = null;
    this.retry = null;
    return frame;
  }
}

export interface StreamBridgeOptions { wire: UpstreamWire; client: ClientWire; model: string }

/** Convert a provider stream as frames arrive. Invalid provider extensions are ignored. */
export async function* bridgeSse(upstream: ReadableStream<Uint8Array>, options: StreamBridgeOptions): AsyncGenerator<string> {
  const reader = upstream.getReader();
  const decoder = new SseDecoder();
  const state: BridgeState = { started: false, id: `${options.client === 'anthropic' ? 'msg_' : 'chatcmpl-'}stream`, index: 0, tools: new Map(), prompt: 0, completion: 0, finish: 'stop', textBlock: -1, activeBlock: -1, ended: false, failed: false };
  let complete = false;
  try {
    for (;;) {
      const part = await reader.read();
      const frames = part.done ? decoder.finish() : decoder.push(part.value);
      for (const frame of frames) {
        const out = transformFrame(frame, options, state);
        if (out) yield out;
        if (state.failed) break;
      }
      if (state.failed) break;
      if (part.done) { complete = true; break; }
    }
    if (!state.failed) for (const event of finishBridge(state, options)) yield event;
  } finally {
    if (!complete) { try { await reader.cancel(); } catch { /* disconnected upstream */ } }
    reader.releaseLock();
  }
}

interface BridgeState {
  started: boolean; id: string; index: number; tools: Map<number, { id: string; name: string; targetIndex: number; emitted?: boolean }>;
  prompt: number; completion: number; finish: string; textBlock: number; activeBlock: number; ended: boolean; failed: boolean;
}
const emit = (event: string | null, value: unknown): string => `${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(value)}\n\n`;
const obj = (value: unknown): Record<string, any> => isRecord(value) ? value : {};

function startBridge(s: BridgeState, options: StreamBridgeOptions): string {
  if (s.started) return '';
  s.started = true;
  if (options.client === 'openai') return emit(null, { id: s.id, object: 'chat.completion.chunk', model: options.model, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] });
  return emit('message_start', { type: 'message_start', message: { id: s.id, type: 'message', role: 'assistant', model: options.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: s.prompt, output_tokens: 0 } } });
}

function textDelta(text: string, s: BridgeState, options: StreamBridgeOptions): string {
  if (text === '') return '';
  if (options.client === 'openai') return emit(null, { id: s.id, object: 'chat.completion.chunk', model: options.model, choices: [{ index: 0, delta: { content: text }, finish_reason: null }] });
  let out = '';
  if (s.textBlock < 0) {
    if (s.activeBlock >= 0) out += emit('content_block_stop', { type: 'content_block_stop', index: s.activeBlock });
    s.textBlock = s.index++;
    s.activeBlock = s.textBlock;
    out += emit('content_block_start', { type: 'content_block_start', index: s.textBlock, content_block: { type: 'text', text: '' } });
  }
  return out + emit('content_block_delta', { type: 'content_block_delta', index: s.textBlock, delta: { type: 'text_delta', text } });
}

function transformFrame(frame: SseFrame, options: StreamBridgeOptions, s: BridgeState): string {
  // Same-wire OpenAI frames are already the requested protocol; preserve provider extensions.
  if (frame.data === '[DONE]') { s.ended = true; return options.wire === 'openai' && options.client === 'openai' ? `data: [DONE]\n\n` : ''; }
  let raw: unknown;
  try { raw = JSON.parse(frame.data); } catch { return ''; }
  if (!isRecord(raw)) return '';
  const providerError = isRecord(raw.error) ? raw.error : (frame.event === 'error' || raw.type === 'error' ? raw : null);
  if (providerError) {
    const message = typeof providerError.message === 'string' ? providerError.message : 'the upstream stream failed';
    const type = typeof providerError.type === 'string' ? providerError.type : typeof providerError.code === 'string' ? providerError.code : 'upstream_error';
    s.failed = true;
    s.ended = true;
    if (options.client === 'openai') return emit(null, { error: { message, type, code: type } });
    return emit('error', { type: 'error', error: { type, message } });
  }
  if (options.wire === 'openai' && options.client === 'openai') return `data: ${frame.data}\n\n`;
  let out = '';
  let text = '';
  const deltas: Array<{ index: number; id?: string; name?: string; args?: string }> = [];
  if (options.wire === 'openai') {
    const choice = obj((Array.isArray(raw.choices) ? raw.choices[0] : null)); const delta = obj(choice.delta);
    text = typeof delta.content === 'string' ? delta.content : '';
    for (const t of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) if (isRecord(t)) deltas.push({ index: typeof t.index === 'number' ? t.index : s.tools.size, id: typeof t.id === 'string' ? t.id : undefined, name: typeof obj(t.function).name === 'string' ? obj(t.function).name : undefined, args: typeof obj(t.function).arguments === 'string' ? obj(t.function).arguments : undefined });
    if (typeof choice.finish_reason === 'string') s.finish = choice.finish_reason;
    const usage = obj(raw.usage); if (typeof usage.prompt_tokens === 'number') s.prompt = usage.prompt_tokens; if (typeof usage.completion_tokens === 'number') s.completion = usage.completion_tokens;
    if (typeof raw.id === 'string') s.id = raw.id;
  } else if (options.wire === 'anthropic') {
    const event = frame.event ?? (typeof raw.type === 'string' ? raw.type : '');
    if (event === 'message_start') { const message = obj(raw.message); if (typeof message.id === 'string') s.id = message.id; s.prompt = Number(obj(message.usage).input_tokens) || 0; }
    if (event === 'content_block_start') { const block = obj(raw.content_block); if (block.type === 'tool_use') deltas.push({ index: Number(raw.index) || 0, id: String(block.id ?? ''), name: String(block.name ?? '') }); }
    if (event === 'content_block_delta') { const d = obj(raw.delta); if (d.type === 'text_delta') text = String(d.text ?? ''); else if (d.type === 'input_json_delta') deltas.push({ index: Number(raw.index) || 0, args: String(d.partial_json ?? '') }); }
    if (event === 'message_delta') { const d = obj(raw.delta); if (typeof d.stop_reason === 'string') s.finish = d.stop_reason === 'max_tokens' ? 'length' : d.stop_reason === 'tool_use' ? 'tool_calls' : 'stop'; s.completion = Number(obj(raw.usage).output_tokens) || 0; }
  } else {
    if (typeof raw.responseId === 'string') s.id = raw.responseId;
    const usage = obj(raw.usageMetadata); s.prompt = Number(usage.promptTokenCount) || s.prompt; s.completion = Number(usage.candidatesTokenCount) || s.completion;
    const candidate = obj((Array.isArray(raw.candidates) ? raw.candidates[0] : null));
    for (const [partIndex, part] of (Array.isArray(obj(candidate.content).parts) ? obj(candidate.content).parts : []).entries()) if (isRecord(part)) { if (typeof part.text === 'string') text += part.text; if (isRecord(part.functionCall)) deltas.push({ index: partIndex, name: String(part.functionCall.name ?? ''), args: JSON.stringify(obj(part.functionCall.args)) }); }
    const reason = candidate.finishReason; if (typeof reason === 'string') s.finish = reason === 'MAX_TOKENS' ? 'length' : reason === 'SAFETY' ? 'content_filter' : 'stop';
  }
  out += startBridge(s, options);
  out += textDelta(text, s, options);
  for (const d of deltas) {
    if (options.client === 'openai') {
      let tool = s.tools.get(d.index);
      if (!tool) { tool = { id: d.id ?? `call_${d.index}`, name: d.name ?? '', targetIndex: d.index }; s.tools.set(d.index, tool); }
      if (d.name) tool.name = d.name;
      out += emit(null, { id: s.id, object: 'chat.completion.chunk', model: options.model, choices: [{ index: 0, delta: { tool_calls: [{ index: d.index, ...(!tool.emitted ? { id: tool.id, type: 'function' } : {}), function: { ...(d.name ? { name: d.name } : {}), ...(d.args !== undefined ? { arguments: d.args } : {}) } }] }, finish_reason: null }] });
      tool.emitted = true;
    } else {
      let ix = s.tools.get(d.index)?.targetIndex ?? -1;
      if (ix < 0) {
        if (s.activeBlock >= 0) out += emit('content_block_stop', { type: 'content_block_stop', index: s.activeBlock });
        ix = s.index++;
        s.tools.set(d.index, { id: d.id ?? `toolu_${ix}`, name: d.name ?? '', targetIndex: ix });
        out += emit('content_block_start', { type: 'content_block_start', index: ix, content_block: { type: 'tool_use', id: d.id ?? `toolu_${ix}`, name: d.name ?? '', input: {} } });
      }
      s.textBlock = -1;
      s.activeBlock = ix;
      if (d.args) out += emit('content_block_delta', { type: 'content_block_delta', index: ix, delta: { type: 'input_json_delta', partial_json: d.args } });
    }
  }
  return out;
}

function finishBridge(s: BridgeState, options: StreamBridgeOptions): string[] {
  if (s.ended && options.client === 'openai') return [];
  s.ended = true;
  const out: string[] = [];
  if (!s.started) out.push(startBridge(s, options));
  if (options.client === 'openai') {
    out.push(emit(null, { id: s.id, object: 'chat.completion.chunk', model: options.model, choices: [{ index: 0, delta: {}, finish_reason: s.finish }] }));
    out.push(emit(null, { id: s.id, object: 'chat.completion.chunk', model: options.model, choices: [], usage: { prompt_tokens: s.prompt, completion_tokens: s.completion, total_tokens: s.prompt + s.completion } }));
    out.push('data: [DONE]\n\n');
  } else {
    if (s.activeBlock >= 0) out.push(emit('content_block_stop', { type: 'content_block_stop', index: s.activeBlock }));
    const stop = s.finish === 'length' ? 'max_tokens' : s.finish === 'tool_calls' ? 'tool_use' : s.finish === 'content_filter' ? 'refusal' : 'end_turn';
    out.push(emit('message_delta', { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: s.completion } }));
    out.push(emit('message_stop', { type: 'message_stop' }));
  }
  return out;
}
