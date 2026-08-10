import { useState } from 'react';

const STORAGE_KEY = "qa-analyzer-settings";

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
  maxTokens: 4096,
  maxConcurrency: 2,
  maxRetries: 3,
  scraperTimeout: 30000,
  maxPageContentLength: 40000,
};

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) } : DEFAULT_SETTINGS;
    } catch (e) {
      return DEFAULT_SETTINGS;
    }
  });

  const saveSettings = (newSettings: AppSettings) => {
    setSettings(newSettings);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newSettings));
  };

  return { settings, saveSettings, defaultSettings: DEFAULT_SETTINGS };
}
