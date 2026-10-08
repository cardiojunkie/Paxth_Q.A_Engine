import { useEffect, useRef, useState, type FormEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import { saveAs } from 'file-saver';
import { useAppContext } from '../context/AppContext';
import type { SkuData } from '../hooks/useCatalogData';
import { usableScrapedMarkdown } from '../lib/scrapeEvidence';
import { ApiError } from '../lib/api';
import { previewScrapeUrl } from '../lib/scrapeRequest';
import type { ScrapePreview, ScrapeReport } from '../lib/browserScrape';

function Diagnostics({ report }: { report: ScrapeReport }) {
  return <div className="mt-3 space-y-2 text-sm">
    <p>{(report.durationMs / 1000).toFixed(1)} seconds · {report.characters.toLocaleString()} characters · {report.clicks} clicks · {report.scrolls} scrolls</p>
    {report.warnings.length > 0 && <ul className="list-disc pl-5">{report.warnings.slice(0, 20).map((warning, index) => <li key={index}><span className="font-mono">{warning.code}</span>: {warning.message}</li>)}</ul>}
    {report.unresolvedControls.length > 0 && <p>Unresolved controls: {report.unresolvedControls.slice(0, 20).join(', ')}</p>}
  </div>;
}

export function ScraperModule() {
  const { skuDataList, scrapeSku, updateSku, catalogError, addNotification } = useAppContext();
  const [mode, setMode] = useState<'preview' | 'sku'>('preview');
  const [testUrl, setTestUrl] = useState('');
  const [preview, setPreview] = useState<ScrapePreview | null>(null);
  const [failedPreview, setFailedPreview] = useState<{ url: string; label: 'Blocked' | 'Failed'; code?: string; report?: ScrapeReport } | null>(null);
  const [copied, setCopied] = useState(false);
  const [selectedSku, setSelectedSku] = useState('');
  const [draft, setDraft] = useState<{ source: SkuData['source']; revision: number } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [savingUrl, setSavingUrl] = useState(false);
  const mounted = useRef(true);
  const request = useRef<AbortController | null>(null);
  const selected = skuDataList.find(sku => sku.sku === selectedSku);
  const url = draft?.source.url ?? selected?.source.url ?? '';
  const urlChanged = Boolean(draft && url !== (selected?.source.url ?? ''));
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current?.abort(); request.current = null; };
  }, []);
  const saveUrl = async () => {
    if (!selected || !draft || savingUrl || loading) return;
    setSavingUrl(true); setError('');
    const saved = await updateSku(selected.sku, { source: draft.source }, draft.revision);
    if (!mounted.current) return;
    setSavingUrl(false);
    if (saved) setDraft(null);
    else setError('The URL could not be saved. Your draft is preserved. If this SKU changed, select it again to edit the latest version.');
  };
  const retrieve = async (event: FormEvent) => {
    event.preventDefault();
    if (loading || savingUrl) return;
    if (mode === 'preview' ? !testUrl.trim() : !selected || urlChanged || !selected.source.url?.trim()) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true); setError('');
    setFailedPreview(null); setCopied(false);
    if (mode === 'preview') setPreview(null);
    try {
      if (mode === 'preview') {
        const result = await previewScrapeUrl(testUrl.trim(), controller.signal);
        if (mounted.current && request.current === controller && !controller.signal.aborted) setPreview(result);
      } else if (selected) {
        await scrapeSku(selected, controller.signal);
        if (mounted.current && request.current === controller && !controller.signal.aborted) addNotification({ type: 'success', title: 'Scraped Data Saved', message: `Saved page content against SKU ${selected.sku}.` });
      }
    } catch (error) {
      if (mounted.current && request.current === controller && !controller.signal.aborted) {
        setError(error instanceof Error ? error.message : 'Scraping failed. Please retry.');
        if (mode === 'preview') {
          const failure = error instanceof ApiError ? error : undefined;
          setFailedPreview({ url: testUrl.trim(), label: failure?.code === 'PAGE_BLOCKED' ? 'Blocked' : 'Failed', code: failure?.code, report: failure?.report });
        }
      }
    } finally { if (mounted.current && request.current === controller) { request.current = null; setLoading(false); } }
  };
  const cancel = () => {
    request.current?.abort(); request.current = null;
    setLoading(false);
    setError(mode === 'preview' ? 'Scraping was cancelled.' : 'Scraping was cancelled. Previously saved evidence is retained.');
  };
  const copyMarkdown = async () => {
    if (!preview) return;
    try { await navigator.clipboard.writeText(preview.markdown); if (mounted.current) setCopied(true); }
    catch { if (mounted.current) setError('Copy failed. Use Download Markdown or select the raw Markdown below.'); }
  };
  const changeMode = (next: 'preview' | 'sku') => {
    if (next === mode) return;
    setMode(next); setError(''); setFailedPreview(null);
  };
  const metadata = selected?.scrape_metadata;
  const sourceUrl = metadata?.finalUrl || metadata?.requestedUrl || selected?.source.url;
  return <section className="flex-1 overflow-auto p-8 bg-[#FDFCFB]">
    <h2 className="text-2xl font-serif mb-4">Scraper</h2>
    <div className="flex gap-2 mb-4" role="group" aria-label="Scraper mode">
      <button type="button" aria-pressed={mode === 'preview'} disabled={loading || savingUrl} className="border px-4 py-2 aria-pressed:bg-black aria-pressed:text-white" onClick={() => changeMode('preview')}>Test URL</button>
      <button type="button" aria-pressed={mode === 'sku'} disabled={loading || savingUrl} className="border px-4 py-2 aria-pressed:bg-black aria-pressed:text-white" onClick={() => changeMode('sku')}>Save to SKU</button>
    </div>
    <p className="mb-4">{mode === 'preview' ? 'Test a page without a SKU. Results are temporary; copy or download them to keep them.' : 'Select a SKU to retrieve its product page and save the result in Scraped Data.'}</p>
    {mode === 'preview' && <p className="text-sm mb-4">A page result does not certify an entire website as fully scrapeable.</p>}
    <form onSubmit={event => void retrieve(event)} className="max-w-4xl space-y-4">
      {mode === 'preview' ? <>
        <label className="block">Website URL<input type="url" required className="block border p-2 w-full" value={testUrl} onChange={event => { setTestUrl(event.target.value); setPreview(null); setFailedPreview(null); setError(''); setCopied(false); }} placeholder="https://example.com/product" disabled={loading} /></label>
        <button type="submit" className="bg-black text-white px-4 py-2 disabled:opacity-50" disabled={loading || !testUrl.trim()}>{loading ? 'Scraping…' : 'Scrape URL'}</button>
      </> : <>
      <div><label htmlFor="scraper-sku" className="block">SKU</label><select id="scraper-sku" className="block border p-2 w-full" value={selectedSku} disabled={loading || savingUrl} onChange={event => { setSelectedSku(event.target.value); setDraft(null); setError(''); }}>
        <option value="">Select an existing SKU</option>
        {skuDataList.map(sku => <option key={sku.sku} value={sku.sku}>{sku.sku}</option>)}
      </select></div>
      {!skuDataList.length && <p>Upload SKUs in Dashboard before scraping.</p>}
      {selected && <>
        <label className="block">Saved source URL<input className="block border p-2 w-full" value={url} onChange={event => setDraft(previous => ({ revision: previous?.revision ?? selected.revision ?? 0, source: { ...(previous?.source ?? selected.source), url: event.target.value } }))} placeholder="https://example.com/product" disabled={loading || savingUrl} /></label>
        {urlChanged && <button type="button" className="border px-4 py-2" onClick={() => void saveUrl()} disabled={savingUrl}>{savingUrl ? 'Saving URL…' : 'Save URL'}</button>}
        {urlChanged && <p className="text-sm">Save the source URL before scraping.</p>}
        <button type="submit" className="bg-black text-white px-4 py-2 disabled:opacity-50" disabled={loading || savingUrl || urlChanged || !selected.source.url?.trim()}>{loading ? 'Scraping…' : selected.scraped_markdown?.trim() ? 'Rescrape and save' : 'Scrape and save'}</button>
      </>}
      </>}
      {loading && <button type="button" className="border px-4 py-2 ml-4" onClick={cancel}>Cancel scraping</button>}
    </form>
    {loading && <p role="status" className="mt-4">Revealing and collecting page content…</p>}
    {error && <p role="alert" className="mt-4 text-red-700">{error}</p>}
    {mode === 'preview' && failedPreview && <div className="max-w-4xl mt-6">
      <h3 className="text-xl mb-2">{failedPreview.label}</h3>
      <p className="text-sm break-all">{failedPreview.url}{failedPreview.code && ` · ${failedPreview.code}`}</p>
      {failedPreview.report && <Diagnostics report={failedPreview.report} />}
      <button type="button" className="border px-4 py-2 mt-3" onClick={() => saveAs(new Blob([JSON.stringify({ status: failedPreview.label.toLowerCase(), requestedUrl: failedPreview.url, error, code: failedPreview.code, report: failedPreview.report }, null, 2)], { type: 'application/json;charset=utf-8' }), 'scrape-report.json')}>Download report</button>
    </div>}
    {mode === 'preview' && preview && <div className="max-w-4xl mt-6">
      <h3 className="text-xl mb-2">{preview.status === 'collected' ? 'Content collected' : 'Partial'}</h3>
      <p className="text-sm break-all">Requested: {preview.requestedUrl}</p>
      <p className="text-sm break-all">Final: {preview.finalUrl} · {new Date(preview.capturedAt).toLocaleString()}</p>
      {preview.status === 'partial' && <p className="text-amber-700 mt-2">Some content could not be collected. This preview is not saved as SKU evidence.</p>}
      <Diagnostics report={preview.report} />
      <div className="flex flex-wrap gap-2 mt-4">
        <button type="button" className="border px-4 py-2" onClick={() => void copyMarkdown()}>{copied ? 'Copied' : 'Copy Markdown'}</button>
        <button type="button" className="border px-4 py-2" onClick={() => saveAs(new Blob([preview.markdown], { type: 'text/markdown;charset=utf-8' }), 'scrape-preview.md')}>Download Markdown</button>
        <button type="button" className="border px-4 py-2" onClick={() => saveAs(new Blob([JSON.stringify(preview, null, 2)], { type: 'application/json;charset=utf-8' }), 'scrape-report.json')}>Download report</button>
      </div>
      <div className="prose max-w-none my-4"><ReactMarkdown components={{ img: ({ alt }) => <span>{alt}</span> }}>{preview.markdown}</ReactMarkdown></div>
      <label htmlFor="scraper-markdown" className="block">Raw Markdown</label><textarea id="scraper-markdown" className="block border p-3 w-full font-mono text-sm" readOnly rows={24} value={preview.markdown} />
    </div>}
    {mode === 'sku' && catalogError && catalogError !== error && <p className="mt-4 text-red-700">{catalogError}</p>}
    {mode === 'sku' && selected?.scrape_error && <p className="mt-4 text-red-700">Latest scrape: {selected.scrape_error}</p>}
    {mode === 'sku' && selected?.scraped_markdown?.trim() && <div className="max-w-4xl mt-6">
      <h3 className="text-xl mb-2">Saved Scraped Data — {selected.sku}</h3>
      {metadata && <p className="text-sm">Evidence: {metadata.method}{metadata.capturedAt && ` · ${new Date(metadata.capturedAt).toLocaleString()}`}{metadata.requestedUrl && ` · ${metadata.requestedUrl}`}</p>}
      {!usableScrapedMarkdown(selected) && <p className="text-amber-700">The source URL changed. Rescrape or save manual content in Dashboard before QA uses this evidence.</p>}
      {selected.qa_stale && <p className="text-amber-700">QA needs to be rerun for the current evidence.</p>}
      {sourceUrl && /^https?:\/\//i.test(sourceUrl) && <a href={sourceUrl} target="_blank" rel="noreferrer" className="underline">View source page</a>}
      <div className="prose max-w-none my-4"><ReactMarkdown components={{ img: ({ alt }) => <span>{alt}</span> }}>{selected.scraped_markdown}</ReactMarkdown></div>
      <label className="block">Markdown preview<textarea className="block border p-3 w-full font-mono text-sm" readOnly rows={24} value={selected.scraped_markdown} /></label>
    </div>}
  </section>;
}
