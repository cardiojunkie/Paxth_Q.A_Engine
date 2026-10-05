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
export interface ScrapeSettings {
  mode: 'auto' | 'fast' | 'js';
  stealth: boolean;
  wait: number;
  scrolls: number;
}
export type ScraperSettings = ScrapeSettings & { configured: boolean };
export const DEFAULT_SCRAPE_SETTINGS: ScrapeSettings = { mode: 'auto', stealth: false, wait: 2000, scrolls: 3 };
