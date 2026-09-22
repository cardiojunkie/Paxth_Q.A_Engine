import type { Express } from 'express';
import type { Pool, PoolClient } from 'pg';
import { setTimeout as delay } from 'node:timers/promises';
import { fetchChatCompletion, ProviderError } from '../lib/chatCompletion';
import { DEFAULT_SETTINGS, editableSettings, normalizeSettings, type AppSettings } from '../lib/providerSettings';
import { prepareQaInput } from '../lib/qaAgent';
import { buildQaRequest, parseQaResponse } from '../lib/qaRequest';
import { transaction } from './database';

export function getProviderCredentials() {
  const baseUrl = process.env.LLM_BASE_URL?.trim();
  const apiKey = process.env.LLM_API_KEY?.trim();
  if (!baseUrl || !apiKey) throw new ProviderError('Configure LLM_BASE_URL and LLM_API_KEY on the server.', 503);
  const url = new URL(baseUrl);
  if (!['https:', ...(process.env.NODE_ENV !== 'production' ? ['http:'] : [])].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new ProviderError('Invalid server LLM_BASE_URL.', 503);
  return { baseUrl, apiKey };
}
export async function initializeProvider(pool: Pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS provider_settings (id text PRIMARY KEY CHECK(id='default'), settings jsonb NOT NULL);
    INSERT INTO provider_settings VALUES ('default','{}') ON CONFLICT DO NOTHING`);
}
export async function getProviderSettings(pool: Pool | PoolClient): Promise<AppSettings> {
  const {rows:[row]} = await pool.query("SELECT p.settings, q.memory FROM provider_settings p JOIN qa_agent_settings q ON q.id=p.id WHERE p.id='default'");
  if (!row) throw new ProviderError('Provider settings unavailable', 503);
  let providerConfigured = false;
  try { getProviderCredentials(); providerConfigured = true; } catch { /* Report configuration state without exposing secrets. */ }
  return normalizeSettings({...row.settings, qaAgentMemory:row.memory, providerConfigured, baseUrl:process.env.LLM_BASE_URL || ''});
}
export function validateSettings(value: any) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !Object.keys(editableSettings(DEFAULT_SETTINGS)).includes(key)) ||
    typeof value.modelName !== 'string' || !value.modelName.trim() || value.modelName.length > 256 ||
    typeof value.temperature !== 'number' || !Number.isFinite(value.temperature) || value.temperature < 0 || value.temperature > 1 ||
    !Number.isSafeInteger(value.maxTokens) || value.maxTokens < 1 || value.maxTokens > 65536 ||
    !Number.isSafeInteger(value.maxPageContentLength) || value.maxPageContentLength < 1 || value.maxPageContentLength > 200000 ||
    typeof value.qaAgentMemory !== 'string' || value.qaAgentMemory.length > 200000) throw new ProviderError('Invalid model settings or unsupported fields',400);
  return editableSettings(normalizeSettings(value));
}
export async function completeQa(payload: unknown, signal: AbortSignal, options: {attempts?:number; beforeAttempt?:(attempt:number)=>Promise<void>} = {}) {
  const {baseUrl,apiKey} = getProviderCredentials();
  for (let attempt=(options.attempts ?? 0)+1; attempt<=3; attempt++) {
    signal.throwIfAborted();
    try {
      const response = await fetchChatCompletion(baseUrl,apiKey,payload,signal, () => options.beforeAttempt?.(attempt) ?? Promise.resolve());
      if (!response.ok) {
        const retryable = [408,429,500,502,503,504,529].includes(response.status);
        const retry = response.headers.get('retry-after');
        const retryAfterMs = retry ? /^\d+(\.\d+)?$/.test(retry) ? Number(retry)*1000 : Math.max(0,Date.parse(retry)-Date.now()) : 0;
        throw new ProviderError(`Model request failed (HTTP ${response.status}).`,response.status,retryable,retryAfterMs);
      }
      try { return await response.json(); } catch { throw new ProviderError('Model returned invalid JSON'); }
    } catch (error) {
      signal.throwIfAborted();
      if (!(error instanceof ProviderError) || !error.retryable || attempt === 3) throw error;
      if (error.retryAfterMs > 300000) throw new ProviderError('Provider requested a retry beyond the job deadline',429);
      await delay(Math.max(attempt*1000,Number.isFinite(error.retryAfterMs)?error.retryAfterMs:0),undefined,{signal});
    }
  }
  throw new ProviderError('The three-attempt budget has been exhausted');
}
export function registerProviderRoutes(app: Express,pool: Pool) {
  app.get('/api/provider-settings',async (_req,res) => { res.json(await getProviderSettings(pool)); });
  app.put('/api/provider-settings',async (req,res) => {
    if (res.locals.user?.role !== 'admin') { res.status(403).json({error:'Administrator access required'}); return; }
    const settings = validateSettings(req.body);
    await transaction(pool,async client => {
      await client.query("UPDATE provider_settings SET settings=$1 WHERE id='default'",[JSON.stringify(settings)]);
      await client.query("UPDATE qa_agent_settings SET memory=$1,updated_at=now() WHERE id='default'",[settings.qaAgentMemory]);
    });
    res.json(await getProviderSettings(pool));
  });
  app.post('/api/chat',async (req,res) => {
    if (res.locals.user?.role !== 'admin') { res.status(403).json({error:'Administrator access required'}); return; }
    if (!req.body || Object.keys(req.body).length) { res.status(400).json({error:'This endpoint tests saved server settings only'}); return; }
    const controller = new AbortController();
    const disconnect=()=>{if(!res.writableEnded) controller.abort();};
    res.on('close',disconnect);
    try {
      const settings=await getProviderSettings(pool);
      const input=prepareQaInput({sku:'qa-connection-test',status:'ready',attribute_set:'API Test',upload_attributes:{brand:'TestBrand'},raw_row:{},source:{sap:'Brand: TestBrand'}},[],settings.qaAgentMemory,settings.maxPageContentLength);
      const data=await completeQa(buildQaRequest(settings,input).payload,AbortSignal.any([controller.signal,AbortSignal.timeout(300000)]));
      parseQaResponse(data,input);
      if (!res.destroyed) res.json({success:true,usage:data.usage});
    } finally {res.removeListener('close',disconnect);}
  });
}
