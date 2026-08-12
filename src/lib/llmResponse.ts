export function extractLLMResponseContent(data: any): string {
  if (!data) return "";
  if (typeof data === "string") return data;

  const choice = data.choices?.[0];
  if (choice) {
    if (typeof choice.message?.content === "string" && choice.message.content.trim()) return choice.message.content;
    if (Array.isArray(choice.message?.content)) {
      const textPart = choice.message.content.find((part: any) => part.text || part.type === "text");
      if (textPart?.text) return textPart.text;
    }
    if (typeof choice.text === "string" && choice.text.trim()) return choice.text;
  }

  if (Array.isArray(data.content)) {
    const textBlock = data.content.find((item: any) => item.type === "text" || item.text);
    if (textBlock?.text) return textBlock.text;
  }

  if (typeof data.content === "string" && data.content.trim()) return data.content;
  if (typeof data.response === "string" && data.response.trim()) return data.response;
  if (typeof data.output === "string" && data.output.trim()) return data.output;
  if (typeof data.result === "string" && data.result.trim()) return data.result;
  return "";
}

export function parseLLMJsonResponse(content: string): any {
  if (!content || typeof content !== "string") throw new Error("Empty or non-string response content from LLM");

  let clean = content.trim().replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (clean.includes("\`\`\`")) clean = clean.replace(/\`\`\`(?:json)?\n?/gi, "").replace(/\n?\`\`\`/gi, "").trim();

  try {
    return JSON.parse(clean);
  } catch (initialError) {
    const firstBrace = clean.indexOf("{");
    const lastBrace = clean.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const json = clean.substring(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(json);
      } catch (subsetError) {
        const fixedCommas = json.replace(/,\s*([\}\]])/g, "$1");
        try {
          return JSON.parse(fixedCommas);
        } catch {
          try {
            return JSON.parse(fixedCommas.replace(/(?<=:\s*"[^"]*)\n([^"]*")/g, "\\n$1"));
          } catch {
            throw subsetError;
          }
        }
      }
    }

    try {
      return JSON.parse(clean.replace(/,\s*([\}\]])/g, "$1"));
    } catch {
      throw initialError;
    }
  }
}
