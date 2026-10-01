import { useEffect, useRef, useState, type FormEvent } from 'react';
import Markdown from 'react-markdown';
import { scrapeUrl } from '../lib/scrapeRequest';

export function ScrapperAgentModule() {
  const [url, setUrl] = useState('');
  const [markdown, setMarkdown] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const mounted = useRef(true);
  const request = useRef<AbortController | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, []);
  const retrieve = async (event: FormEvent) => {
    event.preventDefault();
    if (loading || !url.trim()) return;
    setLoading(true); setError(''); setMarkdown('');
    request.current = new AbortController();
    try { const result = await scrapeUrl(url, request.current.signal); if (mounted.current) setMarkdown(result); }
    catch (error) { if (mounted.current) setError((error as Error).message); }
    finally { if (mounted.current) setLoading(false); }
  };
  return <section className="flex-1 overflow-auto p-8 bg-[#FDFCFB]">
    <h2 className="text-2xl font-serif mb-4">Scrapper agent</h2>
    <p className="mb-4">Retrieve page content and specifications from a public URL using the configured Scrapper model.</p>
    <form onSubmit={retrieve} className="max-w-3xl space-y-4">
      <label className="block">URL<input className="block border p-2 w-full" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://example.com/product" disabled={loading} required /></label>
      <button className="bg-black text-white px-4 py-2" disabled={loading || !url.trim()}>{loading ? 'Retrieving…' : 'Retrieve URL'}</button>
    </form>
    {loading && <p role="status" className="mt-4">Retrieving page content…</p>}
    {error && <p role="alert" className="mt-4 text-red-700">{error}</p>}
    {markdown && <div className="prose max-w-3xl mt-6"><h3>Markdown preview</h3><Markdown>{markdown}</Markdown></div>}
  </section>;
}
