export class ProviderError extends Error {
  constructor(message: string, public status = 502, public retryable = false, public retryAfterMs = 0) { super(message); }
}

export async function providerResponseError(response: Response, apiKey: string) {
  const data = await response.json().catch(() => null);
  let detail = typeof data?.error?.message === "string" ? data.error.message
    : typeof data?.error === "string" ? data.error : "";
  if (apiKey) detail = detail.split(apiKey).join("[redacted]");
  detail = detail.replace(/sk-[\w-]+/gi, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/[\r\n\x00-\x1f]+/g, " ").slice(0, 500);
  const retry = response.headers.get("retry-after");
  const retryAfterMs = retry ? /^\d+(\.\d+)?$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now()) : 0;
  // HTTP 401 belongs to the app session; an upstream key failure must not sign the user out.
  return new ProviderError(`Model request failed (HTTP ${response.status}).${detail ? ` ${detail}` : ""}`,
    [401, 403].includes(response.status) ? 502 : response.status,
    [408, 429, 500, 502, 503, 504, 529].includes(response.status), retryAfterMs);
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

export async function bufferResponse(response: Response, signal: AbortSignal, limitError: Error = new ProviderError("The model response exceeded the 4 MiB limit.")) {
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
        throw limitError;
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

/** Shared by QA and admin connectivity tests; no retries at this layer. */
export async function fetchChatCompletion(
  baseUrl: string, apiKey: string, payload: unknown, signal: AbortSignal,
  beforeFetch?: () => Promise<void>, requestTimeoutMs = 90_000,
): Promise<Response> {
  const base = baseUrl.trim().replace(/\/+$/, "");
  const endpoint = new URL(base.endsWith("/chat/completions") ? base : `${base}/chat/completions`);
  if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new ProviderError("The LLM endpoint must be an HTTP(S) URL without embedded credentials or query parameters.", 503);
  }
  const release = await acquire(signal);
  try {
    signal.throwIfAborted();
    await beforeFetch?.();
    signal.throwIfAborted();
    // Admission and the durable dispatch checkpoint have their own caller deadline.
    const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(requestTimeoutMs)]);
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
      if (error instanceof TypeError) {
        const cause = error.cause as { code?: unknown; errors?: Array<{ code?: unknown }> } | undefined;
        const codes = [cause?.code, ...(Array.isArray(cause?.errors) ? cause.errors.map(error => error?.code) : [])];
        const code = codes.find(code => typeof code === "string" && [
          "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "ECONNREFUSED", "ECONNRESET", "ENETUNREACH", "EHOSTUNREACH",
          "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET", "CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID",
          "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
        ].includes(code));
        throw new ProviderError(`The model connection to ${endpoint.hostname} failed${code ? ` (${code})` : ""}. Check server network and provider reachability.`, 502, true);
      }
      throw error;
    }
  } finally { release(); }
}
