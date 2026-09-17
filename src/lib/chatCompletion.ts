/** Shared transport; callers own their retry and deadline budgets. */
export function fetchChatCompletion(
  baseUrl: string,
  apiKey: string,
  payload: unknown,
  signal: AbortSignal,
) {
  const base = baseUrl.trim().replace(/\/+$/, "");
  const endpoint = new URL(base.endsWith("/chat/completions") ? base : `${base}/chat/completions`);
  if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
    throw new Error("The LLM endpoint must be an HTTP(S) URL without embedded credentials.");
  }
  return fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(apiKey && { Authorization: `Bearer ${apiKey}` }) },
    body: JSON.stringify(payload),
    signal,
  });
}
