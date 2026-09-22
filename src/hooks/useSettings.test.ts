import assert from "node:assert/strict";
import { normalizeSettings } from "./useSettings";
import { DEFAULT_QA_AGENT_MEMORY } from "../lib/qaAgent";

const reachableUrl = "https://api.aicredits.in/v1";

assert.equal(normalizeSettings({}).baseUrl, reachableUrl);
assert.equal(normalizeSettings({ baseUrl: "https://api.aicredits.in/v1" }).baseUrl, reachableUrl);
for (const suffix of ["", "/chat/completions"]) {
  assert.equal(normalizeSettings({ baseUrl: `  https://aicredits.in/v1${suffix}///  ` }).baseUrl, `${reachableUrl}${suffix}`);
  assert.equal(normalizeSettings({ baseUrl: `${reachableUrl}${suffix}` }).baseUrl, `${reachableUrl}${suffix}`);
}
for (const baseUrl of ["https://example.com/v1/", "http://localhost:11434/v1", "https://aicredits.in.example/v1", "https://aicredits.in/v10"]) {
  assert.equal(normalizeSettings({ baseUrl }).baseUrl, baseUrl);
}
const currentSettings = normalizeSettings({
  baseUrl: "https://aicredits.in/v1", apiKey: "test-only", modelName: "deepseek/deepseek-v4.1-flash",
  maxTokens: 10000, maxConcurrency: 3, maxRetries: 2, maxPageContentLength: 100000,
});
assert.deepEqual(normalizeSettings(currentSettings), currentSettings);
assert.equal(currentSettings.modelName, "deepseek/deepseek-v4.1-flash");
assert.equal(currentSettings.maxTokens, 10000);
assert.equal(currentSettings.maxConcurrency, 3);
assert.equal(currentSettings.maxRetries, 2);
assert.equal(currentSettings.maxPageContentLength, 100000);

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
