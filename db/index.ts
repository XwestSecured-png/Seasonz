import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

declare global {
  var __seasonzDbClient: ReturnType<typeof postgres> | undefined;
}

// Reuse the connection across hot-reloads in dev, and across invocations on
// a warm serverless instance in production.
//
// Production connects through Supabase's TRANSACTION pooler (port 6543),
// which shares a small number of real database connections across every
// serverless instance. That mode doesn't support prepared statements, so
// `prepare: false`. Idle connections close after 20s so warm instances
// don't sit on pool slots (the session pooler capped Seasonz at 15 and
// syncs failed once warm instances held them all).
const client =
  globalThis.__seasonzDbClient ??
  postgres(process.env.DATABASE_URL!, { max: 5, prepare: false, idle_timeout: 20 });

if (process.env.NODE_ENV !== "production") {
  globalThis.__seasonzDbClient = client;
}

export const db = drizzle(client, { schema });
