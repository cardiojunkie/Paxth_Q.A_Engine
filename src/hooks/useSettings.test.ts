import assert from "node:assert/strict";
import { normalizeSettings } from "./useSettings";

const reachableUrl = "https://aicredits.in/v1";

assert.equal(normalizeSettings({}).baseUrl, reachableUrl);
assert.equal(normalizeSettings({ baseUrl: "https://api.aicredits.in/v1" }).baseUrl, reachableUrl);
assert.equal(normalizeSettings({ baseUrl: "  https://api.aicredits.in/v1///  " }).baseUrl, reachableUrl);
assert.equal(normalizeSettings({ baseUrl: "https://example.com/v1/" }).baseUrl, "https://example.com/v1/");

console.log("Settings normalization assertions passed.");
