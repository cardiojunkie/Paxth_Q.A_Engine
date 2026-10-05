import assert from 'node:assert/strict';
import { checkScrapeCredits, isPublicAddress, validateScrapeInput, validateScrapeKey, validateScrapeSettings, scrapeWithAgent } from './scrapeAgent';
import { resolvePublicAddress, ScrapeError } from './scrapeNetwork';
import { DEFAULT_SCRAPE_SETTINGS } from './scrapeRequest';

const url = 'https://8.8.8.8/product?variant=42&colour=black';
assert.equal(validateScrapeInput({ url: url + '#specs' }).url, url);
assert.equal(validateScrapeInput({ url: 'example.com/product' }).url, 'https://example.com/product');
for (const value of ['', 'ftp://example.com/a', 'https://user:pass@example.com', 'http://127.0.0.1', 'http://[::1]', 'http://169.254.169.254/latest/meta-data/', 'http://10.1.1.1', 'http://service.local', 'http://localhost', 'https://example.com\\bad', 'http://example.com:0', 'http://example.com:5432']) {
  assert.throws(() => validateScrapeInput({ url: value }));
}
for (const address of ['127.0.0.1', '169.254.169.254', '100.64.0.1', '192.0.2.1', '::1', 'fe80::1', 'fc00::1', '::ffff:8.8.8.8', '2001:db8::1', '2002:0808:0808::1']) assert.equal(isPublicAddress(address), false, address);
for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) assert.equal(isPublicAddress(address), true, address);
await assert.rejects(resolvePublicAddress(new URL('https://example.com/product'), (async () => [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }]) as any), /public internet/);
const dnsCancellation = new AbortController();
setTimeout(() => dnsCancellation.abort(), 10);
await assert.rejects(resolvePublicAddress(new URL('https://example.com'), (() => new Promise(() => {})) as any, dnsCancellation.signal), { name: 'AbortError' });
assert.equal(validateScrapeKey(' sgai-test-key '), 'sgai-test-key');
for (const key of [null, '', 'bad\nkey', 'x'.repeat(513)]) assert.throws(() => validateScrapeKey(key));
for (const settings of [{ mode: 'invalid' }, { wait: -1 }, { wait: 30001 }, { wait: 0.5 }, { scrolls: 101 }, { stealth: 'true' }]) {
  assert.throws(() => validateScrapeSettings({ ...DEFAULT_SCRAPE_SETTINGS, ...settings }));
}

const original = globalThis.fetch;
const configuration = { ...DEFAULT_SCRAPE_SETTINGS, apiKey: 'sgai-test-secret' };
const signal = new AbortController().signal;
const hasCode = (code: string) => (error: unknown) => error instanceof ScrapeError && error.code === code;
let calls = 0;
try {
  globalThis.fetch = async (target, init) => {
    calls++;
    assert.equal(String(target), 'https://v2-api.scrapegraphai.com/api/scrape');
    assert.equal(new Headers(init?.headers).get('SGAI-APIKEY'), configuration.apiKey);
    assert.equal(init?.redirect, 'error');
    assert.deepEqual(JSON.parse(String(init?.body)), { url, formats: [{ type: 'markdown', mode: 'normal' }], fetchConfig: { ...DEFAULT_SCRAPE_SETTINGS, timeout: 60000 } });
    assert.doesNotMatch(String(init?.body), /sgai-test-secret/);
    return Response.json({ results: { markdown: { data: ['# Product', 'Specifications'] } } });
  };
  assert.equal(await scrapeWithAgent(url, signal, configuration), `# Product\n\nSpecifications\n\nSource: <${url}>`);
  await assert.rejects(scrapeWithAgent(url, AbortSignal.abort(), configuration), hasCode('CANCELLED'));
  await assert.rejects(scrapeWithAgent(url, signal, { ...configuration, apiKey: null }), hasCode('API_KEY_REQUIRED'));
  assert.equal(calls, 1, 'Cancelled and unconfigured requests never reach the provider');

  for (const [status, code] of [[401, 'INVALID_API_KEY'], [403, 'INVALID_API_KEY'], [402, 'INSUFFICIENT_CREDITS'], [429, 'RATE_LIMITED'], [504, 'TIMEOUT'], [503, 'PAGE_UNAVAILABLE']] as const) {
    globalThis.fetch = async () => Response.json({ error: { message: configuration.apiKey } }, { status });
    await assert.rejects(scrapeWithAgent(url, signal, configuration), error => {
      assert.ok(hasCode(code)(error));
      assert.doesNotMatch((error as Error).message, /sgai-test-secret/);
      if (status === 401 || status === 403) assert.equal((error as ScrapeError).status, 502, 'Upstream key failures do not sign out the application user');
      return true;
    });
  }
  for (const data of [null, {}, { results: { markdown: { data: 'text' } } }, { results: { markdown: { data: [12] } } }]) {
    globalThis.fetch = async () => Response.json(data);
    await assert.rejects(scrapeWithAgent(url, signal, configuration), hasCode('INVALID_RESPONSE'));
  }
  globalThis.fetch = async () => new Response('<html>Unexpected gateway response</html>');
  await assert.rejects(scrapeWithAgent(url, signal, configuration), hasCode('INVALID_RESPONSE'));
  for (const text of ['', ' \n ', '# Just a moment\nVerify you are human', 'Checking your browser']) {
    globalThis.fetch = async () => Response.json({ results: { markdown: { data: [text] } } });
    await assert.rejects(scrapeWithAgent(url, signal, configuration), hasCode(text.trim() ? 'PAGE_BLOCKED' : 'EMPTY_PAGE'));
  }
  globalThis.fetch = async () => Response.json({ results: { markdown: { data: ['x'.repeat(200000)] } } });
  await assert.rejects(scrapeWithAgent(url, signal, configuration), hasCode('CONTENT_TOO_LARGE'));
  globalThis.fetch = async () => new Response('x'.repeat(4 * 1024 * 1024 + 1));
  await assert.rejects(scrapeWithAgent(url, signal, configuration), hasCode('CONTENT_TOO_LARGE'));
  globalThis.fetch = async () => { throw new TypeError('Private network details'); };
  await assert.rejects(scrapeWithAgent(url, signal, configuration), hasCode('CONNECTION_FAILED'));
  globalThis.fetch = async () => { throw new DOMException('Timed out', 'TimeoutError'); };
  await assert.rejects(scrapeWithAgent(url, signal, configuration), hasCode('TIMEOUT'));
  const controller = new AbortController();
  let bodyCancelled = false;
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(stream) { stream.enqueue(new TextEncoder().encode('{')); setTimeout(() => controller.abort(), 10); },
    cancel() { bodyCancelled = true; },
  }));
  await assert.rejects(scrapeWithAgent(url, controller.signal, configuration), hasCode('CANCELLED'));
  assert.equal(bodyCancelled, true, 'Cancellation stops response-body reading');

  globalThis.fetch = async (target, init) => {
    assert.equal(String(target), 'https://v2-api.scrapegraphai.com/api/credits');
    assert.equal(init?.method, 'GET'); assert.equal(init?.body, undefined);
    assert.equal(new Headers(init?.headers).get('SGAI-APIKEY'), 'draft-key');
    return Response.json({ remaining: 123, used: 4, plan: 'Test', jobs: {} });
  };
  assert.deepEqual(await checkScrapeCredits('draft-key', signal), { remaining: 123, used: 4, plan: 'Test' });
  globalThis.fetch = async () => Response.json({ remaining: '123', used: 4, plan: 'Test' });
  await assert.rejects(checkScrapeCredits('draft-key', signal), hasCode('INVALID_RESPONSE'));
} finally { globalThis.fetch = original; }
console.log('ScrapeGraph checks passed: public URLs, API contracts, errors, limits, credits and cancellation.');
