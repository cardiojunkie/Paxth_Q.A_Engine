import { lookup } from 'node:dns/promises';
import { bufferResponse } from './chatCompletion';
import { ScrapeError, resolvePublicAddress, validateScrapeInput, type ScrapeReport } from './scrapeNetwork';
export { ScrapeError, isPublicAddress, validateScrapeInput } from './scrapeNetwork';
export type { ScrapeReport } from './scrapeNetwork';

export const MAX_SCRAPE_CHARACTERS = 200_000;
export type ScrapedPage = {
  markdown: string; requestedUrl: string; finalUrl: string | null; capturedAt?: string | null;
  method?: 'cloud' | 'browser'; receivedAt?: string; crawler?: 'crawl4ai'; modelName?: string;
};
export type ScrapePreview = ScrapedPage & { status: 'collected' | 'partial'; capturedAt: string | null; report: ScrapeReport };

export function getScraperApiKey() {
  const key = process.env.CRAWL4AI_API_KEY?.trim();
  if (!key) throw new ScrapeError('Configure CRAWL4AI_API_KEY on the server to scrape URLs.', 503, 'SCRAPER_NOT_CONFIGURED');
  return key;
}

let active = false;
const waiting: Array<{ start: () => void }> = [];

// shortcut: process-local admission serves one backend, share admission before adding replicas.
export async function acquireScrapeSlot(signal: AbortSignal, waitMs = 60_000) {
  signal.throwIfAborted();
  if (!active) active = true;
  else {
    if (waiting.length >= 8) throw new ScrapeError('The scraping queue is full. Retry shortly.', 503, 'QUEUE_FULL');
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
      const fail = (error: unknown) => {
        const index = waiting.indexOf(entry);
        if (index >= 0) waiting.splice(index, 1);
        cleanup(); reject(error);
      };
      const abort = () => fail(signal.reason);
      const entry = { start: () => { cleanup(); resolve(); } };
      const timer = setTimeout(() => fail(new ScrapeError('Timed out waiting for scraping.', 503, 'QUEUE_TIMEOUT')), waitMs);
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

function cloudFailure(status: number, reason: unknown) {
  if (reason === 'blocked') return new ScrapeError('The website blocked Crawl4AI access. Supply page content manually.', 502, 'PAGE_BLOCKED');
  if (reason === 'login-wall') return new ScrapeError('The page requires a login or payment. Supply page content manually.', 502, 'PAGE_LOGIN_REQUIRED');
  if (reason === 'cooldown') return new ScrapeError('Crawl4AI placed this page in a temporary retrieval cooldown. Retry later or supply page content manually.', 502, 'PAGE_UNAVAILABLE');
  if (status === 401 || status === 403) return new ScrapeError('Crawl4AI rejected the server API key. Check CRAWL4AI_API_KEY.', 502, 'SCRAPER_AUTH_FAILED');
  if (status === 402) return new ScrapeError(reason === 'spend_cap' ? 'Crawl4AI monthly spending cap reached.'
    : reason === 'plan_cap' ? 'Crawl4AI monthly plan allowance exhausted.' : 'Crawl4AI credits exhausted. Check the account balance.', 402, 'SCRAPER_CREDITS_EXHAUSTED');
  if (status === 429) return new ScrapeError('Crawl4AI rate limit reached. Retry later.', 429, 'RATE_LIMITED');
  if (status === 503) return new ScrapeError('Crawl4AI is busy or unavailable. Retry shortly.', 503, 'FLEET_BUSY');
  if (status === 408 || status === 504) return new ScrapeError('Crawl4AI page retrieval timed out.', 504, 'TIMEOUT');
  if (status === 400) return new ScrapeError('Crawl4AI rejected the URL. Use a public HTTP(S) page.', 400, 'INVALID_URL');
  if (status >= 300 && status < 400) return new ScrapeError('Crawl4AI API redirects are not accepted.', 502, 'API_REDIRECT');
  return new ScrapeError(`Crawl4AI could not retrieve readable page content (HTTP ${status}).`, 502, 'PAGE_UNAVAILABLE');
}

export async function collectPage(rawUrl: string, signal: AbortSignal, resolve = lookup): Promise<ScrapePreview> {
  if (signal.aborted) throw new ScrapeError('URL retrieval was cancelled.', 499, 'CANCELLED');
  const apiKey = getScraperApiKey();
  const { url } = validateScrapeInput({ url: rawUrl });
  const started = performance.now();
  const release = await acquireScrapeSlot(signal).catch(error => {
    if (signal.aborted) throw new ScrapeError('URL retrieval was cancelled.', 499, 'CANCELLED');
    throw error;
  });
  const execution = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
  const report: ScrapeReport = { durationMs: 0, characters: 0, warnings: [] };
  try {
    await resolvePublicAddress(new URL(url), resolve, execution);
    execution.throwIfAborted();
    const response = await fetch('https://api.crawl4ai.com/scrape', {
      method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ url, format: 'md' }), signal: execution,
    });
    const buffered = await bufferResponse(response, execution, new ScrapeError('Crawl4AI response exceeded 4 MiB.', 413, 'CONTENT_TOO_LARGE'));
    const receivedAt = new Date().toISOString();
    const data = await buffered.json().catch(() => null);
    if (!response.ok) throw cloudFailure(response.status, data?.error ?? data?.reason);
    if (!data || data.ok !== true) throw new ScrapeError('Crawl4AI returned an invalid or unsuccessful response.', 502, 'INVALID_RESPONSE');
    if (typeof data.markdown !== 'string' || !data.markdown.trim()) throw new ScrapeError('Crawl4AI returned no readable page content.', 502, 'EMPTY_PAGE');
    if (data.markdown.length > MAX_SCRAPE_CHARACTERS) throw new ScrapeError('The extracted page exceeds 200,000 characters.', 413, 'CONTENT_TOO_LARGE');
    execution.throwIfAborted();
    report.durationMs = Math.round(performance.now() - started);
    report.characters = data.markdown.length;
    // shortcut: the cloud contract does not report redirects or capture time, record them only when the API supports them.
    return { status: 'collected', method: 'cloud', crawler: 'crawl4ai', markdown: data.markdown,
      requestedUrl: url, finalUrl: null, capturedAt: null, receivedAt, report };
  } catch (error) {
    const cause = (error as { cause?: { code?: unknown; errors?: Array<{ code?: unknown }> } })?.cause;
    const codes = [(error as { code?: unknown })?.code, cause?.code, ...(Array.isArray(cause?.errors) ? cause.errors.map(item => item?.code) : [])];
    const code = codes.find(code => typeof code === 'string' && ['ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT'].includes(code));
    const networkCode = typeof code === 'string' ? ` (${code})` : '';
    const failure = signal.aborted ? new ScrapeError('URL retrieval was cancelled.', 499, 'CANCELLED')
      : execution.aborted ? new ScrapeError('Crawl4AI retrieval exceeded its 120-second deadline.', 504, 'TIMEOUT')
      : error instanceof ScrapeError ? error
      : new ScrapeError(`Crawl4AI connection to api.crawl4ai.com or public URL lookup failed${networkCode}. Check server network access.`, 502, 'CONNECTION_FAILED');
    failure.report = { ...report, durationMs: Math.round(performance.now() - started), characters: 0 };
    throw failure;
  } finally { release(); }
}
