// Storage guard (1.44.0). The free Supabase plan stops at 500 MB and turns
// the whole database read-only when it's passed (it reached 1.26 GB on
// Nov 12, 2026, mostly from the prop line archive). This runs once a day
// from lib/maintenance.ts and keeps the growing tables to a fixed window, so
// the database stays well under the limit. Deleted rows leave space that
// Postgres reuses for new rows, so the database stops growing.
import { db } from "@/db";
import { sql } from "drizzle-orm";

/** Books whose prop lines are archived (the self-learning compares them on the same line). */
export const ARCHIVE_BOOKS = new Set([
  "Pinnacle",
  "FanDuel",
  "DraftKings",
  "BetMGM",
  "Fanatics",
  "Hard Rock Bet",
  "Kalshi",
  "Novig",
  "ProphetX",
  "PrizePicks",
  "Underdog Fantasy",
]);

/** Books whose raw prop lines are saved for the book-comparison views (1.44.1):
 *  the archive books plus the other big US books. Picks are still built from
 *  every book's price; only what's stored is limited. */
export const RAW_BOOKS = new Set([
  ...ARCHIVE_BOOKS,
  "Caesars",
  "bet365",
  "ESPN BET",
  "BetRivers",
  "DraftKings Pick6",
  "Sleeper",
  "Dabble",
]);

/** How long each kind of row is kept. */
export const KEEP = {
  gradedPropDays: 21, // graded prop lines (self-learning reads up to this far back)
  openPropDays: 3, // ungraded / void prop lines
  rawLineDays: 2, // raw book-comparison lines (refetched every sync)
  syncRunDays: 30, // sync logs
  clientLogDays: 14, // browser diagnostics
};

export async function pruneStorage(): Promise<string> {
  const n = async (q: ReturnType<typeof sql>) => {
    const r = (await db.execute(q)) as unknown as { count?: number } & unknown[];
    return Number((r as { count?: number }).count ?? 0);
  };
  const graded = await n(sql`delete from line_archive where market = 'prop' and result in ('hit', 'miss') and close_at < now() - make_interval(days => ${KEEP.gradedPropDays})`);
  const open = await n(sql`delete from line_archive where market = 'prop' and (result is null or result not in ('hit', 'miss')) and close_at < now() - make_interval(days => ${KEEP.openPropDays})`);
  const raw = await n(sql`delete from sport_prop_lines_raw where fetched_at < now() - make_interval(days => ${KEEP.rawLineDays})`);
  const nflRaw = await n(sql`delete from prop_lines_raw where fetched_at < now() - make_interval(days => ${KEEP.rawLineDays + 5})`);
  const runs = await n(sql`delete from sync_runs where started_at < now() - make_interval(days => ${KEEP.syncRunDays})`);
  const logs = await n(sql`delete from client_logs where at < now() - make_interval(days => ${KEEP.clientLogDays})`).catch(() => 0);
  const [size] = (await db.execute(sql`select pg_database_size(current_database()) as b`)) as unknown as { b: string }[];
  const mb = Math.round(Number(size?.b ?? 0) / 1048576);
  return `removed ${graded + open} archive, ${raw + nflRaw} raw, ${runs} sync log, ${logs} client log rows; database ${mb} MB of 500`;
}
