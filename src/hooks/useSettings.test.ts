import assert from 'node:assert/strict';
import { normalizeSettings, editableSettings, DEFAULT_SETTINGS } from '../lib/providerSettings';
const settings=normalizeSettings({apiKey:'must-not-survive',maxConcurrency:99,maxRetries:99,modelName:'test',maxTokens:10000} as any);
assert.ok(!('apiKey' in settings));
assert.ok(!('apiKey' in editableSettings(settings)));
assert.equal(normalizeSettings({baseUrl:'https://user:legacy-key@gateway.example/v1'}).baseUrl, '', 'Legacy destinations stay out of browser settings and snapshots');
assert.equal(settings.maxConcurrency,1);
assert.equal(settings.maxRetries,2);
assert.equal(settings.maxTokens,10000);
assert.equal(normalizeSettings({maxTokens:-1}).maxTokens,4096);
assert.equal(normalizeSettings({maxPageContentLength:0}).maxPageContentLength,40000);
assert.equal(normalizeSettings({qaAgentMemory:' '}).qaAgentMemory,DEFAULT_SETTINGS.qaAgentMemory);
assert.ok(!('baseUrl' in editableSettings(settings)));
const legacy = normalizeSettings({ modelName: 'chosen/qa', scrapperModelName: 'retired/navigation', navigationModelInitialized: true, scraperTimeout: 20_000 } as any);
assert.equal(legacy.modelName, 'chosen/qa');
for (const key of ['scrapperModelName', 'navigationModelInitialized', 'scraperTimeout']) {
  assert.ok(!(key in legacy), 'Retired settings must not enter browser settings or run snapshots');
  assert.ok(!(key in editableSettings(legacy)));
}
console.log('Server settings normalization checks passed.');
