import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/api";

export interface AppSettings {
  llmProvider: string;
  baseUrl: string;
  modelName: string;
  temperature: number;
  maxTokens: number;
  maxRetries: number;
  scraperTimeout: number;
  maxPageContentLength: number;
  hasApiKey: boolean;
}

export type SettingsUpdate = Omit<AppSettings, "hasApiKey"> & { apiKey?: string | null };

export const DEFAULT_SETTINGS: AppSettings = {
  llmProvider: "openai-compatible",
  baseUrl: "",
  modelName: "",
  temperature: 0.1,
  maxTokens: 4096,
  maxRetries: 2,
  scraperTimeout: 30000,
  maxPageContentLength: 40000,
  hasApiKey: false,
};

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setSettings(await apiFetch<AppSettings>("/api/settings"));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not load settings.");
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  const saveSettings = useCallback(async (next: SettingsUpdate) => {
    const saved = await apiFetch<AppSettings>("/api/settings", {
      method: "PUT",
      body: JSON.stringify(next),
    });
    setSettings(saved);
    return saved;
  }, []);

  const testSettings = useCallback(() => apiFetch<{ success: boolean }>("/api/settings/test", {
    method: "POST",
    body: "{}",
  }), []);

  return { settings, isLoading, error, refresh, saveSettings, testSettings, defaultSettings: DEFAULT_SETTINGS };
}
