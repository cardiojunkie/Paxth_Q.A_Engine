import assert from "node:assert/strict";
import { getDatabaseErrorDetails } from "./databaseError";

const rootCause = Object.assign(
  new Error("getaddrinfo ENOTFOUND db.example.supabase.co"),
  { code: "ENOTFOUND" },
);
const wrappedError = Object.assign(new Error("Failed query"), { cause: rootCause });

assert.deepEqual(getDatabaseErrorDetails(wrappedError), {
  code: "ENOTFOUND",
  message: "getaddrinfo ENOTFOUND db.example.supabase.co",
});

const credentialError = new Error("Connection failed: postgresql://postgres:super-secret@example.com/postgres");
const redacted = getDatabaseErrorDetails(credentialError);
assert.ok(!redacted.message.includes("super-secret"));
assert.ok(redacted.message.includes("[redacted database URL]"));

console.log("Database error formatting assertions passed.");
