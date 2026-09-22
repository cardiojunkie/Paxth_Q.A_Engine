import assert from "node:assert/strict";
import { normalizeMaxTokens } from "../hooks/useSettings";
import { extractLLMResponseContent, parseLLMJsonResponse } from "./llmResponse";
import { prepareQaInput } from "./qaAgent";
import { parseQaResponse } from "./qaRequest";

const json = '{"qa_status":"pass","confidence":"high","summary":"OK","issue_count":0,"issues":[],"source_notes":{"sap_used":true,"url_used":false,"source_conflicts":[]}}';

assert.equal(extractLLMResponseContent({ choices: [{ message: { content: json, reasoning_content: "We need to compare the source data first." } }] }), json);
assert.equal(extractLLMResponseContent({ choices: [{ message: { reasoning_content: "We need to compare the source data first." } }] }), "");
assert.equal(parseLLMJsonResponse(json).qa_status, "pass");
assert.throws(() => parseLLMJsonResponse("We need to output JSON only."));
assert.equal(normalizeMaxTokens(40000), 40000);
assert.equal(normalizeMaxTokens("40000"), 40000);
assert.equal(normalizeMaxTokens(0), 4096);

const input = prepareQaInput({
  sku: "test", status: "ready", upload_attributes: { brand: "Brand" }, raw_row: {},
  source: { sap: "Brand: Brand" },
}, [], "Check supplied evidence.", 40000);
const completion = (content: string | null, finish_reason = "stop") => ({ choices: [{ message: { content }, finish_reason }] });
assert.equal(parseQaResponse(completion(json), input).qa_status, "warning", "A valid QA response retains the missing-rules warning");
for (const content of [null, "", " \n "]) {
  assert.throws(() => parseQaResponse(completion(content), input), /LLM returned no answer/);
}
for (const empty of [null, {}, { choices: [] }]) {
  assert.throws(() => parseQaResponse(empty, input), /LLM returned no answer/);
}
assert.throws(() => parseQaResponse({
  choices: [{ message: { content: null, reasoning_content: "Internal reasoning" }, finish_reason: "length" }],
  usage: { completion_tokens: 10000, completion_tokens_details: { reasoning_tokens: 10000 } },
}, input), /output token budget.*10000 reasoning tokens.*Max Output Tokens/);
assert.throws(() => parseQaResponse(completion(json, "length"), input), /output token budget/, "Even valid-looking JSON is incomplete when the provider reports truncation");
assert.throws(() => parseQaResponse(completion('{"qa_status":'), input));
assert.throws(() => parseQaResponse(completion('{"message":"hello"}'), input), /invalid QA result structure/);
assert.throws(() => parseQaResponse({ choices: [{ message: { reasoning_content: json } }] }, input), /LLM returned no answer/);
console.log("LLM response parsing, empty-answer, and token-budget assertions passed.");
