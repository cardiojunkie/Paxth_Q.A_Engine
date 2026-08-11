import "dotenv/config";
import { createPool, runMigrations } from "./database.js";

let pool;
try {
  pool = createPool(process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL);
  await runMigrations(pool);
  console.log("Database migrations complete.");
} catch (error: any) {
  console.error({ message: "Database migration failed", code: typeof error?.code === "string" ? error.code.slice(0, 50) : undefined });
  process.exitCode = 1;
} finally {
  await pool?.end();
}
