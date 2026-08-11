import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

export function createPool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error("DATABASE_URL is required");
  let url: URL;
  try { url = new URL(connectionString); } catch { throw new Error("DATABASE_URL must be a valid PostgreSQL URL"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname) throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const loopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  if (!loopback && url.searchParams.get("sslmode") !== "verify-full") {
    throw new Error("Remote DATABASE_URL must set sslmode=verify-full");
  }
  return new Pool({ connectionString, max: 3, connectionTimeoutMillis: 15000 });
}

export async function runMigrations(pool: Pool, folder = path.resolve(process.cwd(), "drizzle")) {
  await migrate(drizzle(pool), { migrationsFolder: folder });
}

export async function verifyMigrations(pool: Pool) {
  const { rows } = await pool.query("select migration_version from app_settings where id = 1");
  if (rows[0]?.migration_version !== "0000_vps_ready") throw new Error("Database migrations are not current");
}
