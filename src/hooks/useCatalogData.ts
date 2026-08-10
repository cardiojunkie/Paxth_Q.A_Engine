
import { useState, useCallback, useEffect } from 'react';

export type QAStatus = "pending" | "ready" | "cannot_qa" | "running" | "completed" | "failed";

export interface SkuData {
  sku: string;
  upload_attributes: Record<string, any>;
  source: {
    sap?: string;
    url?: string;
    fileName?: string;
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
  error?: string;
  qa_result?: Record<string, any>;
  export_data?: Record<string, any>;
  last_job_id?: string;
}

export function useCatalogData() {
  const [skuDataList, setSkuDataList] = useState<SkuData[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch initial data
  useEffect(() => {
    fetch('/api/catalog')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setSkuDataList(data);
        }
        setIsLoading(false);
      })
      .catch(err => {
        console.error("Failed to fetch catalog", err);
        setIsLoading(false);
      });
  }, []);

  const addParsedData = useCallback(async (data: SkuData[]) => {
    setSkuDataList((prev) => {
      const newMap = new Map(prev.map((item) => [item.sku, item]));
      data.forEach((item) => {
        const existing = newMap.get(item.sku);
        if (existing) {
          newMap.set(item.sku, {
            ...existing,
            ...item,
            scraped_markdown: item.scraped_markdown || existing.scraped_markdown,
            scrape_status: item.scrape_status || existing.scrape_status,
          });
        } else {
          newMap.set(item.sku, item);
        }
      });
      return Array.from(newMap.values());
    });
    
    try {
      await fetch('/api/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
    } catch(e) { console.error(e); }
  }, []);

  const updateSkuStatus = useCallback(async (skus: string[], newStatus: QAStatus) => {
    setSkuDataList((prev) =>
      prev.map((item) =>
        skus.includes(item.sku) ? { ...item, status: newStatus } : item
      )
    );
    
    for (const sku of skus) {
      try {
        await fetch(`/api/catalog/${sku}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus })
        });
      } catch(e) { console.error(e); }
    }
  }, []);

  const updateSku = useCallback(async (sku: string, updates: Partial<SkuData>) => {
    setSkuDataList((prev) =>
      prev.map((item) => (item.sku === sku ? { ...item, ...updates } : item))
    );
    
    try {
      await fetch(`/api/catalog/${sku}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
    } catch(e) { console.error(e); }
  }, []);

  const removeSkus = useCallback(async (skusToRemove: string[]) => {
    setSkuDataList((prev) => prev.filter((item) => !skusToRemove.includes(item.sku)));
    
    try {
      await fetch('/api/catalog', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skus: skusToRemove })
      });
    } catch(e) { console.error(e); }
  }, []);

  const clearAllData = useCallback(async () => {
    setSkuDataList([]);
    try {
      await fetch('/api/catalog', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true })
      });
    } catch(e) { console.error(e); }
  }, []);

  return { skuDataList, addParsedData, updateSkuStatus, updateSku, removeSkus, clearAllData, isLoading };
}
