import { spawn } from 'node:child_process';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';
import { ScrapeError, startScrapeProxy, validateScrapeInput } from './scrapeNetwork';
export { ScrapeError, isPublicAddress, validateScrapeInput } from './scrapeNetwork';

export const MAX_SCRAPE_CHARACTERS = 200_000;
export type ScrapedPage = { markdown: string; requestedUrl: string; finalUrl: string };
let active = false;
const waiting: Array<{ start: () => void }> = [];

// ponytail: process-local queue serves one backend; share admission before adding replicas.
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
      const timer = setTimeout(() => fail(new ScrapeError('Timed out waiting for the browser.', 503, 'QUEUE_TIMEOUT')), waitMs);
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

const WORKER_ERRORS: Record<string, [number, string]> = {
  BROWSER_UNAVAILABLE: [503, 'The browser worker is unavailable. Run npm run setup:scraper and install the documented system dependencies.'],
  PAGE_BLOCKED: [502, 'The website blocked access or requires human verification. Supply page content manually.'],
  PAGE_UNAVAILABLE: [502, 'The browser could not load the supplied page.'],
  PAGE_CHANGED: [502, 'The page navigated away or changed the supplied product/offer parameters.'],
  EMPTY_PAGE: [502, 'The page contains no readable content.'],
  CONTENT_TOO_LARGE: [413, 'The extracted page exceeds its content limit.'],
  INCOMPLETE_CONTENT: [502, 'The page could not be extracted completely within its interaction limits. Supply the remaining content manually.'],
  TIMEOUT: [504, 'Browser retrieval exceeded its 120-second deadline.'],
};
const STARTUP_ERRORS: Record<string, string> = {
  BINARY_MISSING: 'The CloakBrowser binary is missing. Run npm run setup:scraper as the application user.',
  SYSTEM_DEPENDENCIES_MISSING: 'Chromium system libraries or fonts are missing. Rebuild the development container or install the system dependencies in docs/browser-scraper.md, then run npm run setup:scraper.',
  DISPLAY_UNAVAILABLE: 'The browser cannot connect to DISPLAY. Unset DISPLAY to use Xvfb, or start the configured X server.',
  PYTHON_DEPENDENCIES_MISSING: 'Python worker packages are missing. Run npm run setup:scraper with the same SCRAPER_PYTHON used by the application.',
};

export async function runScrapeWorker(input: unknown, signal: AbortSignal, worker = path.resolve('scraper/browser_scrape.py')): Promise<any> {
  signal.throwIfAborted();
  const python = process.env.SCRAPER_PYTHON || path.resolve('.venv/bin/python');
  const xvfb = process.env.SCRAPER_HEADLESS !== 'true' && !process.env.DISPLAY;
  const temporary = await mkdtemp(path.join(tmpdir(), 'paxth-browser-'));
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'LD_LIBRARY_PATH', 'DISPLAY', 'FONTCONFIG_FILE', 'FONTCONFIG_PATH', 'SCRAPER_HEADLESS', 'CLOAKBROWSER_VERSION', 'CLOAKBROWSER_BINARY_PATH', 'CLOAKBROWSER_LICENSE_KEY']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  Object.assign(env, { TMPDIR: temporary, CLOAKBROWSER_AUTO_UPDATE: 'false', ANONYMIZED_TELEMETRY: 'false', PYTHONUNBUFFERED: '1' });
  const child = spawn(xvfb ? 'xvfb-run' : python, xvfb ? ['-a', python, worker] : [worker], { detached: true, stdio: ['pipe', 'pipe', 'pipe'], env });
  let output = '', size = 0, failure: Error | undefined;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  // Playwright launches Chromium in its own process group. Remember descendants
  // while their parent lives, including start times to avoid killing reused PIDs.
  const descendants = new Map<number, string>();
  const started = (pid: number) => readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')[19];
  const track = (pid = child.pid) => {
    if (!pid) return;
    try {
      for (const id of readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').trim().split(/\s+/).filter(Boolean)) {
        const descendant = Number(id);
        descendants.set(descendant, started(descendant)); track(descendant);
      }
    } catch { /* The process exited between reads. */ }
  };
  const tracker = setInterval(() => track(), 250);
  tracker.unref();
  const kill = (force = false) => {
    track();
    if (force) for (const [pid, start] of [...descendants].reverse()) {
      try { if (started(pid) === start) process.kill(pid, 'SIGKILL'); } catch { /* Already exited. */ }
    }
    if (child.pid) { try { process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM'); } catch { /* Process group already exited. */ } }
  };
  const stop = () => { kill(); killTimer ??= setTimeout(() => kill(true), 2000); };
  const abort = () => { failure = signal.reason; stop(); };
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort(); // Cancellation may arrive while mkdtemp is awaiting I/O.
  // Library logs and page text never become public error details.
  child.stderr.resume();
  child.stdin.on('error', () => {});
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    size += Buffer.byteLength(chunk);
    if (size > 4 * 1024 * 1024) { failure = new ScrapeError('Worker output exceeded 4 MiB.', 413, 'CONTENT_TOO_LARGE'); stop(); }
    else output += chunk;
  });
  try {
    await new Promise<void>((resolve, reject) => {
      child.once('error', (error: NodeJS.ErrnoException) => reject(new ScrapeError(error.code === 'ENOENT'
        ? xvfb ? 'xvfb-run is missing from PATH. Rebuild the development container or install xvfb and xauth, then run npm run setup:scraper.'
          : 'The Python worker executable is missing. Check SCRAPER_PYTHON and run npm run setup:scraper.'
        : WORKER_ERRORS.BROWSER_UNAVAILABLE[1], 503, 'BROWSER_UNAVAILABLE')));
      child.once('close', () => resolve());
      child.stdin.end(JSON.stringify(input));
    });
    signal.throwIfAborted();
    if (failure) throw failure;
    let result: any;
    try { result = JSON.parse(output); } catch { throw new ScrapeError('Browser worker stopped without a valid result.', 503, 'BROWSER_UNAVAILABLE'); }
    if (result?.error) {
      const code = Object.hasOwn(WORKER_ERRORS, result.code) ? result.code : 'INCOMPLETE_CONTENT';
      const [status, message] = WORKER_ERRORS[code];
      throw new ScrapeError(code === 'BROWSER_UNAVAILABLE' && Object.hasOwn(STARTUP_ERRORS, result.reason) ? STARTUP_ERRORS[result.reason] : message, status, code);
    }
    return result;
  } finally {
    signal.removeEventListener('abort', abort);
    if (killTimer) clearTimeout(killTimer);
    clearInterval(tracker);
    kill(true);
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function scrapePage(rawUrl: string, signal: AbortSignal, createProxy = startScrapeProxy): Promise<ScrapedPage> {
  const { url } = validateScrapeInput({ url: rawUrl });
  const release = await acquireScrapeSlot(signal).catch(error => {
    if (signal.aborted) throw new ScrapeError('URL retrieval was cancelled.', 499, 'CANCELLED');
    throw error;
  });
  const execution = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
  let proxy: Awaited<ReturnType<typeof startScrapeProxy>> | undefined;
  try {
    execution.throwIfAborted();
    proxy = await createProxy(undefined, undefined, execution);
    const result = await runScrapeWorker({ url, proxy: proxy.server }, execution);
    if (typeof result?.markdown !== 'string' || !result.markdown.trim()) throw new ScrapeError(WORKER_ERRORS.EMPTY_PAGE[1], 502, 'EMPTY_PAGE');
    const finalUrl = validateScrapeInput({ url: result.finalUrl }).url;
    const requested = new URL(url), final = new URL(finalUrl);
    if (requested.hostname.replace(/^www\./, '') !== final.hostname.replace(/^www\./, '') ||
        requested.pathname.replace(/\/$/, '') !== final.pathname.replace(/\/$/, '') ||
        [...requested.searchParams.keys()].some(key => JSON.stringify(requested.searchParams.getAll(key)) !== JSON.stringify(final.searchParams.getAll(key))) ||
        [...final.searchParams.keys()].some(key => !requested.searchParams.has(key) && /variant|offer|seller|sku|product|color|colour|size|quantity/i.test(key))) {
      throw new ScrapeError(WORKER_ERRORS.PAGE_CHANGED[1], 502, 'PAGE_CHANGED');
    }
    const markdown = `${result.markdown.trim()}\n\nSource: <${url}>${finalUrl !== url ? `\nRetrieved URL: <${finalUrl}>` : ''}`;
    if (markdown.length > MAX_SCRAPE_CHARACTERS) throw new ScrapeError(WORKER_ERRORS.CONTENT_TOO_LARGE[1], 413, 'CONTENT_TOO_LARGE');
    return { markdown, requestedUrl: url, finalUrl };
  } catch (error) {
    if (execution.aborted) throw new ScrapeError(signal.aborted ? 'URL retrieval was cancelled.' : WORKER_ERRORS.TIMEOUT[1], signal.aborted ? 499 : 504, signal.aborted ? 'CANCELLED' : 'TIMEOUT');
    if (error instanceof ScrapeError) throw error;
    throw new ScrapeError('The browser service could not complete retrieval.', 502, 'RETRIEVAL_FAILED');
  } finally {
    await proxy?.close();
    release();
  }
}
