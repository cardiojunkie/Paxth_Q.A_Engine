import assert from "node:assert/strict";
import { normalizeSettings } from "./useSettings";
import { DEFAULT_QA_AGENT_MEMORY } from "../lib/qaAgent";

const reachableUrl = "https://aicredits.in/v1";

assert.equal(normalizeSettings({}).baseUrl, reachableUrl);
assert.equal(normalizeSettings({ baseUrl: "https://api.aicredits.in/v1" }).baseUrl, reachableUrl);
assert.equal(normalizeSettings({ baseUrl: "  https://api.aicredits.in/v1///  " }).baseUrl, reachableUrl);
assert.equal(normalizeSettings({ baseUrl: "https://example.com/v1/" }).baseUrl, "https://example.com/v1/");

for (const qaAgentMemory of [undefined, "", "  \n ", null, 42, {}]) {
  assert.equal(normalizeSettings({ qaAgentMemory } as any).qaAgentMemory, DEFAULT_QA_AGENT_MEMORY);
}
const custom = normalizeSettings({ apiKey: "test-only", qaAgentMemory: "Check Arabic wording.\nKeep exact model suffixes." });
assert.equal(normalizeSettings(JSON.parse(JSON.stringify(custom))).qaAgentMemory, custom.qaAgentMemory);
assert.equal(normalizeSettings({ ...custom, qaAgentMemory: DEFAULT_QA_AGENT_MEMORY }).apiKey, "test-only");
assert.equal(normalizeSettings({}).maxPageContentLength, 40000);
assert.equal(normalizeSettings({ maxPageContentLength: 0 }).maxPageContentLength, 40000);
assert.equal(normalizeSettings({ maxPageContentLength: 12345 }).maxPageContentLength, 12345);

console.log("Settings normalization assertions passed.");
