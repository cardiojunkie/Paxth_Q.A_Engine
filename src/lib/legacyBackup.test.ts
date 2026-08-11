import assert from "node:assert/strict";
import { validateBackup } from "../components/LLMSettingsModule.tsx";

const backup = validateBackup({
  attributeSets: [{ name: "TV", rulesMarkdown: "Check model" }],
  siteSelectors: [{ website: "example.com", selectors: ".product" }],
  settings: {
    llmProvider: "openai-compatible",
    baseUrl: "https://provider.example/v1/chat/completions",
    modelName: "model",
    apiKey: "must-not-survive",
    temperature: 0,
    maxTokens: 4096,
    maxRetries: 0,
    scraperTimeout: 30000,
    maxPageContentLength: 40000,
  },
});

assert.equal(backup.attributeSets[0].name, "TV");
assert.equal(backup.siteSelectors[0].website, "example.com");
assert.equal(backup.settings?.temperature, 0);
assert.equal("apiKey" in backup.settings!, false);
assert.equal("settings" in validateBackup({ attributeSets: [{ name: "TV", rulesMarkdown: "Check model" }] }), false);
assert.throws(() => validateBackup({ attributeSets: Array.from({ length: 501 }, () => ({ name: "x", rulesMarkdown: "" })) }), /too many/);
assert.throws(() => validateBackup({ siteSelectors: [{ website: "", selectors: ".x" }] }), /exceeds import limits/);
