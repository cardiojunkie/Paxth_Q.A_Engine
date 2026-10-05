import { useEffect, useRef, useState, type FormEvent } from 'react';
import { DEFAULT_SCRAPE_SETTINGS, scrapeUrl, type ScrapeSettings, type ScraperSettings } from '../lib/scrapeRequest';
import { api } from '../lib/api';

export function ScrapperAgentModule() {
  const [url, setUrl] = useState('');
  const [markdown, setMarkdown] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sourceUrl, setSourceUrl] = useState('');
  const [settings, setSettings] = useState<ScraperSettings>({ ...DEFAULT_SCRAPE_SETTINGS, configured: false });
  const [draft, setDraft] = useState<ScrapeSettings>(DEFAULT_SCRAPE_SETTINGS);
  const [apiKey, setApiKey] = useState('');
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsBusy, setSettingsBusy] = useState<'saving' | 'testing' | 'removing' | null>(null);
  const [settingsError, setSettingsError] = useState('');
  const [message, setMessage] = useState('');
  const [credits, setCredits] = useState<{ remaining: number; used: number; plan: string; draftKey: boolean } | null>(null);
  const mounted = useRef(true);
  const request = useRef<AbortController | null>(null);
  const settingsRequest = useRef<AbortController | null>(null);
  const dirty = apiKey.length > 0 || (Object.keys(DEFAULT_SCRAPE_SETTINGS) as (keyof ScrapeSettings)[]).some(key => draft[key] !== settings[key]);
  useEffect(() => {
    let active = true;
    mounted.current = true;
    settingsRequest.current = new AbortController();
    api<ScraperSettings>('/api/scraper-settings', { signal: settingsRequest.current.signal })
      .then(value => { if (active) { setSettings(value); setDraft({ mode: value.mode, stealth: value.stealth, wait: value.wait, scrolls: value.scrolls }); } })
      .catch(error => { if (active) setSettingsError(error.message); })
      .finally(() => { if (active) setSettingsLoading(false); });
    return () => { active = false; mounted.current = false; request.current?.abort(); settingsRequest.current?.abort(); };
  }, []);
  const change = <K extends keyof ScrapeSettings>(key: K, value: ScrapeSettings[K]) => {
    setDraft(previous => ({ ...previous, [key]: value })); setMessage(''); setSettingsError('');
  };
  const save = async (remove = false) => {
    if (settingsBusy || settingsLoading || loading) return;
    setSettingsBusy(remove ? 'removing' : 'saving'); setSettingsError(''); setMessage('');
    settingsRequest.current = new AbortController();
    try {
      const values = remove ? { mode: settings.mode, stealth: settings.stealth, wait: settings.wait, scrolls: settings.scrolls } : draft;
      const saved = await api<ScraperSettings>('/api/scraper-settings', {
        method: 'PUT', signal: settingsRequest.current.signal,
        body: JSON.stringify({ ...values, ...(remove ? { apiKey: null } : apiKey.length ? { apiKey } : {}) }),
      });
      if (mounted.current) {
        setSettings(saved); setDraft({ mode: saved.mode, stealth: saved.stealth, wait: saved.wait, scrolls: saved.scrolls });
        setApiKey(''); setCredits(null); setMessage(remove ? 'Your API key was removed.' : 'Personal scraper settings saved.');
      }
    } catch (error) { if (mounted.current) setSettingsError((error as Error).message); }
    finally { if (mounted.current) setSettingsBusy(null); }
  };
  const testKey = async () => {
    if (settingsBusy || settingsLoading || loading) return;
    setSettingsBusy('testing'); setSettingsError(''); setMessage(''); setCredits(null);
    settingsRequest.current = new AbortController();
    try {
      const result = await api<{ remaining: number; used: number; plan: string }>('/api/scraper-settings/test', {
        method: 'POST', signal: settingsRequest.current.signal, body: JSON.stringify(apiKey.length ? { apiKey } : {}),
      });
      if (mounted.current) setCredits({ ...result, draftKey: apiKey.length > 0 });
    } catch (error) { if (mounted.current) setSettingsError((error as Error).message); }
    finally { if (mounted.current) setSettingsBusy(null); }
  };
  const retrieve = async (event: FormEvent) => {
    event.preventDefault();
    if (loading || settingsBusy || settingsLoading || dirty || !settings.configured || !url.trim()) return;
    setLoading(true); setError(''); setMarkdown(''); setSourceUrl('');
    request.current = new AbortController();
    try {
      const result = await scrapeUrl(url, request.current.signal);
      if (mounted.current) {
        setMarkdown(result);
        const submitted = /^[a-z][a-z\d+.-]*:/i.test(url.trim()) ? url.trim() : 'https://' + url.trim();
        const parsed = new URL(submitted);
        setSourceUrl(['https:', 'http:'].includes(parsed.protocol) ? parsed.href : '');
      }
    }
    catch (error) { if (mounted.current) setError(request.current.signal.aborted ? 'URL retrieval was cancelled.' : (error as Error).message); }
    finally { if (mounted.current) setLoading(false); }
  };
  return <section className="flex-1 overflow-auto p-8 bg-[#FDFCFB]">
    <h2 className="text-2xl font-serif mb-4">Scrapper agent</h2>
    <p className="mb-4">Retrieve a public webpage as Markdown with ScrapeGraphAI. Your saved key and loading settings also apply to Dashboard scraping and jobs you start.</p>
    <form className="max-w-3xl mb-6 space-y-4 border rounded p-4" onSubmit={event => { event.preventDefault(); void save(); }}>
      <h3 className="text-lg font-semibold">Personal ScrapeGraph settings</h3>
      <p role="status">{settingsLoading ? 'Loading settings…' : settings.configured ? 'API key saved.' : 'No API key saved.'}</p>
      <fieldset disabled={settingsLoading || !!settingsBusy || loading} className="space-y-4 disabled:opacity-60">
        <label className="block">ScrapeGraph API key<input type="password" autoComplete="off" maxLength={512} className="block border p-2 w-full" value={apiKey} onChange={event => { setApiKey(event.target.value); setCredits(null); setSettingsError(''); setMessage(''); }} placeholder={settings.configured ? 'Enter a replacement key' : 'Enter your API key'} /></label>
        <p className="text-sm">The key is stored on the server for your account. Leave this field blank to keep the saved key. <a className="underline" href="https://scrapegraphai.com/dashboard" target="_blank" rel="noreferrer">Get a ScrapeGraph API key</a></p>
        <div><label className="block" htmlFor="scrape-mode">Rendering mode</label><select id="scrape-mode" className="block border p-2" value={draft.mode} onChange={event => change('mode', event.target.value as ScrapeSettings['mode'])}>
          <option value="auto">Auto</option><option value="fast">Fast</option><option value="js">JavaScript</option>
        </select></div>
        <label className="block"><input type="checkbox" checked={draft.stealth} onChange={event => change('stealth', event.target.checked)} /> Stealth (+5 credits per scrape)</label>
        <label className="block">Wait time (ms)<input className="block border p-2" type="number" min={0} max={30000} step={1} required value={Number.isNaN(draft.wait) ? '' : draft.wait} onChange={event => change('wait', event.target.valueAsNumber)} /></label>
        <label className="block">Scroll count<input className="block border p-2" type="number" min={0} max={100} step={1} required value={Number.isNaN(draft.scrolls) ? '' : draft.scrolls} onChange={event => change('scrolls', event.target.valueAsNumber)} /></label>
        <div className="flex flex-wrap gap-3">
          <button className="bg-black text-white px-4 py-2" type="submit">{settingsBusy === 'saving' ? 'Saving…' : 'Save/replace key'}</button>
          <button className="border px-4 py-2" type="button" disabled={!settings.configured} onClick={() => void save(true)}>{settingsBusy === 'removing' ? 'Removing…' : 'Remove key'}</button>
          <button className="border px-4 py-2" type="button" disabled={!apiKey.trim() && !settings.configured} onClick={() => void testKey()}>{settingsBusy === 'testing' ? 'Testing key…' : 'Test key / check credits'}</button>
        </div>
      </fieldset>
      {message && <p role="status">{message}</p>}
      {credits && <p role="status">{credits.draftKey ? 'Entered key (unsaved)' : 'Saved key'}: {credits.remaining.toLocaleString()} credits remaining, {credits.used.toLocaleString()} used. Plan: {credits.plan}.</p>}
      {settingsError && <p role="alert" className="text-red-700">{settingsError}</p>}
      {dirty && <p role="status">Save your changes before retrieving URLs.</p>}
    </form>
    <form onSubmit={retrieve} className="max-w-3xl space-y-4">
      <label className="block">URL<input className="block border p-2 w-full" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://example.com/product" disabled={loading} required /></label>
      <button className="bg-black text-white px-4 py-2" disabled={loading || settingsLoading || !!settingsBusy || dirty || !settings.configured || !url.trim()}>{loading ? 'Retrieving…' : 'Retrieve URL'}</button>
      {loading && <button type="button" className="border px-4 py-2 ml-3" onClick={() => request.current?.abort()}>Cancel retrieval</button>}
    </form>
    {loading && <p role="status" className="mt-4">Retrieving page content…</p>}
    {error && <p role="alert" className="mt-4 text-red-700">{error}</p>}
    {markdown && <div className="max-w-3xl mt-6"><h3 className="text-lg font-semibold">Extracted page content</h3>
      {sourceUrl && <a className="block underline break-all my-2" href={sourceUrl} target="_blank" rel="noreferrer">View source page</a>}
      <pre className="whitespace-pre-wrap break-words font-sans text-sm border rounded p-4">{markdown}</pre>
    </div>}
  </section>;
}
