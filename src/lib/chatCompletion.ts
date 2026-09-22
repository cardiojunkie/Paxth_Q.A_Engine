export class ProviderError extends Error {
  constructor(message: string, public status = 502, public retryable = false, public retryAfterMs = 0) { super(message); }
}

let active = 0;
const waiting: Array<{ start: () => void }> = [];

// ponytail: process-local admission matches the single backend; use a shared limiter before scaling replicas.
async function acquire(signal: AbortSignal): Promise<() => void> {
  signal.throwIfAborted();
  if (active < 2) active++;
  else {
    if (waiting.length >= 8) throw new ProviderError("The model request queue is full. Retry shortly.", 503);
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); };
      const fail = (error: unknown) => {
        const index = waiting.indexOf(entry);
        if (index >= 0) waiting.splice(index, 1);
        cleanup(); reject(error);
      };
      const abort = () => fail(signal.reason);
      const entry = { start: () => { cleanup(); resolve(); } };
      const timer = setTimeout(() => fail(new ProviderError("Timed out waiting for the model. Retry shortly.", 503)), 60_000);
      signal.addEventListener("abort", abort, { once: true });
      waiting.push(entry);
    });
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = waiting.shift();
    if (next) next.start(); else active--;
  };
}

async function bufferResponse(response: Response, signal: AbortSignal) {
  const reader = response.body?.getReader();
  if (!reader) return response;
  const chunks: Uint8Array[] = [];
  let length = 0;
  const abort = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      length += value.byteLength;
      if (length > 4 * 1024 * 1024) {
        void reader.cancel().catch(() => {});
        throw new ProviderError("The model response exceeded the 4 MiB limit.");
      }
      chunks.push(value);
    }
    const body = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}

/** Shared by QA, scraper decisions, and admin tests; no retries at this layer. */
export async function fetchChatCompletion(
  baseUrl: string, apiKey: string, payload: unknown, signal: AbortSignal,
  beforeFetch?: () => Promise<void>,
): Promise<Response> {
  const base = baseUrl.trim().replace(/\/+$/, "");
  const endpoint = new URL(base.endsWith("/chat/completions") ? base : `${base}/chat/completions`);
  if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new ProviderError("The LLM endpoint must be an HTTP(S) URL without embedded credentials or query parameters.", 503);
  }
  const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(90_000)]);
  const release = await acquire(boundedSignal);
  try {
    boundedSignal.throwIfAborted();
    await beforeFetch?.();
    boundedSignal.throwIfAborted();
    try {
      const response = await fetch(endpoint, {
        method: "POST", redirect: "error",
        headers: { "Content-Type": "application/json", ...(apiKey && { Authorization: `Bearer ${apiKey}` }) },
        body: JSON.stringify(payload), signal: boundedSignal,
      });
      return await bufferResponse(response, boundedSignal);
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (boundedSignal.aborted) throw new ProviderError("The model request timed out.", 504, true);
      if (error instanceof TypeError) throw new ProviderError("The model connection failed.", 502, true);
      throw error;
    }
  } finally { release(); }
}
