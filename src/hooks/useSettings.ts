import { useState } from 'react';

const STORAGE_KEY = "qa-analyzer-settings";
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

export interface AppSettings {
  llmProvider: string;
  baseUrl: string;
  apiKey: string;
  modelName: string;
  temperature: number;
  maxTokens: number;
  maxConcurrency: number;
  maxRetries: number;
  scraperTimeout: number;
  maxPageContentLength: number;
}

const DEFAULT_SETTINGS: AppSettings = {
  llmProvider: "openai-compatible",
  baseUrl: "https://api.aicredits.in/v1",
  apiKey: "",
  modelName: "deepseek/deepseek-v4-flash",
  temperature: 0.1,
  maxTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  maxConcurrency: 2,
  maxRetries: 3,
  scraperTimeout: 30000,
  maxPageContentLength: 40000,
};

export function normalizeMaxTokens(value: unknown): number {
  const maxTokens = Number(value);
  return Number.isSafeInteger(maxTokens) && maxTokens > 0 ? maxTokens : DEFAULT_MAX_OUTPUT_TOKENS;
}

function normalizeSettings(settings: Partial<AppSettings>): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    maxTokens: normalizeMaxTokens(settings.maxTokens),
  };
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? normalizeSettings(JSON.parse(stored)) : DEFAULT_SETTINGS;
    } catch (e) {
      return DEFAULT_SETTINGS;
    }
  });

  const saveSettings = (newSettings: AppSettings) => {
    const normalized = normalizeSettings(newSettings);
    setSettings(normalized);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  };

  return { settings, saveSettings, defaultSettings: DEFAULT_SETTINGS };
}
