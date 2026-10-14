import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { runAlerts } from "@/lib/alerts";
import { runHealthChecks } from "@/lib/health-checks";
import { refitModelWeights } from "@/lib/model-weights";

export const maxDuration = 120;

/**
 * Every 30 minutes (pg_cron): push alerts; hourly: sync health checks;
 * daily: re-test the model-vs-line weights. Cron secret only.
 */
export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const now = new Date();
  const out: Record<string, string> = {};
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "maintenance"));
  const last = (row?.value ?? {}) as { health?: string; weights?: string };
  const force = req.nextUrl.searchParams.get("force") === "1";

  try {
    out.alerts = await runAlerts(now);
  } catch (e) {
    out.alerts = `error: ${e instanceof Error ? e.message : String(e)}`;
  }
  const next = { ...last };
  if (force || !last.health || now.getTime() - Date.parse(last.health) > 55 * 60_000) {
    try {
      const r = await runHealthChecks(now);
      out.health = r.ok ? `ok (${r.checked} checks)` : `${r.issues.length} issue(s): ${r.issues.map((i) => i.id).join(", ")}`;
      next.health = now.toISOString();
    } catch (e) {
      out.health = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  if (force || !last.weights || now.getTime() - Date.parse(last.weights) > 23 * 3600_000) {
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
  return NextResponse.json(out);
}
