import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";

const AAD = Buffer.from("paxth-app-settings-v1");

export type AppSettings = {
  baseUrl: string;
  apiKey: string;
  modelName: string;
  temperature: number;
  maxTokens: number;
  maxRetries: number;
  scraperTimeout: number;
  maxPageContentLength: number;
};

export const defaultSettings: AppSettings = {
  baseUrl: "https://api.openai.com/v1/chat/completions",
  apiKey: "",
  modelName: "gpt-4.1-mini",
  temperature: 0.1,
  maxTokens: 4096,
  maxRetries: 2,
  scraperTimeout: 30000,
  maxPageContentLength: 40000,
};

export function loadSettingsKey(env: NodeJS.ProcessEnv = process.env) {
  const encoded = env.SETTINGS_ENCRYPTION_KEY || "";
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) {
    throw new Error("SETTINGS_ENCRYPTION_KEY must be exactly 32 bytes encoded as canonical base64");
  }
  return key;
}

export function encryptSettings(settings: AppSettings, key: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(settings), "utf8"), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64") };
}

export function decryptSettings(row: { ciphertext: string; iv: string; auth_tag: string; key_version?: number }, key: Buffer): AppSettings {
  if (row.key_version !== undefined && row.key_version !== 1) throw new Error("Unsupported settings encryption key version");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(row.iv, "base64"));
  decipher.setAAD(AAD);
  decipher.setAuthTag(Buffer.from(row.auth_tag, "base64"));
  const parsed = JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(row.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8"));
  return parseSettings(parsed, defaultSettings, true);
}

export function parseSettings(input: unknown, current = defaultSettings, allowApiKey = true): AppSettings {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Settings must be an object");
  const value = input as Record<string, unknown>;
  const text = (name: string, fallback: string, max: number) => {
    const candidate = value[name] === undefined ? fallback : value[name];
    if (typeof candidate !== "string" || !candidate.trim() || candidate.length > max) throw new Error(`${name} is invalid`);
    return candidate.trim();
  };
  const number = (name: string, fallback: number, min: number, max: number, integer = true) => {
    const candidate = value[name] === undefined ? fallback : value[name];
    if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate < min || candidate > max || (integer && !Number.isInteger(candidate))) {
      throw new Error(`${name} must be ${integer ? "an integer" : "a number"} from ${min} to ${max}`);
    }
    return candidate;
  };
  const suppliedKey = value.apiKey;
  if (suppliedKey !== undefined && (!allowApiKey || (suppliedKey !== null && (typeof suppliedKey !== "string" || suppliedKey.length > 4096)))) throw new Error("apiKey is invalid");
  return {
    baseUrl: text("baseUrl", current.baseUrl, 2048).replace(/\/+$/, ""),
    apiKey: suppliedKey === null ? "" : allowApiKey && typeof suppliedKey === "string" && suppliedKey.trim() ? suppliedKey : current.apiKey,
    modelName: text("modelName", current.modelName, 200),
    temperature: number("temperature", current.temperature, 0, 1, false),
    maxTokens: number("maxTokens", current.maxTokens, 1, 4096),
    maxRetries: number("maxRetries", current.maxRetries, 0, 3),
    scraperTimeout: number("scraperTimeout", current.scraperTimeout, 5000, 45000),
    maxPageContentLength: number("maxPageContentLength", current.maxPageContentLength, 1000, 100000),
  };
}

type Queryable = Pick<Pool | PoolClient, "query">;

export async function readSettings(db: Queryable, key: Buffer) {
  const { rows } = await db.query("select ciphertext, iv, auth_tag, key_version from app_settings where id = 1");
  return rows[0]?.ciphertext && rows[0]?.iv && rows[0]?.auth_tag ? decryptSettings(rows[0], key) : defaultSettings;
}

export async function writeSettings(db: Queryable, key: Buffer, settings: AppSettings) {
  const encrypted = encryptSettings(settings, key);
  await db.query(`
    insert into app_settings (id, ciphertext, iv, auth_tag, key_version, migration_version, updated_at)
    values (1, $1, $2, $3, 1, '0000_vps_ready', now())
    on conflict (id) do update set ciphertext = excluded.ciphertext, iv = excluded.iv,
      auth_tag = excluded.auth_tag, key_version = 1, updated_at = now()
  `, [encrypted.ciphertext, encrypted.iv, encrypted.authTag]);
}

export function publicSettings(settings: AppSettings) {
  const { apiKey, ...safe } = settings;
  return { llmProvider: "openai-compatible", ...safe, hasApiKey: Boolean(apiKey) };
}
