import assert from "node:assert/strict";
import { isPublicAddress, parseScrapeResponse, scrapeWithAgent, validateScrapeInput } from "./scrapeAgent";
import { ProviderError } from "./chatCompletion";

const llm = { baseUrl: "https://gateway.example/v1", apiKey: "test-secret-only", modelName: "perplexity/sonar", maxTokens: 4096 };
const url = "https://example.com/product?variant=42&colour=black";
const signal = new AbortController().signal;
const resolve = (async () => [{ address: "93.184.216.34", family: 4 }]) as any;
const data = (updates: any = {}) => ({
  choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ status: "ok", markdown: "# Product\nModel: A1\nWidth: 20 cm" }) } }],
  citations: [url], ...updates,
});
assert.equal(validateScrapeInput({ url: "example.com/product?variant=42&colour=black#specs", llm }).url, url);
for (const value of [null, 42, "", "file:///etc/passwd", "javascript:alert(1)", "https://user:pass@example.com", "http://127.1", "http://2130706433", "http://[::1]", "http://10.1.1.1", "http://service.local", "http://localhost", "https://example.com\\bad"]) {
  assert.throws(() => validateScrapeInput({ url: value, llm }));
}
assert.throws(() => validateScrapeInput({ url }), /provider/);
assert.throws(() => validateScrapeInput({ url, llm: { ...llm, baseUrl: "file:///tmp" } }), /provider/);
for (const address of ["127.0.0.1", "169.254.169.254", "100.64.0.1", "192.0.2.1", "::1", "fe80::1", "fc00::1", "::ffff:8.8.8.8", "2001:db8::1", "2002:0808:0808::1"]) assert.equal(isPublicAddress(address), false, address);
for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) assert.equal(isPublicAddress(address), true, address);
assert.match(parseScrapeResponse(data(), url), /Source: <https:\/\/example.com\/product\?variant=42&colour=black>/);
assert.match(parseScrapeResponse(data({ citations: [url + "#specs"] }), url), /Model: A1/);
assert.match(parseScrapeResponse(data({
  citations: undefined,
  choices: [{ finish_reason: "stop", message: { ...data().choices[0].message, annotations: [{ type: "url_citation", url_citation: { url } }] } }],
}), url), /Model: A1/);
for (const citations of [[], undefined]) assert.throws(() => parseScrapeResponse(data({ citations }), url), /no source citations/);
for (const citations of [[url, "https://other.example/page"], ["https://example.com/product"], ["https://example.com/product?variant=43&colour=black"], [null], ["https://example.com/product?colour=black&variant=42"]]) {
  assert.throws(() => parseScrapeResponse(data({ citations }), url), /outside/);
}
for (const reason of ["length", "content_filter", undefined]) assert.throws(() => parseScrapeResponse(data({ choices: [{ finish_reason: reason, message: data().choices[0].message }] }), url), /incomplete/);
for (const content of [{ status: "unavailable", markdown: "" }, { status: "ok", markdown: " " }, { status: "ok", markdown: "I cannot browse the page." }, { status: "partial", markdown: "Partial content" }]) {
  assert.throws(() => parseScrapeResponse(data({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] }), url), /unavailable/);
}
assert.throws(() => parseScrapeResponse(data({ choices: [{ finish_reason: "stop", message: { content: "" } }] }), url), /empty or invalid/);
assert.throws(() => parseScrapeResponse(data({ choices: [{ finish_reason: "stop", message: { refusal: "Unavailable" } }] }), url), /refused/);
assert.throws(() => parseScrapeResponse(data(), url, 5), /evidence limit/);

let calls = 0;
const complete = async (base: string, key: string, payload: any) => {
  calls++;
  assert.equal(base, llm.baseUrl); assert.equal(key, llm.apiKey);
  assert.equal(payload.model, llm.modelName);
  assert.equal(payload.max_tokens, llm.maxTokens);
  assert.deepEqual(payload.search_domain_filter, [url]);
  assert.deepEqual(JSON.parse(payload.messages[1].content), { url });
  assert.match(payload.messages[0].content, /untrusted/);
  assert.ok(!JSON.stringify(payload).includes(llm.apiKey));
  assert.ok(!JSON.stringify(payload).includes(llm.baseUrl));
  return Response.json(data());
};
assert.match(await scrapeWithAgent(url, llm, signal, complete, resolve), /Width: 20 cm/);
assert.equal(calls, 1, "Exactly one request, no browser loop or retry");
await assert.rejects(scrapeWithAgent(url, llm, signal, complete, (async () => [{ address: "10.0.0.1" }]) as any), /public internet/);
assert.equal(calls, 1);
await assert.rejects(scrapeWithAgent(url, llm, signal, async () => Response.json({ error: { message: "Bad key " + llm.apiKey + " Bearer private" } }, { status: 401 }), resolve), (error: any) => {
  assert.ok(error instanceof ProviderError); assert.equal(error.status, 502);
  assert.match(error.message, /HTTP 401/); assert.ok(!error.message.includes(llm.apiKey)); assert.ok(!error.message.includes("private"));
  return true;
});
await assert.rejects(scrapeWithAgent(url, llm, signal, async () => new Response("not JSON"), resolve), /unreadable/);
await assert.rejects(scrapeWithAgent(url, llm, AbortSignal.abort(), complete, resolve), /cancelled/);
assert.equal(calls, 1);
const keepAlive = setInterval(() => {}, 1000);
try {
  await assert.rejects(scrapeWithAgent(url, llm, AbortSignal.timeout(20), complete, (() => new Promise(() => {})) as any), /cancelled/);
  await assert.rejects(scrapeWithAgent(url, llm, AbortSignal.timeout(20), async (_base, _key, _body, execution) => {
    await new Promise<void>((_resolve, reject) => execution.addEventListener("abort", () => reject(execution.reason), { once: true }));
    return Response.json(data());
  }, resolve), /cancelled/);
} finally { clearInterval(keepAlive); }
console.log("Scrapper retrieval checks passed: one call, URL restrictions, source metadata, complete content, credential isolation and cancellation.");
