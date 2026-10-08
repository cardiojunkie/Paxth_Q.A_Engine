import { useEffect, useRef, useState, type FormEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import { useAppContext } from '../context/AppContext';
import type { SkuData } from '../hooks/useCatalogData';
import { usableScrapedMarkdown } from '../lib/scrapeEvidence';

export function ScraperModule() {
  const { skuDataList, scrapeSku, updateSku, catalogError, addNotification } = useAppContext();
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
    return () => { mounted.current = false; request.current?.abort(); };
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
    if (!selected || loading || savingUrl || urlChanged || !selected.source.url?.trim()) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true); setError('');
    try {
      await scrapeSku(selected, controller.signal);
      if (mounted.current) addNotification({ type: 'success', title: 'Scraped Data Saved', message: `Saved page content against SKU ${selected.sku}.` });
    } catch (error) {
      if (mounted.current) setError(controller.signal.aborted ? 'Scraping was cancelled. Previously saved evidence is retained.' : (error as Error).message);
    } finally { if (mounted.current) setLoading(false); }
  };
  const metadata = selected?.scrape_metadata;
  const sourceUrl = metadata?.finalUrl || metadata?.requestedUrl || selected?.source.url;
  return <section className="flex-1 overflow-auto p-8 bg-[#FDFCFB]">
    <h2 className="text-2xl font-serif mb-4">Scraper</h2>
    <p className="mb-4">Select a SKU to retrieve its product page and save the result in Scraped Data.</p>
    <form onSubmit={event => void retrieve(event)} className="max-w-4xl space-y-4">
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
        {loading && <button type="button" className="border px-4 py-2 ml-4" onClick={() => request.current?.abort()}>Cancel scraping</button>}
      </>}
    </form>
    {loading && <p role="status" className="mt-4">Revealing and collecting page content…</p>}
    {error && <p role="alert" className="mt-4 text-red-700">{error}</p>}
    {catalogError && catalogError !== error && <p className="mt-4 text-red-700">{catalogError}</p>}
    {selected?.scrape_error && <p className="mt-4 text-red-700">Latest scrape: {selected.scrape_error}</p>}
    {selected?.scraped_markdown?.trim() && <div className="max-w-4xl mt-6">
      <h3 className="text-xl mb-2">Saved Scraped Data — {selected.sku}</h3>
      {metadata && <p className="text-sm">Evidence: {metadata.method}{metadata.capturedAt && ` · ${new Date(metadata.capturedAt).toLocaleString()}`}{metadata.requestedUrl && ` · ${metadata.requestedUrl}`}</p>}
      {!usableScrapedMarkdown(selected) && <p className="text-amber-700">The source URL changed. Rescrape or save manual content in Dashboard before QA uses this evidence.</p>}
      {selected.qa_stale && <p className="text-amber-700">QA needs to be rerun for the current evidence.</p>}
      {sourceUrl && /^https?:\/\//i.test(sourceUrl) && <a href={sourceUrl} target="_blank" rel="noreferrer" className="underline">View source page</a>}
      <div className="prose max-w-none my-4"><ReactMarkdown>{selected.scraped_markdown}</ReactMarkdown></div>
      <label className="block">Markdown preview<textarea className="block border p-3 w-full font-mono text-sm" readOnly rows={24} value={selected.scraped_markdown} /></label>
    </div>}
  </section>;
}
