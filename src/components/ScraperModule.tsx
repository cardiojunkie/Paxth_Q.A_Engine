import React, { useState } from "react";
import { Search, Loader2, AlertCircle, Trash2, Globe, Plus } from "lucide-react";
import { useSiteSelectors } from "../hooks/useSiteSelectors";
import { isCompleteWebsiteDomain, normalizeWebsite } from "../lib/siteSelectorWebsite";

export function ScraperModule() {
  const [url, setUrl] = useState("");
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [website, setWebsite] = useState("");
  const [selectors, setSelectors] = useState("");
  const [tabSelector, setTabSelector] = useState("");
  const [tabContentSelector, setTabContentSelector] = useState("");
  const [tabWaitMs, setTabWaitMs] = useState("300");
  const [ruleError, setRuleError] = useState<string | null>(null);
  const { rules, addRule, updateRule, deleteRule } = useSiteSelectors();

  const handleAddRule = async () => {
    const cleanWebsite = website.trim();
    const cleanSelectors = selectors.trim();
    const cleanTabSelector = tabSelector.trim();
    const cleanTabContentSelector = tabContentSelector.trim();
    if (!cleanWebsite || !cleanSelectors) return;
    if (!isCompleteWebsiteDomain(cleanWebsite)) {
      setRuleError("Enter a complete website domain, for example tcl.com.");
      return;
    }
    if (!!cleanTabSelector !== !!cleanTabContentSelector) {
      setRuleError("Tab control and tab content selectors must be provided together.");
      return;
    }
    const parsedTabWaitMs = tabWaitMs.trim() === "" ? 300 : Number(tabWaitMs);
    if (!Number.isInteger(parsedTabWaitMs) || parsedTabWaitMs < 0 || parsedTabWaitMs > 10000) {
      setRuleError("Tab wait must be a whole number from 0 to 10000 milliseconds.");
      return;
    }
    const existingRule = rules.find((rule) => normalizeWebsite(rule.website) === normalizeWebsite(cleanWebsite));
    const rule = {
      website: cleanWebsite,
      selectors: cleanSelectors,
      tabSelector: cleanTabSelector || undefined,
      tabContentSelector: cleanTabContentSelector || undefined,
      tabWaitMs: parsedTabWaitMs,
      enabled: true,
    };
    try {
      if (existingRule) await updateRule(existingRule.id, rule);
      else await addRule(rule);
      setWebsite("");
      setSelectors("");
      setTabSelector("");
      setTabContentSelector("");
      setTabWaitMs("300");
      setRuleError(null);
    } catch (error) {
      setRuleError(error instanceof Error ? error.message : "Could not save the site selector rule.");
    }
  };

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
        throw new Error([data.error, data.details].filter(Boolean).join(": ") || "Scraping failed");
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

        <section className="mb-6 border border-[#E5E2DE] bg-white p-5 shrink-0">
          <div className="mb-4">
            <h3 className="font-serif text-xl text-[#1A1A1A]">Site-specific selectors</h3>
            <p className="text-xs text-[#8C8882] mt-1">Add or update a website rule; optional tab selectors collect changing panels before extraction.</p>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] gap-3">
            <input
              type="text"
              aria-label="Website domain"
              value={website}
              onChange={(e) => { setWebsite(e.target.value); setRuleError(null); }}
              placeholder="example.com"
              className="w-full px-3 py-2.5 bg-[#F5F2EF] border border-transparent hover:border-[#E5E2DE] focus:border-[#1A1A1A] outline-none rounded-sm text-sm"
            />
            <input
              type="text"
              aria-label="CSS selectors"
              value={selectors}
              onChange={(e) => { setSelectors(e.target.value); setRuleError(null); }}
              onKeyDown={(e) => e.key === "Enter" && handleAddRule()}
              placeholder=".product-details, #specifications"
              className="w-full px-3 py-2.5 bg-[#F5F2EF] border border-transparent hover:border-[#E5E2DE] focus:border-[#1A1A1A] outline-none rounded-sm text-sm"
            />
            <button
              onClick={handleAddRule}
              disabled={!website.trim() || !selectors.trim()}
              className="flex items-center gap-2 px-4 py-2 text-[11px] uppercase tracking-widest border border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-white disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              {rules.some((rule) => normalizeWebsite(rule.website) === normalizeWebsite(website)) ? "Update" : "Add"}
            </button>
          </div>
          <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(8rem,1fr)] gap-3 mt-3">
            <input
              type="text"
              aria-label="Tab control selector"
              value={tabSelector}
              onChange={(e) => { setTabSelector(e.target.value); setRuleError(null); }}
              placeholder="Optional tab controls, e.g. .tabs button"
              className="w-full px-3 py-2.5 bg-[#F5F2EF] border border-transparent hover:border-[#E5E2DE] focus:border-[#1A1A1A] outline-none rounded-sm text-sm"
            />
            <input
              type="text"
              aria-label="Tab content selector"
              value={tabContentSelector}
              onChange={(e) => { setTabContentSelector(e.target.value); setRuleError(null); }}
              placeholder="Optional tab content, e.g. .tab-panel"
              className="w-full px-3 py-2.5 bg-[#F5F2EF] border border-transparent hover:border-[#E5E2DE] focus:border-[#1A1A1A] outline-none rounded-sm text-sm"
            />
            <input
              type="number"
              aria-label="Tab wait milliseconds"
              title="Wait after each tab click (milliseconds)"
              min="0"
              max="10000"
              step="1"
              value={tabWaitMs}
              onChange={(e) => { setTabWaitMs(e.target.value); setRuleError(null); }}
              placeholder="Wait (ms)"
              className="w-full px-3 py-2.5 bg-[#F5F2EF] border border-transparent hover:border-[#E5E2DE] focus:border-[#1A1A1A] outline-none rounded-sm text-sm"
            />
          </div>
          {ruleError && <p role="alert" aria-live="polite" className="text-xs text-red-600 mt-2">{ruleError}</p>}
          {rules.length > 0 && (
            <div className="mt-4 space-y-2 max-h-28 overflow-y-auto">
              {rules.map((rule) => (
                <div key={rule.id} className="flex items-center gap-3 bg-[#F5F2EF] px-3 py-2 text-xs">
                  <span className="font-medium text-[#1A1A1A] shrink-0">{rule.website}</span>
                  <div className="font-mono text-[#8C8882] truncate flex-1">
                    <div className="truncate">{rule.selectors}</div>
                    {rule.tabSelector && rule.tabContentSelector && (
                      <div className="truncate mt-1">Tabs: {rule.tabSelector} → {rule.tabContentSelector} · {rule.tabWaitMs ?? 300} ms</div>
                    )}
                  </div>
                  <button onClick={() => deleteRule(rule.id)} className="text-[#8C8882] hover:text-red-600" title={`Delete ${rule.website}`} aria-label={`Delete ${rule.website}`}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

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
