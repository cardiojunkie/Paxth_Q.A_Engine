import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/api";

export type QAStatus = "pending" | "ready" | "cannot_qa" | "running" | "completed" | "failed" | "unavailable";

export interface SkuData {
  sku: string;
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

export function useCatalogData(enabled: boolean) {
  const [skuDataList, setSkuDataList] = useState<SkuData[]>([]);
  const [isLoading, setIsLoading] = useState(enabled);

  const refresh = useCallback(async (silent = false) => {
    if (!enabled) {
      setSkuDataList([]);
      setIsLoading(false);
      return;
    }
    if (!silent) setIsLoading(true);
    try {
      setSkuDataList(await apiFetch<SkuData[]>("/api/catalog"));
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh().catch((error) => console.error("Failed to fetch catalog", error));
  }, [refresh]);

  const addParsedData = useCallback(async (data: SkuData[]) => {
    await apiFetch("/api/catalog", { method: "POST", body: JSON.stringify(data) });
    setSkuDataList((previous) => {
      const items = new Map(previous.map((item) => [item.sku, item]));
      for (const item of data) {
        const existing = items.get(item.sku);
        items.set(item.sku, existing ? {
          ...existing,
          ...item,
          scraped_markdown: item.scraped_markdown || existing.scraped_markdown,
          scrape_status: item.scrape_status || existing.scrape_status,
        } : item);
      }
      return [...items.values()];
    });
  }, []);

  const removeSkus = useCallback(async (skus: string[]) => {
    await apiFetch("/api/catalog", { method: "DELETE", body: JSON.stringify({ skus }) });
    setSkuDataList((previous) => previous.filter((item) => !skus.includes(item.sku)));
  }, []);

  const clearAllData = useCallback(async () => {
    await apiFetch("/api/catalog", { method: "DELETE", body: JSON.stringify({ scope: "all" }) });
    setSkuDataList([]);
  }, []);

  return {
    skuDataList,
    addParsedData,
    removeSkus,
    clearAllData,
    refresh,
    isLoading,
  };
}
