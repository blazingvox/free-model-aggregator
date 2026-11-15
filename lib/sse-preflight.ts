import { isRecord } from './providers.ts';
import { SseDecoder } from './stream.ts';

export type SsePreflight =
  | { ok: true; stream: ReadableStream<Uint8Array> }
  | { ok: false; error: string; code?: string; status?: number };

const DEFAULT_MAX_PREFLIGHT_BYTES = 256 * 1024;

/** Read through one complete data frame, then replay the untouched prefix before the remaining body. */
export async function preflightSse(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
  maxBytes = DEFAULT_MAX_PREFLIGHT_BYTES,
): Promise<SsePreflight> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new RangeError('maxBytes must be positive');
  const reader = body.getReader();
  const decoder = new SseDecoder(maxBytes);
  const buffered: Uint8Array[] = [];
  let size = 0;
  let transferred = false;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    signal?.removeEventListener('abort', cancelOnAbort);
    try { reader.releaseLock(); } catch { /* already released */ }
  };
  const cancelOnAbort = () => {
    void reader.cancel(signal?.reason).catch(() => {}).finally(cleanup);
  };
  if (signal?.aborted) cancelOnAbort();
  else signal?.addEventListener('abort', cancelOnAbort, { once: true });

  const fail = async (error: string): Promise<SsePreflight> => {
    try { await reader.cancel(); } catch { /* provider body already closed */ }
    return { ok: false, error };
  };

  try {
    for (;;) {
      if (signal?.aborted) return await fail('request aborted while reading the provider stream');
      const part = await reader.read();
      if (part.done) {
        const frames = decoder.finish();
        if (frames.length) return await classify(frames[0]);
        return await fail('provider stream ended before its first data frame');
      }
      buffered.push(part.value);
      size += part.value.byteLength;
      if (size > maxBytes) return await fail(`provider stream exceeded the ${maxBytes}-byte preflight limit`);
      const frames = decoder.push(part.value);
      if (frames.length) return await classify(frames[0]);
    }
  } catch (error) {
    return await fail(`could not read provider stream: ${(error as Error).message}`);
  } finally {
    if (!transferred) cleanup();
  }

  async function classify(frame: ReturnType<SseDecoder['finish']>[number]): Promise<SsePreflight> {
    if (frame.event !== 'error' && frame.data === '[DONE]') return replay();
    let value: unknown;
    try { value = JSON.parse(frame.data); }
    catch { return await fail('provider stream began with malformed SSE JSON'); }
    if (!isRecord(value)) return await fail('provider stream began with a non-object SSE frame');
    const isError = frame.event === 'error' || value.type === 'error' || isRecord(value.error) || typeof value.error === 'string';
    if (isError) {
      const error = isRecord(value.error) ? value.error : value;
      const code = typeof error.code === 'string' ? error.code : typeof error.type === 'string' ? error.type : typeof error.status === 'string' ? error.status : typeof value.code === 'string' ? value.code : typeof value.error === 'string' ? value.error : '';
      const statusValue = error.status ?? error.status_code ?? error.http_status ?? value.status ?? value.status_code ?? value.http_status;
      const numericStatus = typeof statusValue === 'number' ? statusValue : typeof statusValue === 'string' && /^\d{3}$/.test(statusValue) ? Number(statusValue) : undefined;
      const status = numericStatus !== undefined && Number.isInteger(numericStatus) ? numericStatus : undefined;
      const message = typeof error.message === 'string' ? error.message : typeof value.error === 'string' ? value.error : 'provider sent an SSE error frame';
      try { await reader.cancel(); } catch { /* provider body already closed */ }
      cleanup();
      return { ok: false, error: message.slice(0, 300), ...(code ? { code } : {}), ...(status === undefined ? {} : { status }) };
    }

    return replay();
  }

  function replay(): SsePreflight {
    let offset = 0;
    let closed = false;
    transferred = true;
    const replay = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (closed) return;
        if (signal?.aborted) { closed = true; cleanup(); controller.close(); return; }
        if (offset < buffered.length) { controller.enqueue(buffered[offset++]); return; }
        try {
          const next = await reader.read();
          if (next.done) { closed = true; cleanup(); controller.close(); }
          else controller.enqueue(next.value);
        } catch (error) { closed = true; cleanup(); controller.error(error); }
      },
      async cancel(reason) {
        closed = true;
        try { await reader.cancel(reason); } finally { cleanup(); }
      },
    });
    return { ok: true, stream: replay };
  }
}
