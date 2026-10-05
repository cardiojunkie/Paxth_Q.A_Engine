export async function scrapeUrl(url: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch("/api/scrape", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: url.trim() }), signal,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(typeof data?.error === 'string' && data.error ? data.error : `URL retrieval failed (HTTP ${response.status}).`);
  }
  if (typeof data?.markdown !== "string" || !data.markdown.trim()) {
    throw new Error("No readable page content was extracted.");
  }
  return data.markdown;
}
