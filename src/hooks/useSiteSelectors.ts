import { useState, useEffect, useCallback } from "react";
import { SiteSelectorRule } from "../types";

const STORAGE_KEY = "qa-analyzer-site-selectors";

export const DEFAULT_SITE_RULES: SiteSelectorRule[] = [];

export function useSiteSelectors() {
  const [rules, setRules] = useState<SiteSelectorRule[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (e) {
      console.error("Failed to parse site selectors from local storage", e);
    }
    return DEFAULT_SITE_RULES;
  });

  const [isLoading, setIsLoading] = useState(false);

  // Sync with API if DB available
  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    fetch("/api/site-selectors")
      .then((res) => {
        if (!res.ok) throw new Error("API not ready");
        return res.json();
      })
      .then((data) => {
        if (isMounted && Array.isArray(data)) {
          setRules(data);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        }
      })
      .catch(() => {
        // Fallback to local storage or defaults
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  // Save to local storage whenever rules state changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
    } catch (e) {
      console.error("Failed to save site selectors to local storage", e);
    }
  }, [rules]);

  const addRule = useCallback(async (newRule: Omit<SiteSelectorRule, "id" | "createdAt" | "updatedAt">) => {
    const created: SiteSelectorRule = {
      ...newRule,
      id: `rule-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    try {
      const response = await fetch("/api/site-selectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(created),
      });
      const saved = await response.json();
      if (!response.ok) throw new Error(saved.error || "Failed to save site selector rule");
      setRules((prev) => [saved, ...prev]);
    } catch (e) {
      console.error("Failed to save site selector rule to DB", e);
      throw e;
    }

    return created;
  }, []);

  const updateRule = useCallback(async (id: string, updates: Partial<SiteSelectorRule>) => {
    try {
      const response = await fetch(`/api/site-selectors/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to update site selector rule");
      setRules((prev) => prev.map((rule) => rule.id === id ? data : rule));
      return data as SiteSelectorRule;
    } catch (e) {
      console.error("Failed to update site selector rule in DB", e);
      throw e;
    }
  }, []);

  const toggleRule = useCallback(async (id: string) => {
    const rule = rules.find((item) => item.id === id);
    if (rule) await updateRule(id, { ...rule, enabled: !rule.enabled });
  }, [rules, updateRule]);

  const deleteRule = useCallback(async (id: string) => {
    setRules((prev) => prev.filter((r) => r.id !== id));

    try {
      await fetch(`/api/site-selectors/${id}`, {
        method: "DELETE",
      });
    } catch (e) {
      console.error("Failed to delete site selector rule from DB", e);
    }
  }, []);

  const matchUrlRule = useCallback((url: string): SiteSelectorRule | null => {
    if (!url || !url.trim()) return null;
    const cleanUrl = url.trim().toLowerCase();
    const urlNoProto = cleanUrl.replace(/^https?:\/\//, '');

    for (const rule of rules) {
      if (!rule.enabled) continue;
      const web = (rule.website || '').trim().toLowerCase();
      if (!web) continue;
      const webNoProto = web.replace(/^https?:\/\//, '');
      const webNoWww = webNoProto.replace(/^www\./, '');

      if (
        cleanUrl.includes(web) ||
        urlNoProto.startsWith(webNoProto) ||
        urlNoProto.startsWith(webNoWww) ||
        urlNoProto.includes(webNoProto) ||
        (web.endsWith('.') && urlNoProto.startsWith(web.slice(0, -1)))
      ) {
        return rule;
      }
    }
    return null;
  }, [rules]);

  return {
    rules,
    isLoading,
    addRule,
    updateRule,
    toggleRule,
    deleteRule,
    matchUrlRule,
  };
}
