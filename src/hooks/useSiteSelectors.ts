import { useState, useEffect, useCallback } from "react";
import { SiteSelectorRule } from "../types";

const STORAGE_KEY = "qa-analyzer-site-selectors";

export const DEFAULT_SITE_RULES: SiteSelectorRule[] = [
  {
    id: "rule-samsung-default",
    website: "www.samsung.",
    selectors: ".product-details, #specifications, .spec-table, .pdp-summary, div[class*='spec'], div[class*='feature']",
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: "rule-amazon-default",
    website: "amazon.",
    selectors: "#productDetails_db_sections, #techSpecSection, #feature-bullets, #productDescription",
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: "rule-apple-default",
    website: "apple.com",
    selectors: ".techspecs-section, .section-content, .overview-specs",
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
];

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
        if (isMounted && Array.isArray(data) && data.length > 0) {
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

    setRules((prev) => [created, ...prev]);

    try {
      await fetch("/api/site-selectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(created),
      });
    } catch (e) {
      console.error("Failed to save site selector rule to DB", e);
    }

    return created;
  }, []);

  const updateRule = useCallback(async (id: string, updates: Partial<SiteSelectorRule>) => {
    setRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...updates, updatedAt: Date.now() } : r))
    );

    try {
      await fetch(`/api/site-selectors/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
    } catch (e) {
      console.error("Failed to update site selector rule in DB", e);
    }
  }, []);

  const toggleRule = useCallback(async (id: string) => {
    let newEnabledState = true;
    setRules((prev) =>
      prev.map((r) => {
        if (r.id === id) {
          newEnabledState = !r.enabled;
          return { ...r, enabled: newEnabledState, updatedAt: Date.now() };
        }
        return r;
      })
    );

    try {
      await fetch(`/api/site-selectors/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: newEnabledState }),
      });
    } catch (e) {
      console.error("Failed to toggle site selector rule in DB", e);
    }
  }, []);

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
