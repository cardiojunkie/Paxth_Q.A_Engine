import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import type { AttributeSet } from "../types";

type AttributeSetInput = Omit<AttributeSet, "id" | "createdAt" | "updatedAt">;

export function useAttributeSets() {
  const [attributeSets, setAttributeSets] = useState<AttributeSet[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      setAttributeSets(await apiFetch<AttributeSet[]>("/api/attribute-sets"));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh().catch((error) => console.error("Failed to load attribute sets", error));
    window.addEventListener("paxth:attribute-sets-imported", refresh);
    return () => window.removeEventListener("paxth:attribute-sets-imported", refresh);
  }, [refresh]);

  const addSet = useCallback(async (input: AttributeSetInput) => {
    const created = await apiFetch<AttributeSet>("/api/attribute-sets", { method: "POST", body: JSON.stringify(input) });
    setAttributeSets((previous) => [...previous, created]);
    return created;
  }, []);

  const updateSet = useCallback(async (id: string, input: AttributeSetInput) => {
    const updated = await apiFetch<AttributeSet>(`/api/attribute-sets/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(input) });
    setAttributeSets((previous) => previous.map((item) => item.id === id ? updated : item));
    return updated;
  }, []);

  const deleteSet = useCallback(async (id: string) => {
    await apiFetch(`/api/attribute-sets/${encodeURIComponent(id)}`, { method: "DELETE" });
    setAttributeSets((previous) => previous.filter((item) => item.id !== id));
  }, []);

  return { attributeSets, isLoading, refresh, addSet, updateSet, deleteSet };
}
