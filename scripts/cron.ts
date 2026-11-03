// Background jobs, run by GitHub Actions every 30 minutes (1.36.0).
// .github/workflows/sync.yml calls this; it works out what's due the same
// way the database scheduler did (db/migrations/0043) and runs it directly
// against the database, so the website's host does none of this work.
//
//   npx tsx --tsconfig tsconfig.json scripts/cron.ts            -> whatever is due
//   ... scripts/cron.ts --task=sync|refresh|pregame|alerts      -> force one task
//
// The repo is public, so its Actions logs are too: only stage names and
// statuses are printed, and error text is cut short with any URL query
// string removed (API keys travel there).
import { db } from "@/db";
import { appSettings, games, sportGames, syncRuns } from "@/db/schema";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { runFullSync } from "@/lib/sync";
import { runSportSync, sportsDueForPregame } from "@/lib/sports/sync";
import { runMaintenance } from "@/lib/maintenance";
import type { SportKey } from "@/lib/sports/types";

const OTHER: SportKey[] = ["nba", "wnba", "nhl", "mlb", "ncaaf", "ncaab"];
const HOUR = 3600_000;
// Full syncs at midnight and 2pm ET; light pre-game refreshes at 11am and 5pm ET.
const SLOTS: { hour: number; kind: "sync" | "refresh" }[] = [
  { hour: 0, kind: "sync" },
  { hour: 11, kind: "refresh" },
  { hour: 14, kind: "sync" },
  { hour: 17, kind: "refresh" },
];

const clean = (s: string) =>
  s
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "postgres://…")
    .replace(/(https?:\/\/[^\s?"']+)\?[^\s"']*/g, "$1?…")
    .replace(/(api[_-]?key|apikey|key|token)=[^&\s"']+/gi, "$1=…")
    .slice(0, 160);

function log(label: string, rows: { stage: string; status: string; detail?: string }[]) {
  const bad = rows.filter((r) => r.status === "error");
  console.log(`${label}: ${rows.filter((r) => r.status === "ok").length} ok, ${bad.length} error, ${rows.filter((r) => r.status === "skipped").length} skipped`);
  for (const r of bad) console.log(`  ! ${r.stage}: ${clean(r.detail ?? "")}`);
}

/** America/New_York wall-clock parts of an instant. */
function et(d: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false, weekday: "short" })
      .formatToParts(d)
      .map((x) => [x.type, x.value])
  );
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, monday: p.weekday === "Mon" };
}

/** The latest slot that has started, if it started within the last 3 hours. */
function dueSlot(now: Date): { key: string; kind: "sync" | "refresh"; hour: number } | null {
  for (let back = 0; back < 3; back++) {
    const t = et(new Date(now.getTime() - back * HOUR));
    const s = SLOTS.find((x) => x.hour === t.hour);
    if (s) return { key: `${t.date}T${String(s.hour).padStart(2, "0")}`, kind: s.kind, hour: s.hour };
  }
  return null;
}

async function hasGames(sport: SportKey | "nfl", fromMs: number, toMs: number): Promise<boolean> {
  const now = Date.now();
  const from = new Date(now + fromMs);
  const to = new Date(now + toMs);
  const [r] =
    sport === "nfl"
      ? await db.select({ n: sql<number>`count(*)::int` }).from(games).where(and(gte(games.kickoffAt, from), lt(games.kickoffAt, to)))
      : await db
          .select({ n: sql<number>`count(*)::int` })
          .from(sportGames)
          .where(and(eq(sportGames.sport, sport), gte(sportGames.kickoffAt, from), lt(sportGames.kickoffAt, to)));
  return (r?.n ?? 0) > 0;
}

async function getState(): Promise<{ slots?: Record<string, string> }> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "gh_cron"));
  return (row?.value ?? {}) as { slots?: Record<string, string> };
}
async function setState(v: { slots?: Record<string, string> }) {
  await db
    .insert(appSettings)
    .values({ key: "gh_cron", value: v })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: v, updatedAt: sql`now()` } });
}

function nflSeason(now: Date) {
  return now.getMonth() >= 1 ? now.getFullYear() : now.getFullYear() - 1;
}

async function runSlot(kind: "sync" | "refresh", now: Date) {
  const refresh = kind === "refresh";
  const monday = et(now).monday;
  // Full sync: sports with games from 36h ago to 4 days ahead (plus a Monday
  // catch-up for the rest). Refresh: sports playing in the next 14 hours.
  const active = (s: SportKey | "nfl") => (refresh ? hasGames(s, 0, 14 * HOUR) : monday ? Promise.resolve(true) : hasGames(s, -36 * HOUR, 4 * 24 * HOUR));
  if (await active("nfl")) log("nfl", await runFullSync(nflSeason(now)));
  else console.log("nfl: nothing due");
  for (const s of OTHER) {
    if (!(await active(s))) {
      console.log(`${s}: nothing due`);
      continue;
    }
    log(s, await runSportSync(s, undefined, { refresh }));
  }
}

async function main() {
  const now = new Date();
  const forced = process.argv.find((a) => a.startsWith("--task="))?.split("=")[1];
  console.log(`seasonz cron at ${now.toISOString()}${forced ? ` (task=${forced})` : ""}`);

  // 1. Full sync / pre-game refresh, once per slot.
  if (forced === "sync" || forced === "refresh") {
    await runSlot(forced, now);
  } else if (!forced) {
    const slot = dueSlot(now);
    const state = await getState();
    if (slot && !state.slots?.[slot.key]) {
      // The 2pm sync is skipped if a full sync already ran since noon ET (a manual one).
      let skip = false;
      if (slot.hour === 14) {
        const [r] = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(syncRuns)
          .where(and(eq(syncRuns.stage, "schedule"), eq(syncRuns.status, "ok"), gte(syncRuns.startedAt, new Date(now.getTime() - 2 * HOUR))));
        skip = (r?.n ?? 0) > 0;
      }
      // Mark the slot first, so an overlapping or retried run doesn't repeat it.
      const slots = Object.fromEntries(Object.entries(state.slots ?? {}).filter(([k]) => k >= et(new Date(now.getTime() - 3 * 24 * HOUR)).date));
      await setState({ ...state, slots: { ...slots, [slot.key]: now.toISOString() } });
      if (skip) console.log(`${slot.key}: skipped, synced in the last 2 hours`);
      else {
        console.log(`${slot.key}: ${slot.kind}`);
        await runSlot(slot.kind, now);
      }
    } else console.log("no sync slot due");
  }

  // 2. Pre-game props pass: sports with games 30-150 minutes away and no props pass in 110 minutes.
  // Force the nightly self-learning refit now (and print what it learned).
  if (forced === "refit") {
    const out = await runMaintenance(now, true);
    for (const [k, v] of Object.entries(out)) for (const part of String(v ?? "").split(", ")) console.log(`${k}: ${clean(part)}`);
    return;
  }

  if (!forced || forced === "pregame") {
    const due = await sportsDueForPregame();
    if (due.length === 0) console.log("pregame: nothing due");
    for (const s of due) log(`pregame ${s}`, (await runSportSync(s, undefined, { pregame: true })).filter((r) => r.status !== "skipped"));
  }

  // 3. Alerts (+ health checks, refit): every second hour, or when a game starts within the hour.
  if (!forced || forced === "alerts") {
    const h = et(now).hour;
    const soon = forced === "alerts" || (h % 2 === 0 && now.getUTCMinutes() < 30) || (await hasGames("nfl", 0, 65 * 60_000)) || (await Promise.all(OTHER.map((s) => hasGames(s, 0, 65 * 60_000)))).some(Boolean);
    if (soon) {
      const out = await runMaintenance(now);
      for (const [k, v] of Object.entries(out)) console.log(`${k}: ${clean(v)}`);
    } else console.log("alerts: nothing due");
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`failed: ${clean(e instanceof Error ? e.message : String(e))}`);
    // The database driver's own reason (bad password, wrong host...) is on .cause.
    const cause = e instanceof Error ? (e as { cause?: unknown }).cause : null;
    if (cause) {
      const c = cause as { message?: string; code?: string; errno?: string };
      console.error(`cause: ${clean(`${c.code ?? c.errno ?? ""} ${c.message ?? String(cause)}`)}`);
      // Non-secret shape of DATABASE_URL, to spot a malformed link (never the password itself).
      const raw = process.env.DATABASE_URL ?? "";
      try {
        const u = new URL(raw.trim());
        const pw = decodeURIComponent(u.password);
        console.error(
          `link check: scheme=${u.protocol} user=${decodeURIComponent(u.username)} host=${u.hostname} port=${u.port} db=${u.pathname} ` +
            `password length=${pw.length} brackets=${/[[\]]/.test(pw)} spaces=${/\s/.test(pw)} quotes=${/["'‘’“”]/.test(raw)} ` +
            `extra spaces around link=${raw !== raw.trim()} has ?options=${u.search !== ""}`
        );
      } catch {
        console.error(`link check: not a valid URL (length ${raw.length}, starts with "${raw.trim().slice(0, 11)}")`);
      }
    }
    process.exit(1);
  });
