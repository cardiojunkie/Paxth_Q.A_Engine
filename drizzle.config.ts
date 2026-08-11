import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";

dotenv.config();

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL || (() => {
      throw new Error("DATABASE_MIGRATION_URL or DATABASE_URL is required");
    })(),
  },
  verbose: true,
});
