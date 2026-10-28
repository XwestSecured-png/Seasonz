import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { runAlerts } from "@/lib/alerts";
import { runHealthChecks } from "@/lib/health-checks";
import { refitModelWeights } from "@/lib/model-weights";

export const maxDuration = 120;

/**
 * pg_cron calls this when a game starts within the hour (lock reminders)
 * and every second hour otherwise (1.35.0): push alerts; every 4 hours:
 * sync health checks; daily: re-learn the model weights. Cron secret only.
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
  if (force || !last.health || now.getTime() - Date.parse(last.health) > 235 * 60_000) {
    try {
      const r = await runHealthChecks(now);
      out.health = r.ok ? `ok (${r.checked} checks)` : `${r.issues.length} issue(s): ${r.issues.map((i) => i.id).join(", ")}`;
      next.health = now.toISOString();
    } catch (e) {
      out.health = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  // Re-learn once a day (1.35.0, was twice): the refit is the heaviest job
  // the app runs, and a day's grading lands overnight anyway. The first run
  // after 10am ET picks up that night's results.
  const etHour = Number(now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }));
  const dueWeights = !last.weights || now.getTime() - Date.parse(last.weights) > 23.5 * 3600_000 || (etHour >= 10 && now.getTime() - Date.parse(last.weights) > 16 * 3600_000);
  if (force || dueWeights) {
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
