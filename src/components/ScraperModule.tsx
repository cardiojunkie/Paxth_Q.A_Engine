import React, { useState } from "react";
import { Search, Loader2, AlertCircle, Trash2, Globe } from "lucide-react";

export function ScraperModule() {
  const [url, setUrl] = useState("");
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleScrape = async () => {
    if (!url.trim()) return;
    
    setLoading(true);
    setError(null);
    setMarkdown(null);

    try {
      const response = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || "Scraping failed");
      }
      
      setMarkdown(data.markdown);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#FDFCFB] overflow-hidden">
      <header className="px-10 py-8 border-b border-[#E5E2DE] shrink-0">
        <h2 className="font-serif text-4xl tracking-tighter mb-2 text-[#1A1A1A]">Scraper Tools</h2>
        <p className="text-[#8C8882] text-sm leading-relaxed max-w-lg">
          Test URL scraping functionality before running full QA jobs. The backend will remove headers, footers, and extract clean markdown using a stealth CloakBrowser instance.
        </p>
      </header>

      <div className="flex-1 flex flex-col p-10 overflow-hidden">
        <div className="flex gap-4 mb-6 shrink-0">
          <div className="flex-1 relative">
            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8C8882]" />
            <input 
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleScrape()}
              placeholder="https://example.com/product/..."
              className="w-full pl-10 pr-4 py-3 bg-[#F5F2EF] border border-transparent hover:border-[#E5E2DE] focus:border-[#1A1A1A] outline-none rounded-sm text-sm transition-colors"
            />
          </div>
          <button 
            onClick={handleScrape}
            disabled={loading || !url.trim()}
            className="flex items-center gap-2 px-6 py-3 text-[11px] uppercase tracking-widest border border-[#1A1A1A] bg-[#1A1A1A] text-white hover:bg-black transition-colors rounded-sm disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            Scrape URL
          </button>
        </div>

        {error && (
          <div className="mb-6 flex items-start gap-2 text-red-600 bg-red-50 px-4 py-3 rounded-sm border border-red-100 shrink-0">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        <div className="flex-1 border border-[#E5E2DE] bg-white rounded-sm overflow-hidden flex flex-col relative">
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center bg-white/50 z-10">
              <div className="flex flex-col items-center gap-4">
                <Loader2 className="w-8 h-8 animate-spin text-[#1A1A1A]" />
                <span className="text-xs uppercase tracking-widest text-[#8C8882]">Fetching & Cleaning Page...</span>
              </div>
            </div>
          ) : markdown ? (
            <div className="flex-1 overflow-auto p-6 text-[13px] font-mono whitespace-pre-wrap text-[#1A1A1A]">
              {markdown}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center p-10 text-[#8C8882] text-sm text-center">
              No content extracted yet.<br/>Enter a URL above to test the scraper.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
