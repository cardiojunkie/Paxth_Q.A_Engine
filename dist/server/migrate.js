// src/server/migrate.ts
import "dotenv/config";

// src/server/database.ts
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
function createPool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error("DATABASE_URL is required");
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname) throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const loopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  if (!loopback && url.searchParams.get("sslmode") !== "verify-full") {
    throw new Error("Remote DATABASE_URL must set sslmode=verify-full");
  }
  return new Pool({ connectionString, max: 3, connectionTimeoutMillis: 15e3 });
}
async function runMigrations(pool2, folder = path.resolve(process.cwd(), "drizzle")) {
  await migrate(drizzle(pool2), { migrationsFolder: folder });
}

// src/server/migrate.ts
var pool;
try {
  pool = createPool(process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL);
  await runMigrations(pool);
  console.log("Database migrations complete.");
} catch (error) {
  console.error({ message: "Database migration failed", code: typeof error?.code === "string" ? error.code.slice(0, 50) : void 0 });
  process.exitCode = 1;
} finally {
  await pool?.end();
}
