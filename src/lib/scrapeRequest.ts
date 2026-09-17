import { readSavedSettings } from "../hooks/useSettings";

export async function scrapeUrl(url: string): Promise<string> {
  const { baseUrl, apiKey, modelName } = readSavedSettings();
  if (![baseUrl, apiKey, modelName].every(value => typeof value === "string" && value.trim())) {
    throw new Error("Configure and save the base URL, API key, and model in LLM Settings before scraping.");
  }
  const response = await fetch("/api/scrape", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: url.trim(), llm: { baseUrl, apiKey, modelName } }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error([data?.error, data?.details].filter(value => typeof value === "string" && value).join(": ")
      || `Scraping failed (HTTP ${response.status}).`);
  }
  if (typeof data?.markdown !== "string" || !data.markdown.trim()) {
    throw new Error("No product content was extracted. Use SAP or manually supplied source content.");
  }
  return data.markdown;
}
