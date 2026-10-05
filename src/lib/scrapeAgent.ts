import { launch, binaryInfo } from 'cloakbrowser';
import { chromium, type Browser, type Page } from 'playwright-core';
import { ScrapeError, startScrapeProxy, validateScrapeInput } from './scrapeNetwork.js';
export { ScrapeError, isPublicAddress, validateScrapeInput } from './scrapeNetwork.js';

export const SCRAPE_BROWSER_VERSION = '146.0.7680.177.5';
export const MAX_SCRAPE_CHARACTERS = 200_000;
let active = false;
const waiting: Array<{ start: () => void }> = [];

// ponytail: one process owns browser admission; use a shared queue before adding backend replicas.
export async function acquireScrapeSlot(signal: AbortSignal, waitMs = 60_000) {
  signal.throwIfAborted();
  if (!active) active = true;
  else {
    if (waiting.length >= 8) throw new ScrapeError('The browser queue is full. Retry shortly.', 503, 'QUEUE_FULL');
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
      const fail = (error: unknown) => {
        const index = waiting.indexOf(entry);
        if (index >= 0) waiting.splice(index, 1);
        cleanup(); reject(error);
      };
      const abort = () => fail(signal.reason);
      const entry = { start: () => { cleanup(); resolve(); } };
      const timer = setTimeout(() => fail(new ScrapeError('Timed out waiting for the browser. Retry shortly.', 503, 'QUEUE_TIMEOUT')), waitMs);
      signal.addEventListener('abort', abort, { once: true });
      waiting.push(entry);
    });
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = waiting.shift();
    if (next) next.start(); else active = false;
  };
}

export async function launchScrapeBrowser(proxy: { server: string }): Promise<Browser> {
  const args = [
    '--proxy-bypass-list=<-loopback>', '--disable-quic',
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
  ];
  // Production preinstalls the pinned binary. No browser download or update during a scrape.
  const executablePath = process.env.CHROMIUM_EXECUTABLE;
  if (executablePath) return chromium.launch({ executablePath, headless: true, proxy, args, timeout: 20_000 });
  if (!binaryInfo(SCRAPE_BROWSER_VERSION).installed) throw new ScrapeError('The scraper browser is not installed. Run npm run setup:browser on the server.', 503, 'BROWSER_UNAVAILABLE');
  process.env.CLOAKBROWSER_AUTO_UPDATE = 'false';
  return launch({ browserVersion: SCRAPE_BROWSER_VERSION, headless: true, proxy, args, launchOptions: { timeout: 20_000 } });
}

async function readPage(page: Page) {
  return page.evaluate(() => {
    const ignored = document.querySelectorAll<HTMLElement>(
      'script,style,noscript,template,nav,[role="navigation"],body>header,body>footer,[role="contentinfo"],form,button,input,select,textarea,iframe,object,embed,[data-ad-slot],[data-ad],[aria-label="advertisement" i],[aria-label*="breadcrumb" i]',
    );
    const styles = Array.from(ignored, element => [element, element.getAttribute('style')] as const);
    try {
      for (const [element] of styles) element.style.setProperty('display', 'none', 'important');
      const main = document.querySelector<HTMLElement>('main,[role="main"]') || document.body;
      const text = (main?.innerText || '').replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      return { text: text.slice(0, 200_001), title: document.title };
    } finally {
      for (const [element, style] of styles) {
        if (style === null) element.removeAttribute('style'); else element.setAttribute('style', style);
      }
    }
  });
}

function checkContent(text: string, title: string) {
  if (/^(access denied|just a moment|attention required|robot check|pardon our interruption)/i.test(title.trim()) ||
      (text.length < 3000 && /verify (?:that )?you(?: are|'re) (?:a )?human|unusual traffic|checking your browser|access denied|enable javascript and cookies to continue|pardon our interruption/i.test(text))) {
    throw new ScrapeError('The website blocked browser access or requires human verification.', 502, 'PAGE_BLOCKED');
  }
  if (text.length > MAX_SCRAPE_CHARACTERS) throw new ScrapeError('The extracted page exceeds the 200,000-character limit.', 413, 'CONTENT_TOO_LARGE');
}

async function settle(page: Page) {
  let previous = '', stable = 0;
  for (let attempt = 0; attempt < 20; attempt++) {
    await page.waitForTimeout(250);
    const { text, title } = await readPage(page);
    checkContent(text, title);
    if (text === previous) stable++; else stable = 0;
    if (attempt >= 3 && stable >= 3) return;
    previous = text;
  }
  throw new ScrapeError('Page content kept changing; extraction could not finish within its limits.', 502, 'INCOMPLETE_CONTENT');
}

/** Only reveal on-page information. Product links, selectors, forms and offer changes are excluded. */
export async function extractPageContent(page: Page) {
  try {
    await page.waitForFunction(() => {
      const text = document.body?.innerText.trim();
      return text && !/^(loading|please wait)[.\s…]*$/i.test(text);
    }, undefined, { timeout: 15_000 });
  } catch (error) {
    if (!(error instanceof Error) || error.name !== 'TimeoutError') throw error;
    throw new ScrapeError('The website returned an empty page or did not render readable content.', 502, 'EMPTY_PAGE');
  }
  await settle(page);
  let bottomStable = 0, previousHeight = 0, finished = false;
  for (let step = 0; step < 20; step++) {
    const before = await page.evaluate(() => ({ height: document.documentElement.scrollHeight, bottom: window.scrollY + window.innerHeight }));
    await page.evaluate(() => window.scrollBy(0, Math.max(400, window.innerHeight * 0.85)));
    await page.waitForTimeout(350);
    const after = await page.evaluate(() => ({ height: document.documentElement.scrollHeight, bottom: window.scrollY + window.innerHeight }));
    if (after.bottom >= after.height - 4 && after.height === previousHeight && before.height === after.height) bottomStable++; else bottomStable = 0;
    previousHeight = after.height;
    if (bottomStable >= 2) { finished = true; break; }
  }
  if (!finished) throw new ScrapeError('The page continues loading content beyond the scroll limit. Extraction is incomplete.', 502, 'INCOMPLETE_CONTENT');
  await settle(page);

  // Native details can be opened without clicking arbitrary page actions.
  const details = page.locator('details:not([open])');
  const detailsCount = await details.count();
  if (detailsCount > 20) throw new ScrapeError('The page has too many collapsed sections to extract completely.', 502, 'INCOMPLETE_CONTENT');
  await details.evaluateAll(elements => { for (const element of elements) (element as HTMLDetailsElement).open = true; });
  if (detailsCount) await settle(page);
  const parts: string[] = [];
  const seen = new Set<string>();
  const collect = async (label = '') => {
    const { text, title } = await readPage(page);
    checkContent(text, title);
    const fresh = text.split(/\n\n+/).filter(block => { if (seen.has(block)) return false; seen.add(block); return true; });
    if (fresh.length) parts.push((label ? label + '\n\n' : '') + fresh.join('\n\n'));
    if (parts.join('\n\n').length > MAX_SCRAPE_CHARACTERS) throw new ScrapeError('The extracted page exceeds the 200,000-character limit.', 413, 'CONTENT_TOO_LARGE');
  };
  await collect();
  const contentLabel = /^(?:(?:view|show|read|see) (?:more|all)(?: (?:details|information|specifications|description|features))?|(?:product |technical )?(?:details|description|specifications|information|features)|overview)\s*(?:\(\d+\))?\s*[+−-]?$/i;
  const controls = page.getByRole('button', { name: contentLabel }).or(page.getByRole('tab', { name: contentLabel }));
  const visited = new Set<string>();
  let opened = 0;
  // ponytail: semantic, English content controls cover current catalog pages; add explicit site adapters only for proven gaps.
  for (let pass = 0; pass < 21; pass++) {
    let clicked = false;
    for (const control of await controls.all()) {
      if (!await control.isVisible() || !await control.isEnabled()) continue;
      const label = (await control.innerText()).trim() || await control.getAttribute('aria-label') || '';
      if (await control.getAttribute('aria-expanded') === 'true' || await control.getAttribute('aria-selected') === 'true') continue;
      const key = (await control.getAttribute('aria-controls') || '') + ':' + label;
      if (visited.has(key)) continue;
      if (opened >= 20) throw new ScrapeError('The page has more content sections than the interaction limit allows.', 502, 'INCOMPLETE_CONTENT');
      // A tab implemented as a link must target only a fragment of the same document.
      const href = await control.getAttribute('href');
      if (href && !href.startsWith('#')) continue;
      if (await control.evaluate(element => Boolean(element.closest('form')))) continue;
      visited.add(key); opened++;
      await control.click({ timeout: 3000, noWaitAfter: true });
      await settle(page); await collect(label);
      clicked = true; break;
    }
    if (!clicked) break;
  }
  const text = parts.join('\n\n').trim();
  if (!text) throw new ScrapeError('The page contains no readable content after removing navigation and forms.', 502, 'EMPTY_PAGE');
  return text;
}

export async function scrapeWithAgent(
  rawUrl: string, signal: AbortSignal,
  launchBrowser = launchScrapeBrowser, createProxy = startScrapeProxy,
) {
  const { url } = validateScrapeInput({ url: rawUrl });
  const release = await acquireScrapeSlot(signal);
  const execution = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
  let browser: Browser | undefined;
  let proxy: Awaited<ReturnType<typeof startScrapeProxy>> | undefined;
  const abort = () => { void browser?.close().catch(() => {}); void proxy?.close().catch(() => {}); };
  execution.addEventListener('abort', abort, { once: true });
  try {
    execution.throwIfAborted();
    proxy = await createProxy();
    execution.throwIfAborted();
    try { browser = await launchBrowser({ server: proxy.server }); }
    catch (error) {
      if (error instanceof ScrapeError) throw error;
      throw new ScrapeError('The scraper browser could not start. Check its installation and system libraries on the server.', 503, 'BROWSER_UNAVAILABLE');
    }
    execution.throwIfAborted();
    const context = await browser.newContext({ acceptDownloads: false, serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    let navigationLocked = false;
    let navigationError: ScrapeError | undefined;
    await context.route('**/*', async route => {
      const request = route.request();
      try { validateScrapeInput({ url: request.url() }); }
      catch { await route.abort('blockedbyclient'); return; }
      if (request.isNavigationRequest()) {
        if (request.frame() !== page.mainFrame() || navigationLocked || request.method() !== 'GET') {
          if (request.frame() === page.mainFrame()) navigationError = new ScrapeError('The page tried to navigate away during extraction.', 502, 'PAGE_CHANGED');
          await route.abort('blockedbyclient'); return;
        }
      }
      if (['image', 'media', 'font'].includes(request.resourceType())) { await route.abort(); return; }
      await route.continue();
    });
    await context.routeWebSocket('**/*', socket => socket.close());
    context.on('page', popup => { if (popup !== page) void popup.close().catch(() => {}); });
    let response;
    try { response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 }); }
    catch { throw proxy.blocked ?? new ScrapeError('The browser could not load the supplied page.', 502, 'PAGE_UNAVAILABLE'); }
    if (response && !response.ok()) throw new ScrapeError(`The website returned HTTP ${response.status()}.`, 502, [401, 403, 429].includes(response.status()) ? 'PAGE_BLOCKED' : 'PAGE_UNAVAILABLE');
    const finalUrl = new URL(validateScrapeInput({ url: page.url() }).url);
    const requested = new URL(url);
    if (requested.hostname.replace(/^www\./, '') !== finalUrl.hostname.replace(/^www\./, '') ||
        requested.pathname.replace(/\/$/, '') !== finalUrl.pathname.replace(/\/$/, '') ||
        [...requested.searchParams.keys()].some(key => JSON.stringify(requested.searchParams.getAll(key)) !== JSON.stringify(finalUrl.searchParams.getAll(key)))) {
      throw new ScrapeError('The website redirected to a different page or changed the supplied offer parameters.', 502, 'PAGE_CHANGED');
    }
    navigationLocked = true;
    const text = await extractPageContent(page);
    execution.throwIfAborted();
    if (navigationError) throw navigationError;
    if (page.url().split('#')[0] !== finalUrl.href) throw new ScrapeError('The page changed its URL during extraction.', 502, 'PAGE_CHANGED');
    return text + '\n\nSource: <' + url + '>' + (finalUrl.href !== url ? '\nRetrieved URL: <' + finalUrl.href + '>' : '');
  } catch (error) {
    if (execution.aborted) throw new ScrapeError(signal.aborted ? 'URL retrieval was cancelled.' : 'Browser retrieval exceeded its 120-second deadline.', 504, signal.aborted ? 'CANCELLED' : 'TIMEOUT');
    if (error instanceof ScrapeError) throw error;
    throw new ScrapeError('The page could not be extracted completely. Try the URL again.', 502, 'INCOMPLETE_CONTENT');
  } finally {
    execution.removeEventListener('abort', abort);
    await browser?.close().catch(() => {});
    await proxy?.close().catch(() => {});
    release();
  }
}
