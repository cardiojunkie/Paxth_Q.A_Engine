import { createHmac, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const SESSION_TTL_SECONDS = 12 * 60 * 60;

export type AuthConfig = {
  username: string;
  passwordHash: string;
  sessionSecret: Buffer;
  publicOrigin: string;
  secureCookies: boolean;
  cookieName: string;
  allowRequestOrigin: boolean;
};

export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const username = env.ADMIN_USERNAME?.trim();
  const passwordHash = env.ADMIN_PASSWORD_SCRYPT?.trim();
  const encodedSecret = env.SESSION_SECRET || "";
  const sessionSecret = Buffer.from(encodedSecret, "base64");
  const origin = env.PUBLIC_ORIGIN?.trim();
  if (!username) throw new Error("ADMIN_USERNAME is required");
  parsePasswordHash(passwordHash || "");
  if (sessionSecret.length < 32 || sessionSecret.toString("base64") !== encodedSecret) throw new Error("SESSION_SECRET must be at least 32 random bytes encoded as canonical base64");
  if (!origin) throw new Error("PUBLIC_ORIGIN is required");
  const parsedOrigin = new URL(origin);
  const publicOrigin = parsedOrigin.origin;
  if (origin !== publicOrigin) throw new Error("PUBLIC_ORIGIN must contain only scheme and host, without a trailing slash, path, query, or fragment");
  const secureCookies = parsedOrigin.protocol === "https:";
  const localHttp = parsedOrigin.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(parsedOrigin.hostname.replace(/^\[|\]$/g, ""));
  if (!secureCookies && (!localHttp || env.NODE_ENV === "production")) throw new Error("PUBLIC_ORIGIN must use HTTPS outside local development");
  return {
    username,
    passwordHash: passwordHash!,
    sessionSecret,
    publicOrigin,
    secureCookies,
    cookieName: secureCookies ? "__Host-paxth_session" : "paxth_session",
    allowRequestOrigin: env.NODE_ENV !== "production",
  };
}

function parsePasswordHash(serialized: string) {
  const [algorithm, n, r, p, saltText, hashText, extra] = serialized.split("$");
  const salt = Buffer.from(saltText || "", "base64");
  const hash = Buffer.from(hashText || "", "base64");
  if (algorithm !== "scrypt" || n !== "131072" || r !== "8" || p !== "1" || extra !== undefined ||
    salt.length < 16 || hash.length !== 32 || salt.toString("base64") !== saltText || hash.toString("base64") !== hashText) {
    throw new Error("ADMIN_PASSWORD_SCRYPT must use scrypt$131072$8$1$<salt-base64>$<32-byte-hash-base64>");
  }
  return { salt, hash };
}

export async function verifyPassword(config: AuthConfig, candidate: string) {
  const { salt, hash } = parsePasswordHash(config.passwordHash);
  const derived = await new Promise<Buffer>((resolve, reject) => scryptCallback(
    candidate,
    salt,
    hash.length,
    { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 },
    (error, key) => error ? reject(error) : resolve(key),
  ));
  return timingSafeEqual(hash, derived);
}

export function createSession(config: AuthConfig, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const payload = Buffer.from(JSON.stringify({ username: config.username, iat, exp: iat + SESSION_TTL_SECONDS })).toString("base64url");
  const signature = createHmac("sha256", config.sessionSecret).update(payload).update("\0").update(config.passwordHash).digest("base64url");
  return `${payload}.${signature}`;
}

export function readSession(config: AuthConfig, request: Pick<Request, "headers">, now = Date.now()) {
  const cookie = request.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${config.cookieName}=`));
  const token = cookie?.slice(config.cookieName.length + 1);
  if (!token) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = createHmac("sha256", config.sessionSecret).update(payload).update("\0").update(config.passwordHash).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return value.username === config.username && Number.isInteger(value.iat) && Number.isInteger(value.exp) && value.iat <= Math.floor(now / 1000) && value.exp > Math.floor(now / 1000)
      ? { username: config.username }
      : null;
  } catch {
    return null;
  }
}

export function setSessionCookie(response: Response, config: AuthConfig, token: string) {
  response.setHeader("Set-Cookie", `${config.cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}${config.secureCookies ? "; Secure" : ""}`);
}

export function clearSessionCookie(response: Response, config: AuthConfig) {
  response.setHeader("Set-Cookie", `${config.cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${config.secureCookies ? "; Secure" : ""}`);
}

export function requireSession(config: AuthConfig) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (!readSession(config, request)) return response.status(401).json({ error: { code: "authentication_required", message: "Authentication required" } });
    next();
  };
}

export function requireSameOrigin(config: AuthConfig) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return next();
    const origin = request.headers.origin;
    let validOrigin = origin === config.publicOrigin;
    if (!validOrigin && config.allowRequestOrigin && typeof origin === "string") {
      try { validOrigin = new URL(origin).origin === `${request.protocol}://${request.get("host")}`; }
      catch { validOrigin = false; }
    }
    if (!validOrigin) return response.status(403).json({ error: { code: "invalid_origin", message: "Invalid request origin" } });
    if (request.headers["content-type"] !== "application/json") return response.status(415).json({ error: { code: "unsupported_media_type", message: "Content-Type must be application/json" } });
    next();
  };
}
