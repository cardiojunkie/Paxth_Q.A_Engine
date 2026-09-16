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
        typeof set.rulesMarkdown !== "string" || !Number.isFinite(set.createdAt) || !Number.isFinite(set.updatedAt))) {
    throw new Error("The server returned invalid shared QA configuration. Reload and retry.");
  }
  return data;
}

export async function saveQaAgentMemory(qaAgentMemory: string): Promise<string> {
  const response = await fetch("/api/qa-agent-memory", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ qaAgentMemory }),
  });
  if (!response.ok) throw new Error("QA agent memory was not saved to Supabase. Check the database connection and retry.");
  const saved = await response.json();
  if (typeof saved?.qaAgentMemory !== "string" || !saved.qaAgentMemory.trim()) throw new Error("The server did not confirm the saved QA memory.");
  return saved.qaAgentMemory;
}
