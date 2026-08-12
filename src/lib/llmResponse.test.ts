import assert from "node:assert/strict";
import { normalizeMaxTokens } from "../hooks/useSettings";
import { extractLLMResponseContent, parseLLMJsonResponse } from "./llmResponse";

const json = '{"qa_status":"pass","confidence":"high","summary":"OK","issue_count":0,"issues":[],"source_notes":{"sap_used":true,"url_used":false,"source_conflicts":[]}}';

assert.equal(extractLLMResponseContent({ choices: [{ message: { content: json, reasoning_content: "We need to compare the source data first." } }] }), json);
assert.equal(extractLLMResponseContent({ choices: [{ message: { reasoning_content: "We need to compare the source data first." } }] }), "");
assert.equal(parseLLMJsonResponse(json).qa_status, "pass");
assert.throws(() => parseLLMJsonResponse("We need to output JSON only."));
assert.equal(normalizeMaxTokens(40000), 40000);
assert.equal(normalizeMaxTokens("40000"), 40000);
assert.equal(normalizeMaxTokens(0), 4096);
