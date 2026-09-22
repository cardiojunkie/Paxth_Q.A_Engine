
import { useState, useCallback, useEffect, useRef } from 'react';
import { api } from '../lib/api';

export type QAStatus = "pending" | "ready" | "cannot_qa" | "running" | "completed" | "failed";

export interface SkuData {
  sku: string;
  revision?: number;
  upload_attributes: Record<string, any>;
  source: {
    sap?: string;
    url?: string;
    fileName?: string;
    headerOrder?: string[];
  };
  raw_row: Record<string, any>;
  status: QAStatus;
  attribute_set?: string;
  scraped_markdown?: string;
  scrape_status?: "success" | "failed" | "skipped_no_url";
  tokensUsed?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  timeTaken?: number;
  error?: string | null;
  qa_result?: Record<string, any>;
  export_data?: Record<string, any>;
  last_job_id?: string;
}

export function useCatalogData(enabled = true) {
  const [skuDataList, setSkuDataList] = useState<SkuData[]>([]);
  const [isLoading, setIsLoading] = useState(enabled);
  const [catalogError, setCatalogError] = useState("");
  const generation = useRef(0);
  const refreshCatalog = useCallback(async () => {
    if (!enabled) return;
    const current = generation.current;
    const rows = await api<SkuData[]>('/api/catalog');
    if (current === generation.current) { setSkuDataList(rows); setCatalogError(""); }
  }, [enabled]);
  const resetCatalog = useCallback(() => { generation.current++; setSkuDataList([]); }, []);
  useEffect(() => {
    generation.current++;
    if (!enabled) { setSkuDataList([]); setIsLoading(false); return; }
    let active = true;
    setIsLoading(true);
    refreshCatalog().catch(error => { if (active) setCatalogError(error.message); })
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; generation.current++; };
  }, [enabled, refreshCatalog]);

  const addParsedData = useCallback(async (data: SkuData[]) => {
    try {
      const result = await api<{inserted: SkuData[]; skipped: string[]}>('/api/catalog', { method:'POST', body:JSON.stringify(data) });
      setSkuDataList(previous => {
        const rows = new Map(previous.map(item => [item.sku,item]));
        result.inserted.forEach(item => rows.set(item.sku,item));
        return [...rows.values()];
      });
      setCatalogError("");
      return result;
    } catch (error) { setCatalogError((error as Error).message); return null; }
  }, []);
  const updateSku = useCallback(async (sku: string, updates: Partial<SkuData>): Promise<boolean> => {
    try {
      const saved = await api<SkuData>(`/api/catalog/${encodeURIComponent(sku)}`, { method:'PUT', body:JSON.stringify(updates) });
      setSkuDataList(previous => previous.map(item => item.sku === sku ? saved : item));
      setCatalogError("");
      return true;
    } catch (error) { setCatalogError((error as Error).message); return false; }
  }, []);
  const removeSkus = useCallback(async (skus: string[]) => {
    try {
      await api('/api/catalog', { method:'DELETE', body:JSON.stringify({skus}) });
      setSkuDataList(previous => previous.filter(item => !skus.includes(item.sku)));
      setCatalogError("");
      return true;
    } catch (error) { setCatalogError((error as Error).message); return false; }
  }, []);
  return { skuDataList, addParsedData, updateSku, removeSkus, resetCatalog, refreshCatalog, isLoading, catalogError };
}
