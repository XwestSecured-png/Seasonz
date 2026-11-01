// Alerts, sync health checks and the model refit (was the body of
// /api/alerts; shared with the GitHub Actions runner in 1.36.0).
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { runAlerts } from "./alerts";
import { runHealthChecks } from "./health-checks";
import { refitModelWeights } from "./model-weights";

/**
 * Push alerts every call; sync health checks every 4 hours; re-learn the
 * model weights once a day (the first run after 10am ET picks up the
 * overnight results).
 */
export async function runMaintenance(now = new Date(), force = false): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "maintenance"));
  const last = (row?.value ?? {}) as { health?: string; weights?: string };

  try {
    out.alerts = await runAlerts(now);
  } catch (e) {
    out.alerts = `error: ${e instanceof Error ? e.message : String(e)}`;
  }
  const next = { ...last };
  if (force || !last.health || now.getTime() - Date.parse(last.health) > 235 * 60_000) {
    try {
      const r = await runHealthChecks(now);
      out.health = r.ok ? `ok (${r.checked} checks)` : `${r.issues.length} issue(s): ${r.issues.map((i) => i.id).join(", ")}`;
      next.health = now.toISOString();
    } catch (e) {
      out.health = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  const etHour = Number(now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }));
  const since = last.weights ? now.getTime() - Date.parse(last.weights) : Infinity;
  if (force || since > 23.5 * 3600_000 || (etHour >= 10 && since > 16 * 3600_000)) {
    try {
      out.weights = await refitModelWeights();
      next.weights = now.toISOString();
    } catch (e) {
      out.weights = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  await db
    .insert(appSettings)
    .values({ key: "maintenance", value: next })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: next, updatedAt: sql`now()` } });
  return out;
}
