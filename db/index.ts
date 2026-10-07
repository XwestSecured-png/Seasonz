import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

declare global {
  var __seasonzDbClient: ReturnType<typeof postgres> | undefined;
}

// Reuse the connection across hot-reloads in dev, and across invocations on
// a warm serverless instance in production.
const client =
  globalThis.__seasonzDbClient ??
  postgres(process.env.DATABASE_URL!, { max: 5 });

if (process.env.NODE_ENV !== "production") {
  globalThis.__seasonzDbClient = client;
}

export const db = drizzle(client, { schema });
