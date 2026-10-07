import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

// Next.js convention is .env.local for local secrets; load it explicitly
// since drizzle-kit runs outside Next.js's own env loading.
config({ path: ".env.local" });

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
