import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import type { SiteSelectorRule } from "../types";

export function useSiteSelectors() {
  const [rules, setRules] = useState<SiteSelectorRule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setRules(await apiFetch<SiteSelectorRule[]>("/api/site-selectors"));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not load site selectors.");
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh().catch((error) => console.error("Failed to load site selectors", error));
  }, [refresh]);

  const addRule = useCallback(async (rule: Omit<SiteSelectorRule, "id" | "createdAt" | "updatedAt">) => {
    const saved = await apiFetch<SiteSelectorRule>("/api/site-selectors", {
      method: "POST",
      body: JSON.stringify(rule),
    });
    setRules((previous) => [saved, ...previous]);
    return saved;
  }, []);

  const updateRule = useCallback(async (id: string, updates: Partial<SiteSelectorRule>) => {
    const saved = await apiFetch<SiteSelectorRule>(`/api/site-selectors/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(updates),
    });
    setRules((previous) => previous.map((rule) => rule.id === id ? saved : rule));
    return saved;
  }, []);

  const toggleRule = useCallback(async (id: string) => {
    const rule = rules.find((item) => item.id === id);
    if (rule) await updateRule(id, { ...rule, enabled: !rule.enabled });
  }, [rules, updateRule]);

  const deleteRule = useCallback(async (id: string) => {
    await apiFetch(`/api/site-selectors/${encodeURIComponent(id)}`, { method: "DELETE" });
    setRules((previous) => previous.filter((rule) => rule.id !== id));
  }, []);

  return { rules, isLoading, error, refresh, addRule, updateRule, toggleRule, deleteRule };
}
