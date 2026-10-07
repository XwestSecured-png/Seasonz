import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { DEFAULT_LIMITS, type AppLimits } from "./tiers";

// A single row, keyed "limits", holding the whole AppLimits object as JSON
// (see db/schema.ts's appSettings comment for why one JSON row rather than
// one column per setting).
const SETTINGS_KEY = "limits";

/** The live app-wide limits — DEFAULT_LIMITS merged with whatever the admin dashboard has overridden (missing keys, or no row at all yet, fall back to the default). */
export async function getAppLimits(): Promise<AppLimits> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, SETTINGS_KEY));
  if (!row) return DEFAULT_LIMITS;
  return { ...DEFAULT_LIMITS, ...(row.value as Partial<AppLimits>) };
}

/** Merges `patch` into the live limits and persists the result — used by the admin dashboard's Settings tab. */
export async function setAppLimits(patch: Partial<AppLimits>): Promise<AppLimits> {
  const current = await getAppLimits();
  const next: AppLimits = { ...current, ...patch };
  await db
    .insert(appSettings)
    .values({ key: SETTINGS_KEY, value: next })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: next, updatedAt: sql`now()` },
    });
  return next;
}
