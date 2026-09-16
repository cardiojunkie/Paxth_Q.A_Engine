import { useState, useEffect, useCallback } from "react";
import { AttributeSet } from "../types";
import { fetchQaConfiguration } from "../lib/qaConfiguration";

const STORAGE_KEY = "qa-analyzer-attribute-sets";

export function useAttributeSets() {
  const [attributeSets, setAttributeSets] = useState<AttributeSet[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [browserRules] = useState<AttributeSet[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(stored) ? stored.filter(set => typeof set?.name === "string" && set.name.trim() &&
        typeof set.rulesMarkdown === "string" && set.rulesMarkdown.trim()) : [];
    } catch { return []; }
  });

  const reloadSets = useCallback(async () => {
    setIsLoading(true);
    try {
      setAttributeSets((await fetchQaConfiguration()).attributeSets);
      setLoadError("");
    } catch (error: any) {
      setLoadError(error.message);
    } finally {
      setIsLoading(false);
    }
  }, []);
  useEffect(() => { void reloadSets(); }, [reloadSets]);

  const addSet = async (set: Omit<AttributeSet, "id" | "createdAt" | "updatedAt">) => {
    const response = await fetch("/api/attribute-sets", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(set),
    });
    const saved = await response.json();
    if (!response.ok) throw new Error(saved.error || "Attribute set was not saved to Supabase");
    setAttributeSets(current => [...current, saved]);
  };

  const updateSet = async (id: string, updates: Pick<AttributeSet, "name" | "rulesMarkdown">) => {
    const response = await fetch(`/api/attribute-sets/${encodeURIComponent(id)}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updates),
    });
    const saved = await response.json();
    if (!response.ok) throw new Error(saved.error || "Attribute set was not updated in Supabase");
    setAttributeSets(current => current.map(set => set.id === id ? saved : set));
  };

  const deleteSet = async (id: string) => {
    const response = await fetch(`/api/attribute-sets/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) throw new Error("Attribute set was not deleted from Supabase");
    setAttributeSets(current => current.filter(set => set.id !== id));
  };

  const importBrowserRules = async () => {
    const response = await fetch("/api/attribute-sets/import", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(browserRules),
    });
    if (!response.ok) throw new Error("Browser rules were not imported to Supabase. Your local copy is preserved.");
    const result = await response.json();
    await reloadSets();
    return result.imported as number;
  };

  return { attributeSets, addSet, updateSet, deleteSet, isLoading, loadError, reloadSets, browserRules, importBrowserRules };
}
