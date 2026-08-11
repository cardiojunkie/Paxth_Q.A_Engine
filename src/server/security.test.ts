import assert from "node:assert/strict";
import {
  createSession,
  loadAuthConfig,
  readSession,
  requireSameOrigin,
  setSessionCookie,
  verifyPassword,
} from "./auth.ts";
import { requirePublicHttpsUrl } from "./outbound.ts";
import { parseQaContent, validateQaResult } from "./qa.ts";
import {
  decryptSettings,
  encryptSettings,
  parseSettings,
  publicSettings,
  type AppSettings,
} from "./settings.ts";

const passwordHash = "scrypt$131072$8$1$MDEyMzQ1Njc4OWFiY2RlZg==$6FprYHTFsXknvwZ92YQBgBBStM5YQLYkqgAq+B0yKwM=";
const rotatedPasswordHash = "scrypt$131072$8$1$ZmVkY2JhOTg3NjU0MzIxMA==$+duMKXnVbBKdS8eNkzCzVTktIsNbOIGlyWAX2ZWA8q0=";
const sessionSecret = Buffer.alloc(32, 7).toString("base64");
const auth = loadAuthConfig({
  ADMIN_USERNAME: "admin",
  ADMIN_PASSWORD_SCRYPT: passwordHash,
  SESSION_SECRET: sessionSecret,
  PUBLIC_ORIGIN: "https://enzqm.aiccloud.online",
  NODE_ENV: "production",
});

assert.equal(await verifyPassword(auth, "correct horse battery staple"), true);
assert.equal(await verifyPassword(auth, "wrong password"), false);
assert.throws(() => loadAuthConfig({ ...process.env, ADMIN_USERNAME: "admin", ADMIN_PASSWORD_SCRYPT: `${passwordHash}=`, SESSION_SECRET: sessionSecret, PUBLIC_ORIGIN: auth.publicOrigin }), /ADMIN_PASSWORD_SCRYPT/);

const now = Date.UTC(2026, 7, 11);
const token = createSession(auth, now);
const request = (value: string) => ({ headers: { cookie: `${auth.cookieName}=${value}` } });
assert.deepEqual(readSession(auth, request(token), now), { username: "admin" });
assert.equal(readSession(auth, request(`${token}x`), now), null);
assert.equal(readSession(auth, request(token), now + 12 * 60 * 60 * 1000), null);
assert.equal(readSession({ ...auth, passwordHash: rotatedPasswordHash }, request(token), now), null);
assert.equal(readSession({ ...auth, sessionSecret: Buffer.alloc(32, 8) }, request(token), now), null);

let cookie = "";
setSessionCookie({ setHeader: (name: string, value: string | number | readonly string[]) => {
  assert.equal(name, "Set-Cookie");
  cookie = String(value);
} } as Parameters<typeof setSessionCookie>[0], auth, token);
assert.match(cookie, /^__Host-paxth_session=/);
for (const attribute of ["Path=/", "HttpOnly", "Secure", "SameSite=Strict", "Max-Age=43200"]) assert.match(cookie, new RegExp(attribute));

function checkOrigin(headers: Record<string, string>) {
  let status = 0;
  let next = false;
  const response = {
    status(value: number) { status = value; return this; },
    json() { return this; },
  };
  requireSameOrigin(auth)(
    { method: "POST", headers, is: (type: string) => type === "application/json" && headers["content-type"] === "application/json" } as Parameters<ReturnType<typeof requireSameOrigin>>[0],
    response as Parameters<ReturnType<typeof requireSameOrigin>>[1],
    (() => { next = true; }) as Parameters<ReturnType<typeof requireSameOrigin>>[2],
  );
  return { status, next };
}
assert.deepEqual(checkOrigin({ origin: auth.publicOrigin, "content-type": "application/json" }), { status: 0, next: true });
assert.deepEqual(checkOrigin({ origin: "https://evil.example", "content-type": "application/json" }), { status: 403, next: false });
assert.deepEqual(checkOrigin({ origin: auth.publicOrigin }), { status: 415, next: false });
assert.deepEqual(checkOrigin({ origin: auth.publicOrigin, "content-type": "application/json; charset=utf-8" }), { status: 415, next: false });

const settings: AppSettings = {
  baseUrl: "https://api.example.com/v1/chat/completions",
  apiKey: "secret-api-key",
  modelName: "test-model",
  temperature: 0,
  maxTokens: 4096,
  maxRetries: 0,
  scraperTimeout: 5000,
  maxPageContentLength: 1000,
};
const settingsKey = Buffer.alloc(32, 9);
const encrypted = encryptSettings(settings, settingsKey);
assert.equal(Buffer.from(encrypted.iv, "base64").length, 12);
assert.doesNotMatch(encrypted.ciphertext, /secret-api-key/);
assert.deepEqual(decryptSettings({ ...encrypted, auth_tag: encrypted.authTag }, settingsKey), settings);
assert.throws(() => decryptSettings({ ...encrypted, auth_tag: encrypted.authTag }, Buffer.alloc(32, 10)));
const safeSettings = publicSettings(settings);
assert.equal("apiKey" in safeSettings, false);
assert.equal(safeSettings.hasApiKey, true);
assert.deepEqual(parseSettings({ temperature: 0, maxRetries: 0 }, { ...settings, temperature: 0.7, maxRetries: 3 }), settings);

type Lookup = NonNullable<Parameters<typeof requirePublicHttpsUrl>[1]>;
const lookup = (records: { address: string; family: 4 | 6 }[]) => (async () => records) as unknown as Lookup;
const publicLookup = lookup([{ address: "93.184.216.34", family: 4 }]);
assert.equal((await requirePublicHttpsUrl("https://example.com/products/1", publicLookup)).href, "https://example.com/products/1");
for (const url of [
  "http://example.com",
  "https://user:pass@example.com",
  "https://example.com:444/",
  "https://example.com/#fragment",
  "https://localhost/",
  "https://127.0.0.1/",
  "https://0x7f000001/",
  "https://[::1]/",
  "https://[::ffff:127.0.0.1]/",
  "https://[2001:db8::1]/",
  "https://169.254.169.254/latest/meta-data/",
]) await assert.rejects(() => requirePublicHttpsUrl(url, publicLookup));
await assert.rejects(
  () => requirePublicHttpsUrl("https://mixed.example/", lookup([
    { address: "93.184.216.34", family: 4 },
    { address: "10.0.0.1", family: 4 },
  ])),
  /private or reserved/,
);

const validFail = {
  qa_status: "fail",
  confidence: "high",
  summary: "The source contradicts the uploaded value.",
  issue_count: 1,
  issues: [{
    field: "colour",
    issue_type: "data_mismatch",
    severity: "critical",
    uploaded_value: "blue",
    source_truth: "red",
    explanation: "Values differ.",
    suggested_fix: "Use red.",
    cell_color: "red",
  }],
  source_notes: { sap_used: true, url_used: false, source_conflicts: [] },
};
assert.equal(parseQaContent(JSON.stringify(validFail)).qa_status, "fail");
assert.throws(() => validateQaResult({}));
assert.throws(() => parseQaContent("```json\n" + JSON.stringify(validFail) + "\n```"));
assert.throws(() => validateQaResult({ ...validFail, qa_status: "broken" }), /qa_status/);
assert.throws(() => validateQaResult({ ...validFail, issue_count: 0 }), /issue_count/);
assert.throws(() => validateQaResult({ ...validFail, issues: Array(101).fill(validFail.issues[0]), issue_count: 101 }), /issues/);
assert.throws(() => validateQaResult({ ...validFail, source_notes: undefined }), /source_notes/);
