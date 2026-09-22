import { normalizeSettings, type AppSettings } from "./providerSettings";
import { finalizeQaResult, type prepareQaInput } from "./qaAgent";
import { extractLLMResponseContent, parseLLMJsonResponse } from "./llmResponse";

type QaInput = ReturnType<typeof prepareQaInput>;

export function buildQaRequest(settings: AppSettings, input: QaInput) {
  const normalized = normalizeSettings(settings);
  return {
    payload: {
      model: normalized.modelName,
      temperature: Number(normalized.temperature),
      max_tokens: normalized.maxTokens,
      response_format: { type: "json_object" },
      messages: input.messages,
    },
  };
}

export function parseQaResponse(data: any, input: QaInput) {
  const reasoningTokens = data?.usage?.completion_tokens_details?.reasoning_tokens;
  const reasoningDetails = Number.isSafeInteger(reasoningTokens) && reasoningTokens > 0
    ? ` The model used ${reasoningTokens} reasoning tokens.` : "";
  if (data?.choices?.[0]?.finish_reason === "length") {
    throw new Error(`LLM exhausted its output token budget before completing the QA answer.${reasoningDetails} Increase Max Output Tokens or choose a model that needs fewer reasoning tokens.`);
  }
  const content = extractLLMResponseContent(data);
  if (!content.trim()) {
    throw new Error(`LLM returned no answer.${reasoningDetails} Check the model and Max Output Tokens in LLM Settings.`);
  }
  return finalizeQaResult(parseLLMJsonResponse(content), input);
}
