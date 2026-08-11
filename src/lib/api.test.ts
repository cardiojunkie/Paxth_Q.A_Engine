import assert from "node:assert/strict";
import { ApiError, apiFetch } from "./api.ts";

const originalFetch = globalThis.fetch;
let requestInit: RequestInit | undefined;

try {
  globalThis.fetch = async (_input, init) => {
    requestInit = init;
    return new Response(null, { status: 204 });
  };
  await apiFetch("/api/example", { method: "DELETE" });
  assert.equal(new Headers(requestInit?.headers).get("Content-Type"), "application/json");

  globalThis.fetch = async () => new Response(JSON.stringify({
    error: { code: "temporarily_unavailable", message: "Try again later." },
  }), { status: 503, headers: { "Content-Type": "application/json" } });
  await assert.rejects(
    () => apiFetch("/api/example", { method: "PUT", body: "{}" }),
    (error: unknown) => error instanceof ApiError && error.status === 503 && error.message === "Try again later.",
  );
} finally {
  globalThis.fetch = originalFetch;
}
