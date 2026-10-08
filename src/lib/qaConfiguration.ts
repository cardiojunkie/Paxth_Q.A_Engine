import type { AttributeSet } from "../types";

export interface QaConfiguration {
  qaAgentMemory: string;
  attributeSets: AttributeSet[];
}

export async function fetchQaConfiguration(): Promise<QaConfiguration> {
  const response = await fetch("/api/qa-configuration", { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load shared QA memory and mapping rules from Supabase. Check the database connection and retry.");
  const data = await response.json();
  if (typeof data?.qaAgentMemory !== "string" || !data.qaAgentMemory.trim() || !Array.isArray(data.attributeSets) ||
      data.attributeSets.some((set: any) => typeof set?.id !== "string" || typeof set.name !== "string" ||
        typeof set.rulesMarkdown !== "string" || !Array.isArray(set.catalogHeaders) || set.catalogHeaders.some((header: unknown) => typeof header !== 'string') ||
        !Number.isFinite(set.createdAt) || !Number.isFinite(set.updatedAt))) {
    throw new Error("The server returned invalid shared QA configuration. Reload and retry.");
  }
  return data;
}
