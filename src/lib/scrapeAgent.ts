import { bufferResponse } from './chatCompletion';
import { ScrapeError, resolvePublicAddress, validateScrapeInput } from './scrapeNetwork';
import type { ScrapeSettings } from './scrapeRequest';
export { ScrapeError, isPublicAddress, validateScrapeInput } from './scrapeNetwork';

export const MAX_SCRAPE_CHARACTERS = 200_000;
export type ScrapeConfiguration = ScrapeSettings & { apiKey: string | null };
const API = 'https://v2-api.scrapegraphai.com/api';

export function validateScrapeKey(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 512 || !/^[!-~]+$/.test(value.trim())) {
    throw new ScrapeError('Enter a valid ScrapeGraph API key (up to 512 characters, without whitespace).', 400, 'INVALID_API_KEY');
  }
  return value.trim();
}

export function validateScrapeSettings(value: any): ScrapeSettings {
  if (!value || !['auto', 'fast', 'js'].includes(value.mode) || typeof value.stealth !== 'boolean' ||
      !Number.isSafeInteger(value.wait) || value.wait < 0 || value.wait > 30000 ||
      !Number.isSafeInteger(value.scrolls) || value.scrolls < 0 || value.scrolls > 100) {
    throw new ScrapeError('Choose auto, fast, or js rendering, a stealth toggle, wait time 0–30000 ms, and scroll count 0–100.', 400, 'INVALID_SETTINGS');
  }
  return { mode: value.mode, stealth: value.stealth, wait: value.wait, scrolls: value.scrolls };
}

function requestError(error: unknown, signal: AbortSignal): never {
  if ((signal.aborted && signal.reason?.name === 'TimeoutError') || (error instanceof Error && error.name === 'TimeoutError')) {
    throw new ScrapeError('ScrapeGraph retrieval timed out. Try again or adjust loading settings.', 504, 'TIMEOUT');
  }
  if (signal.aborted) throw new ScrapeError('URL retrieval was cancelled.', 499, 'CANCELLED');
  if (error instanceof ScrapeError) throw error;
  throw new ScrapeError('Could not connect to ScrapeGraph. Try again shortly.', 502, 'CONNECTION_FAILED');
}

async function requestScrapeGraph(path: 'scrape' | 'credits', apiKey: string | null, signal: AbortSignal, body?: unknown) {
  signal.throwIfAborted();
  if (!apiKey) throw new ScrapeError('Save your ScrapeGraph API key in Scrapper agent before retrieving URLs.', 503, 'API_KEY_REQUIRED');
  const response = await bufferResponse(await fetch(`${API}/${path}`, {
    method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal,
    headers: { 'SGAI-APIKEY': validateScrapeKey(apiKey), ...(body !== undefined && { 'Content-Type': 'application/json' }) },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  }), signal, new ScrapeError('The ScrapeGraph response exceeded the 4 MiB limit.', 413, 'CONTENT_TOO_LARGE'));
  if (!response.ok) {
    // Fixed messages keep upstream credentials and arbitrary response text out of logs and evidence.
    if ([401, 403].includes(response.status)) throw new ScrapeError('ScrapeGraph rejected your API key. Replace it in Scrapper agent.', 502, 'INVALID_API_KEY');
    if (response.status === 402) throw new ScrapeError('Your ScrapeGraph account has insufficient credits. Top up or replace your API key.', 402, 'INSUFFICIENT_CREDITS');
    if (response.status === 429) throw new ScrapeError('ScrapeGraph rate limit reached. Wait before trying again.', 429, 'RATE_LIMITED');
    if ([408, 504].includes(response.status)) throw new ScrapeError('ScrapeGraph retrieval timed out. Try again or adjust loading settings.', 504, 'TIMEOUT');
    throw new ScrapeError(`ScrapeGraph could not process the request (HTTP ${response.status}). Check the URL and try again.`, 502, 'PAGE_UNAVAILABLE');
  }
  try { return await response.json(); }
  catch { throw new ScrapeError('ScrapeGraph returned an invalid response. Try again shortly.', 502, 'INVALID_RESPONSE'); }
}

export async function checkScrapeCredits(apiKey: string | null, signal: AbortSignal) {
  const execution = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
  try {
    const data = await requestScrapeGraph('credits', apiKey, execution);
    if (!Number.isFinite(data?.remaining) || data.remaining < 0 || !Number.isFinite(data?.used) || data.used < 0 || typeof data?.plan !== 'string') {
      throw new ScrapeError('ScrapeGraph returned an invalid credit balance.', 502, 'INVALID_RESPONSE');
    }
    return { remaining: data.remaining as number, used: data.used as number, plan: data.plan as string };
  } catch (error) { requestError(error, execution); }
}

export async function scrapeWithAgent(rawUrl: string, signal: AbortSignal, configuration: ScrapeConfiguration) {
  const execution = AbortSignal.any([signal, AbortSignal.timeout(120000)]);
  try {
    execution.throwIfAborted();
    const { url } = validateScrapeInput({ url: rawUrl });
    const settings = validateScrapeSettings(configuration);
    await resolvePublicAddress(new URL(url), undefined, execution);
    const data = await requestScrapeGraph('scrape', configuration.apiKey, execution, {
      url, formats: [{ type: 'markdown', mode: 'normal' }], fetchConfig: { ...settings, timeout: 60000 },
    });
    const parts: unknown = data?.results?.markdown?.data;
    if (!Array.isArray(parts) || !parts.every(part => typeof part === 'string')) {
      throw new ScrapeError('ScrapeGraph returned invalid Markdown content.', 502, 'INVALID_RESPONSE');
    }
    const text = parts.join('\n\n').trim();
    if (!text) throw new ScrapeError('The page contains no readable content.', 502, 'EMPTY_PAGE');
    // ponytail: common English challenge text; add signatures only for observed misses.
    if (/^(?:#+\s*)?(access denied|just a moment|attention required|robot check|pardon our interruption)\b/i.test(text) ||
        (text.length < 3000 && /verify (?:that )?you(?: are|'re) (?:a )?human|unusual traffic|checking your browser|access denied|enable javascript and cookies to continue|pardon our interruption/i.test(text))) {
      throw new ScrapeError('The website blocked access or requires human verification.', 502, 'PAGE_BLOCKED');
    }
    const markdown = `${text}\n\nSource: <${url}>`;
    if (markdown.length > MAX_SCRAPE_CHARACTERS) throw new ScrapeError('The extracted page exceeds the 200,000-character limit.', 413, 'CONTENT_TOO_LARGE');
    return markdown;
  } catch (error) { requestError(error, execution); }
}
