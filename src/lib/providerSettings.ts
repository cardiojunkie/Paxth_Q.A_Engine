import { DEFAULT_QA_AGENT_MEMORY } from "./qaAgent";

export interface AppSettings {
  llmProvider: string;
  baseUrl: string;
  providerConfigured: boolean;
  scraperConfigured: boolean;
  modelName: string;
  scraperModelName: string;
  temperature: number;
  maxTokens: number;
  maxConcurrency: number;
  maxRetries: number;
  maxPageContentLength: number;
  qaAgentMemory: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  llmProvider: "openai-compatible", baseUrl: "", providerConfigured: false, scraperConfigured: false,
  modelName: "deepseek/deepseek-v4.1-flash", temperature: 0.1, maxTokens: 4096,
  scraperModelName: "z-ai/glm-5.3-flash",
  maxConcurrency: 1, maxRetries: 2,
  maxPageContentLength: 40_000, qaAgentMemory: DEFAULT_QA_AGENT_MEMORY,
};

export function normalizeMaxTokens(value: unknown): number {
  const tokens = Number(value);
  return Number.isSafeInteger(tokens) && tokens > 0 && tokens <= 65536 ? tokens : DEFAULT_SETTINGS.maxTokens;
}

/** Explicit fields prevent legacy browser credentials leaking into settings or run snapshots. */
export function normalizeSettings(settings: Partial<AppSettings> = {}): AppSettings {
  const modelName = typeof settings.modelName === "string" && settings.modelName.trim() ? settings.modelName.trim() : DEFAULT_SETTINGS.modelName;
  return {
    ...DEFAULT_SETTINGS,
    baseUrl: "",
    providerConfigured: settings.providerConfigured === true,
    scraperConfigured: settings.scraperConfigured === true,
    modelName,
    scraperModelName: typeof settings.scraperModelName === "string" && settings.scraperModelName.trim()
      ? settings.scraperModelName.trim() : DEFAULT_SETTINGS.scraperModelName,
    temperature: typeof settings.temperature === "number" && settings.temperature >= 0 && settings.temperature <= 1
      ? settings.temperature : DEFAULT_SETTINGS.temperature,
    maxTokens: normalizeMaxTokens(settings.maxTokens),
    maxPageContentLength: Number.isSafeInteger(settings.maxPageContentLength) && settings.maxPageContentLength > 0 && settings.maxPageContentLength <= 200_000
      ? settings.maxPageContentLength : DEFAULT_SETTINGS.maxPageContentLength,
    qaAgentMemory: typeof settings.qaAgentMemory === "string" && settings.qaAgentMemory.trim()
      ? settings.qaAgentMemory : DEFAULT_QA_AGENT_MEMORY,
  };
}

export function editableSettings(settings: AppSettings) {
  return {
    modelName: settings.modelName,
    scraperModelName: settings.scraperModelName,
    temperature: settings.temperature, maxTokens: settings.maxTokens,
    maxPageContentLength: settings.maxPageContentLength, qaAgentMemory: settings.qaAgentMemory,
  };
}
