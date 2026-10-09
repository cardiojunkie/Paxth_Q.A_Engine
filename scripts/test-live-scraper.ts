// Explicit live check: consumes the configured provider's credits; never writes catalog data.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { collectPage, getScraperApiKey, ScrapeError, type ScrapePreview } from '../src/lib/cloudScrape';
import { collectProductPage } from '../src/server/scrapePipeline';
import { DEFAULT_SETTINGS } from '../src/lib/providerSettings';
import { getProviderCredentials } from '../src/server/provider';
getScraperApiKey(); getProviderCredentials();

const cases: Array<{ name: string; url: string; facts: string[] }> = JSON.parse(await readFile('scripts/scraper-sites.json', 'utf8'));
assert.equal(cases.length, 12);
assert.equal(new Set(cases.map(item => item.url)).size, cases.length);
assert.ok(cases.every(item => item.facts.length >= 2 && new URL(item.url).protocol === 'https:'));
const filter = process.argv[2]?.toLowerCase();
assert.ok(!filter || cases.some(item => item.name.toLowerCase().includes(filter)), 'No matching live test case');
const folder = path.resolve(process.env.SCRAPER_LIVE_OUTPUT || `.cache/scraper-live-${Date.now()}`);
await mkdir(folder, { recursive: true });
const results: any[] = [];
const normalize = (text: string) => text.toLowerCase().replace(/[\s,*|]/g, '');
for (const [index, item] of cases.entries()) {
  if (filter && !item.name.toLowerCase().includes(filter)) continue;
  const started = Date.now();
  let raw: ScrapePreview | undefined;
  let record: any = { ...item, model: DEFAULT_SETTINGS.scraperModelName, testedAt: new Date().toISOString() };
  try {
    const structured = await collectProductPage(item.url, AbortSignal.timeout(300_000), DEFAULT_SETTINGS, async (url, signal) => {
      raw = await collectPage(url, signal);
      await writeFile(path.join(folder, `${index + 1}-raw.md`), raw.markdown);
      return raw;
    });
    await writeFile(path.join(folder, `${index + 1}-structured.md`), structured.markdown);
    const checks = item.facts.map(fact => ({ fact, inCapture: normalize(raw!.markdown).includes(normalize(fact)), inMarkdown: normalize(structured.markdown).includes(normalize(fact)) }));
    const sourceMatches = structured.markdown.endsWith(`Source: <${structured.requestedUrl}>${structured.finalUrl && structured.finalUrl !== structured.requestedUrl ? `\nRetrieved URL: <${structured.finalUrl}>` : ''}`);
    record = { ...record, status: structured.status === 'partial' ? 'partial' : checks.every(check => check.inCapture && check.inMarkdown) && sourceMatches ? 'passed' : 'failed',
      receivedAt: structured.receivedAt, capturedAt: structured.capturedAt, finalUrl: structured.finalUrl, checks, sourceMatches, report: structured.report };
  } catch (error) {
    record = { ...record, status: error instanceof ScrapeError && error.code === 'PAGE_BLOCKED' ? 'blocked' : 'failed',
      receivedAt: raw?.receivedAt, capturedAt: raw?.capturedAt, finalUrl: raw?.finalUrl, crawlStatus: raw?.status,
      error: error instanceof ScrapeError ? error.message : 'Live test failed', code: error instanceof ScrapeError ? error.code : 'TEST_FAILED',
      report: error instanceof ScrapeError ? error.report : undefined };
  }
  record.durationMs = Date.now() - started;
  results.push(record);
  await writeFile(path.join(folder, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify({ name: item.name, status: record.status, code: record.code, durationMs: record.durationMs, checks: record.checks }));
}
console.log(`Evidence and diagnostics: ${folder}`);
if (results.some(result => result.status !== 'passed')) process.exitCode = 1;
