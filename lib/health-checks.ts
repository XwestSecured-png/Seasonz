// Sync health checks: catches the quiet failures (a stage that "succeeded"
// but matched nothing, a sport that stopped syncing, games stuck live) and
// stores the result in app_settings "health" for the admin page. Problems
// push to admins once a day per issue.
import { db } from "@/db";
import { appSettings, games, sportGames, syncRuns, users } from "@/db/schema";
import { and, desc, eq, gt, gte, lt, sql } from "drizzle-orm";
import { SPORTS, type SportKey } from "./sports/types";
import { sendAlert } from "./push";

export interface HealthIssue {
  id: string;
  level: "warn" | "error";
  message: string;
}
export interface HealthReport {
  at: string;
  ok: boolean;
  issues: HealthIssue[];
  checked: number;
}

const HOUR = 3600_000;
const OTHER: SportKey[] = ["nba", "wnba", "nhl", "mlb", "ncaaf", "ncaab"];

/** "matched 28 of 28" / "Odds matched to 53 of 53" → [matched, total]. */
export function parseMatched(detail: string | null): [number, number] | null {
  const m = detail?.match(/matched(?: to| for)? (\d+) of (\d+)/i);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

export async function runHealthChecks(now = new Date()): Promise<HealthReport> {
  const issues: HealthIssue[] = [];
  let checked = 0;
  const since24 = new Date(now.getTime() - 24 * HOUR);

  // 1. Stages that errored in the last 24 hours.
  checked++;
  const errs = await db
    .select({ stage: syncRuns.stage, n: sql<number>`count(*)::int`, detail: sql<string>`max(${syncRuns.detail})` })
    .from(syncRuns)
    .where(and(eq(syncRuns.status, "error"), gte(syncRuns.startedAt, since24)))
    .groupBy(syncRuns.stage);
  for (const e of errs) {
    issues.push({ id: `err:${e.stage}`, level: "error", message: `${e.stage} failed ${e.n}× in 24h: ${(e.detail ?? "").slice(0, 140)}` });
  }

  // 2. Each sport's last successful schedule sync (syncs run 3–4× a day).
  const last = await db
    .select({ stage: syncRuns.stage, at: sql<Date>`max(${syncRuns.startedAt})` })
    .from(syncRuns)
    .where(and(eq(syncRuns.status, "ok"), gte(syncRuns.startedAt, new Date(now.getTime() - 7 * 24 * HOUR))))
    .groupBy(syncRuns.stage);
  const lastAt = new Map(last.map((r) => [r.stage, new Date(r.at).getTime()]));
  for (const key of ["schedule", ...OTHER.map((s) => `${s}:schedule`)]) {
    checked++;
    const t = lastAt.get(key);
    if (!t || now.getTime() - t > 15 * HOUR) {
      issues.push({ id: `stale:${key}`, level: "error", message: `${key} hasn't synced in ${t ? Math.round((now.getTime() - t) / HOUR) + "h" : "7+ days"}.` });
    }
  }

  // 3. Odds matching: the latest gameOdds run per sport should match most of the board.
  for (const key of ["gameOdds", ...OTHER.map((s) => `${s}:gameOdds`)]) {
    checked++;
    const [row] = await db
      .select({ detail: syncRuns.detail })
      .from(syncRuns)
      .where(and(eq(syncRuns.stage, key), eq(syncRuns.status, "ok")))
      .orderBy(desc(syncRuns.startedAt))
      .limit(1);
    const m = parseMatched(row?.detail ?? null);
    if (m && m[1] >= 3 && m[0] / m[1] < 0.8) {
      issues.push({ id: `match:${key}`, level: "warn", message: `${key} matched only ${m[0]} of ${m[1]} board games.` });
    }
  }

  // 4. Games starting in the next 24h with no moneyline though ESPN posted one.
  checked++;
  const soon = await db
    .select({ sport: sportGames.sport, home: sportGames.homeTeam, away: sportGames.awayTeam, ml: sportGames.moneylineHomeOdds, extra: sportGames.extra })
    .from(sportGames)
    .where(and(eq(sportGames.isFinal, false), gt(sportGames.kickoffAt, now), lt(sportGames.kickoffAt, new Date(now.getTime() + 24 * HOUR))));
  const missing = new Map<string, string[]>();
  for (const g of soon) {
    const espn = (g.extra as { preview?: { espnOdds?: { mlHome?: number } | null } } | null)?.preview?.espnOdds;
    if (g.ml == null && espn?.mlHome != null) {
      const l = missing.get(g.sport) ?? [];
      l.push(`${g.away}@${g.home}`);
      missing.set(g.sport, l);
    }
  }
  for (const [sport, l] of missing) {
    if (l.length >= 2) {
      issues.push({ id: `noml:${sport}`, level: "warn", message: `${SPORTS[sport as SportKey]?.label ?? sport}: ${l.length} game(s) in 24h have no moneyline though ESPN does (${l.slice(0, 4).join(", ")}).` });
    }
  }

  // 5. NFL games this week with no line at all.
  checked++;
  const nflSoon = await db
    .select({ ml: games.moneylineHomeOdds })
    .from(games)
    .where(and(eq(games.isFinal, false), gt(games.kickoffAt, now), lt(games.kickoffAt, new Date(now.getTime() + 4 * 24 * HOUR))));
  if (nflSoon.length >= 3 && nflSoon.filter((g) => g.ml != null).length === 0) {
    issues.push({ id: "nfl:noboard", level: "error", message: `NFL: none of the ${nflSoon.length} games in the next 4 days has a line.` });
  }

  // 6. Games that started 8+ hours ago and still aren't final.
  checked++;
  const stuckCut = new Date(now.getTime() - 8 * HOUR);
  const stuck = await db
    .select({ sport: sportGames.sport, n: sql<number>`count(*)::int` })
    .from(sportGames)
    .where(and(eq(sportGames.isFinal, false), lt(sportGames.kickoffAt, stuckCut), gt(sportGames.kickoffAt, new Date(now.getTime() - 4 * 24 * HOUR))))
    .groupBy(sportGames.sport);
  const nflStuck = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(games)
    .where(and(eq(games.isFinal, false), lt(games.kickoffAt, stuckCut), gt(games.kickoffAt, new Date(now.getTime() - 4 * 24 * HOUR))));
  for (const s of [...stuck, ...(nflStuck[0]?.n ? [{ sport: "nfl", n: nflStuck[0].n }] : [])]) {
    if (s.n > 0) issues.push({ id: `stuck:${s.sport}`, level: "warn", message: `${s.sport}: ${s.n} game(s) started 8h+ ago but aren't final.` });
  }

  // 7. Props stages that ran but wrote nothing while games are on.
  for (const key of ["props", ...OTHER.map((s) => `${s}:props`)]) {
    checked++;
    const [row] = await db
      .select({ detail: syncRuns.detail, at: syncRuns.startedAt })
      .from(syncRuns)
      .where(and(eq(syncRuns.stage, key), eq(syncRuns.status, "ok"), gte(syncRuns.startedAt, since24)))
      .orderBy(desc(syncRuns.startedAt))
      .limit(1);
    const ev = row?.detail?.match(/(\d+) event\(s\), (\d+) raw line/);
    if (ev && Number(ev[1]) >= 3 && Number(ev[2]) === 0) {
      issues.push({ id: `props:${key}`, level: "warn", message: `${key}: ${ev[1]} events but 0 prop lines.` });
    }
  }

  const report: HealthReport = { at: now.toISOString(), ok: issues.length === 0, issues, checked };
  await db
    .insert(appSettings)
    .values({ key: "health", value: report })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: report, updatedAt: sql`now()` } });

  // Each issue pushes to admins at most once per ET day.
  if (issues.length) {
    const day = now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const admins = await db.select({ id: users.id }).from(users).where(eq(users.isAdmin, true));
    for (const a of admins) {
      for (const i of issues) {
        await sendAlert(a.id, "admin", `health:${i.id}:${day}`, {
          title: `Sync ${i.level === "error" ? "problem" : "warning"}`,
          body: i.message,
          url: "/admin",
          tag: `health-${i.id}`,
        }).catch(() => false);
      }
    }
  }
  return report;
}

export async function getHealthReport(): Promise<HealthReport | null> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "health"));
  return (row?.value as HealthReport) ?? null;
}
