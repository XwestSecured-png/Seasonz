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

// The pooler occasionally fails to reach the database for a moment
// ("Failed to connect to database: timeout"). Retry those connection-level
// failures twice before giving up, so a blip doesn't break a whole page.
// Only connection errors are retried, never query errors.
const isConnectionError = (e: unknown) => {
  const err = e as { code?: string; message?: string } | null;
  return (
    !!err &&
    (["08000", "08001", "08003", "08004", "08006", "57P01", "ECONNRESET", "ETIMEDOUT", "CONNECT_TIMEOUT"].includes(
      String(err.code)
    ) ||
      /failed to connect|connection (terminated|reset)|timeout/i.test(String(err.message)))
  );
};
async function withRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (e) {
      if (attempt >= 2 || !isConnectionError(e)) throw e;
      await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
  }
}
type Unsafe = typeof client.unsafe;
if (!(client as unknown as { __retrying?: boolean }).__retrying) {
  const original: Unsafe = client.unsafe.bind(client);
  const patched = ((query: string, params?: unknown[], options?: unknown) => {
    const first = original(query, params as never, options as never);
    // postgres-js queries are lazy, so a fresh one can be built per attempt.
    return new Proxy(first, {
      get(target, prop) {
        if (prop === "then") {
          return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
            withRetry(() => original(query, params as never, options as never) as unknown as Promise<unknown>).then(res, rej);
        }
        if (prop === "values") {
          return () => withRetry(() => original(query, params as never, options as never).values() as unknown as Promise<unknown>);
        }
        const v = Reflect.get(target, prop);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
  }) as unknown as Unsafe;
  client.unsafe = patched;
  (client as unknown as { __retrying?: boolean }).__retrying = true;
}

export const db = drizzle(client, { schema });
