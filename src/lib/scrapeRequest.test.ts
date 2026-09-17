import assert from "node:assert/strict";
import { scrapeUrl } from "./scrapeRequest";

const originalFetch = globalThis.fetch;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
let saved: string | null = JSON.stringify({
  baseUrl: "https://api.aicredits.in/v1",
  apiKey: "test-only-secret",
  modelName: "test-model",
});
const requests: Array<{ path: string; body: any }> = [];
let response = Response.json({ markdown: "# Product\n\n| Weight | 33 g |" });
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
  getItem(key: string) {
    assert.equal(key, "qa-analyzer-settings");
    return saved;
  },
} });
globalThis.fetch = async (path, init) => {
  requests.push({ path: String(path), body: JSON.parse(String(init?.body)) });
  return response.clone();
};

try {
  assert.equal(await scrapeUrl("  https://example.com/product  "), "# Product\n\n| Weight | 33 g |");
  assert.deepEqual(requests[0], {
    path: "/api/scrape",
    body: { url: "https://example.com/product", llm: {
      baseUrl: "https://aicredits.in/v1", apiKey: "test-only-secret", modelName: "test-model",
    } },
  });
  saved = JSON.stringify({ baseUrl: "https://other.example/v1", apiKey: "changed-key", modelName: "changed-model" });
  await scrapeUrl("https://example.com/product");
  assert.equal(requests[1].body.llm.apiKey, "changed-key", "Each scrape uses the latest saved credentials");

  response = Response.json({ error: "Verification required", details: "Use SAP or manual content." }, { status: 502 });
  await assert.rejects(scrapeUrl("https://example.com/product"), /Verification required: Use SAP or manual content\./);
  response = new Response("Gateway unavailable", { status: 503 });
  await assert.rejects(scrapeUrl("https://example.com/product"), /Scraping failed \(HTTP 503\)/);
  for (const markdown of ["", " \n ", null, 42, undefined]) {
    response = Response.json({ markdown });
    await assert.rejects(scrapeUrl("https://example.com/product"), /No product content was extracted/);
  }
  const previousCount = requests.length;
  for (const badSettings of [null, "invalid json", JSON.stringify({ apiKey: " " })]) {
    saved = badSettings;
    await assert.rejects(scrapeUrl("https://example.com/product"), /LLM Settings before scraping/);
  }
  assert.equal(requests.length, previousCount, "Missing credentials fail before starting browser work");
  console.log("Scrape request credentials and response assertions passed.");
} finally {
  globalThis.fetch = originalFetch;
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
}
