import type { Express } from 'express';
import type { Pool, PoolClient } from 'pg';
import { setTimeout as delay } from 'node:timers/promises';
import { fetchChatCompletion, ProviderError, providerResponseError } from '../lib/chatCompletion';
import { DEFAULT_SETTINGS, editableSettings, normalizeSettings, type AppSettings } from '../lib/providerSettings';
import { extractLLMResponseContent } from '../lib/llmResponse';
import { transaction } from './database';

export function getProviderCredentials() {
  let baseUrl = process.env.LLM_BASE_URL?.trim();
  let apiKey = process.env.LLM_API_KEY?.trim();
  // Use the existing AI Credits key only with its own gateway; never mix a legacy key with an override.
  if (!baseUrl && !apiKey && process.env.AICREDITS_API_KEY?.trim()) {
    baseUrl = 'https://api.aicredits.in/v1';
    apiKey = process.env.AICREDITS_API_KEY.trim();
  }
  if (!baseUrl || !apiKey) throw new ProviderError('Configure both LLM_BASE_URL and LLM_API_KEY on the server, or use AICREDITS_API_KEY without LLM overrides.', 503);
  let url: URL;
  try { url = new URL(baseUrl); } catch { throw new ProviderError('Invalid server LLM_BASE_URL.', 503); }
  if (!['https:', ...(process.env.NODE_ENV !== 'production' ? ['http:'] : [])].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new ProviderError('Invalid server LLM_BASE_URL.', 503);
  return { baseUrl, apiKey };
}
export async function initializeProvider(pool: Pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS provider_settings (id text PRIMARY KEY CHECK(id='default'), settings jsonb NOT NULL);
    INSERT INTO provider_settings VALUES ('default','{}') ON CONFLICT DO NOTHING`);
  // Scraping is credential-independent; remove retired navigation settings on every startup.
  await pool.query(`UPDATE provider_settings SET settings = settings - 'scrapperModelName' - 'navigationModelInitialized' - 'scraperTimeout'
    WHERE id='default' AND settings ?| ARRAY['scrapperModelName','navigationModelInitialized','scraperTimeout']`);
}
export async function getProviderSettings(pool: Pool | PoolClient): Promise<AppSettings> {
  const { rows: [row] } = await pool.query("SELECT p.settings, q.memory FROM provider_settings p JOIN qa_agent_settings q ON q.id=p.id WHERE p.id='default'");
  if (!row) throw new ProviderError('Provider settings unavailable', 503);
  let providerConfigured = false;
  try { getProviderCredentials(); providerConfigured = true; } catch { /* Report configuration state without exposing secrets. */ }
  return normalizeSettings({ ...row.settings, qaAgentMemory: row.memory, providerConfigured });
}
export function validateSettings(value: any) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !Object.keys(editableSettings(DEFAULT_SETTINGS)).includes(key)) ||
    typeof value.modelName !== 'string' || !value.modelName.trim() || value.modelName.length > 256 ||
    typeof value.temperature !== 'number' || !Number.isFinite(value.temperature) || value.temperature < 0 || value.temperature > 1 ||
    !Number.isSafeInteger(value.maxTokens) || value.maxTokens < 1 || value.maxTokens > 65536 ||
    !Number.isSafeInteger(value.maxPageContentLength) || value.maxPageContentLength < 1 || value.maxPageContentLength > 200000 ||
    typeof value.qaAgentMemory !== 'string' || value.qaAgentMemory.length > 200000) throw new ProviderError('Invalid model settings or unsupported fields', 400);
  return editableSettings(normalizeSettings(value));
}
export async function completeQa(payload: unknown, signal: AbortSignal, options: {
  attempts?: number; beforeAttempt?: (attempt: number) => Promise<void>;
  lastError?: string | null; onAttemptError?: (attempt: number, error: ProviderError) => Promise<void>;
} = {}) {
  const exhaustedMessage = options.lastError?.trim()
    ? `QA exhausted its three-attempt budget. Last recorded failure: ${options.lastError} Start a fresh run to retry this SKU.`
    : 'QA used all three attempts before a result was saved; execution was interrupted. Start a fresh run to retry this SKU.';
  signal.throwIfAborted();
  if ((options.attempts ?? 0) >= 3) throw new ProviderError(exhaustedMessage);
  const { baseUrl, apiKey } = getProviderCredentials();
  for (let attempt = (options.attempts ?? 0) + 1; attempt <= 3; attempt++) {
    signal.throwIfAborted();
    try {
      const response = await fetchChatCompletion(baseUrl, apiKey, payload, signal, () => options.beforeAttempt?.(attempt) ?? Promise.resolve(), 120_000);
      if (!response.ok) throw await providerResponseError(response, apiKey);
      try { return await response.json(); } catch { throw new ProviderError('Model returned invalid JSON'); }
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof ProviderError) await options.onAttemptError?.(attempt, error);
      signal.throwIfAborted();
      if (!(error instanceof ProviderError) || !error.retryable || attempt === 3) throw error;
      if (error.retryAfterMs > 300000) throw new ProviderError('Provider requested a retry beyond the job deadline', 429);
      await delay(Math.max(attempt * 1000, Number.isFinite(error.retryAfterMs) ? error.retryAfterMs : 0), undefined, { signal });
    }
  }
  signal.throwIfAborted();
  throw new ProviderError(exhaustedMessage);
}
export function registerProviderRoutes(app: Express, pool: Pool) {
  app.get('/api/provider-settings', async (_req, res) => { res.json(await getProviderSettings(pool)); });
  app.put('/api/provider-settings', async (req, res) => {
    if (res.locals.user?.role !== 'admin') { res.status(403).json({ error: 'Administrator access required' }); return; }
    const settings = validateSettings(req.body);
    await transaction(pool, async client => {
      await client.query("UPDATE provider_settings SET settings=$1::jsonb WHERE id='default'", [JSON.stringify(settings)]);
      await client.query("UPDATE qa_agent_settings SET memory=$1,updated_at=now() WHERE id='default'", [settings.qaAgentMemory]);
    });
    res.json(await getProviderSettings(pool));
  });
  app.post('/api/chat', async (req, res) => {
    if (res.locals.user?.role !== 'admin') { res.status(403).json({ error: 'Administrator access required' }); return; }
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) ||
      Object.keys(req.body).some(key => !['modelName', 'purpose'].includes(key)) ||
      (req.body.purpose !== undefined && req.body.purpose !== 'qa') ||
      (req.body.modelName !== undefined && (typeof req.body.modelName !== 'string' || !req.body.modelName.trim() || req.body.modelName.length > 256))) {
      res.status(400).json({ error: 'Test API accepts optional modelName and purpose (qa) only' }); return;
    }
    const controller = new AbortController();
    const disconnect = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', disconnect);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]);
    try {
      const credentials = getProviderCredentials();
      const purpose = req.body.purpose ?? 'qa';
      let modelName = req.body.modelName?.trim();
      if (modelName === undefined) {
        const settings = await getProviderSettings(pool);
        modelName = settings.modelName;
      }
      signal.throwIfAborted();
      const response = await fetchChatCompletion(credentials.baseUrl, credentials.apiKey, {
        model: modelName, max_tokens: DEFAULT_SETTINGS.maxTokens,
        messages: [{ role: 'user', content: 'Reply with OK to confirm API connectivity.' }],
      }, signal);
      if (!response.ok) throw await providerResponseError(response, credentials.apiKey);
      let data: any;
      try { data = await response.json(); } catch { throw new ProviderError('Model returned invalid JSON'); }
      if (data?.choices?.[0]?.message?.refusal || ['length', 'content_filter'].includes(data?.choices?.[0]?.finish_reason)) throw new ProviderError('Model test was refused or truncated');
      if (!extractLLMResponseContent(data).trim()) throw new ProviderError('Model returned an empty response');
      signal.throwIfAborted();
      if (!res.destroyed) res.json({ success: true, purpose, modelName });
    } catch (error) {
      const known = error instanceof ProviderError;
      if (!res.destroyed) res.status(known ? error.status : controller.signal.aborted || (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) ? 504 : 502)
        .json({ error: known ? error.message : 'Model test failed or timed out. Check the server provider configuration.' });
    } finally { res.removeListener('close', disconnect); }
  });
}
