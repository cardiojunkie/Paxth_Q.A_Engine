import { useState, useEffect } from 'react';
import { DEFAULT_QA_AGENT_MEMORY } from '../lib/qaAgent';
import { fetchQaConfiguration, saveQaAgentMemory } from '../lib/qaConfiguration';

const STORAGE_KEY = "qa-analyzer-settings";
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
const LEGACY_AICREDITS_BASE_URL = "https://aicredits.in/v1";
const AICREDITS_BASE_URL = "https://api.aicredits.in/v1";

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
  qaAgentMemory: string;
}

const DEFAULT_SETTINGS: AppSettings = {
  llmProvider: "openai-compatible",
  baseUrl: AICREDITS_BASE_URL,
  apiKey: "",
  modelName: "deepseek/deepseek-v4-flash",
  temperature: 0.1,
  maxTokens: DEFAULT_MAX_OUTPUT_TOKENS,
  maxConcurrency: 2,
  maxRetries: 3,
  scraperTimeout: 30000,
  maxPageContentLength: 40000,
  qaAgentMemory: DEFAULT_QA_AGENT_MEMORY,
};

export function normalizeMaxTokens(value: unknown): number {
  const maxTokens = Number(value);
  return Number.isSafeInteger(maxTokens) && maxTokens > 0 ? maxTokens : DEFAULT_MAX_OUTPUT_TOKENS;
}

export function normalizeSettings(settings: Partial<AppSettings>): AppSettings {
  const trimmedUrl = settings.baseUrl?.trim().replace(/\/+$/, "");
  const baseUrl = trimmedUrl === LEGACY_AICREDITS_BASE_URL || trimmedUrl === `${LEGACY_AICREDITS_BASE_URL}/chat/completions`
    ? trimmedUrl.replace(LEGACY_AICREDITS_BASE_URL, AICREDITS_BASE_URL)
    : settings.baseUrl;

  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    baseUrl: baseUrl ?? DEFAULT_SETTINGS.baseUrl,
    maxTokens: normalizeMaxTokens(settings.maxTokens),
    maxPageContentLength: Number.isSafeInteger(settings.maxPageContentLength) && settings.maxPageContentLength > 0
      ? settings.maxPageContentLength : DEFAULT_SETTINGS.maxPageContentLength,
    qaAgentMemory: typeof settings.qaAgentMemory === 'string' && settings.qaAgentMemory.trim()
      ? settings.qaAgentMemory : DEFAULT_QA_AGENT_MEMORY,
  };
}

export function readSavedSettings(): AppSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? normalizeSettings(JSON.parse(stored)) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(readSavedSettings);
  const [legacyMemory, setLegacyMemory] = useState(settings.qaAgentMemory);
  const [isMemoryLoading, setIsMemoryLoading] = useState(true);
  const [memoryError, setMemoryError] = useState("");

  useEffect(() => {
    let active = true;
    fetchQaConfiguration().then(config => {
      if (active) setSettings(current => ({ ...current, qaAgentMemory: config.qaAgentMemory }));
    }).catch(error => {
      if (active) setMemoryError(error.message);
    }).finally(() => {
      if (active) setIsMemoryLoading(false);
    });
    return () => { active = false; };
  }, []);

  const saveSettings = async (newSettings: AppSettings) => {
    const normalized = normalizeSettings(newSettings);
    normalized.qaAgentMemory = await saveQaAgentMemory(normalized.qaAgentMemory);
    // This is only a local cache; QA jobs always fetch the database configuration.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    setSettings(normalized);
    setLegacyMemory(normalized.qaAgentMemory);
    setMemoryError("");
  };

  return { settings, saveSettings, defaultSettings: DEFAULT_SETTINGS, legacyMemory, isMemoryLoading, memoryError };
}
