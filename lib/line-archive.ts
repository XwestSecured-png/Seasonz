// Line archive: every prop and game line each sync sees, kept with its
// opening price (first seen) and closing price (last seen; books pull lines
// at kickoff, so the last price seen is the close). Lets us test the model
// against real lines and measure closing-line value later.
import { NFL_EXTRA_FIELDS } from "./props-model";
import { db } from "@/db";
import { games, lineArchive, sportGames, sportPlayerGameStats } from "@/db/schema";
import { and, asc, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import { inBatches } from "./bulk";
import { STAT_EXTRACTORS } from "./sports/stat-extract";
import type { SportKey } from "./sports/types";
import type { PlayerWeekStats } from "./nflverse";
import { MODEL_FAIR_BOOK } from "./football-markets";

export interface ArchiveProp {
  player: string;
  team: string | null;
  statType: string;
  line: number;
  side: string;
  book: string;
  priceAmerican: number;
}

type Row = typeof lineArchive.$inferInsert;

async function upsert(rows: Row[]): Promise<number> {
  const seen = new Set<string>();
  const uniq = rows.filter((r) => {
    const k = `${r.market}|${r.gameKey}|${r.player}|${r.statType}|${r.line}|${r.side}|${r.book}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const now = new Date();
  await inBatches(uniq, 1500, 1, (chunk) =>
    db
      .insert(lineArchive)
      .values(chunk.map((r) => ({ ...r, openAt: now, closeAt: now })))
      .onConflictDoUpdate({
        target: [
          lineArchive.sport,
          lineArchive.season,
          lineArchive.week,
          lineArchive.market,
          lineArchive.gameKey,
          lineArchive.player,
          lineArchive.statType,
          lineArchive.line,
          lineArchive.side,
          lineArchive.book,
        ],
        set: {
          closePrice: sql`excluded.close_price`,
          closeAt: sql`excluded.close_at`,
          team: sql`coalesce(excluded.team, ${lineArchive.team})`,
          modelOver: sql`coalesce(excluded.model_over, ${lineArchive.modelOver})`,
          moves: sql`${lineArchive.moves} + case when ${lineArchive.closePrice} <> excluded.close_price then 1 else 0 end`,
        },
        // Graded lines are history; never touch them again.
        // Only when the price moved, or the "last seen" time is a day old:
        // rewriting every line on every sync (75,000+ on an NFL Sunday) was
        // the props stages' biggest cost. Grading places a line in the
        // team's first game after it was last seen, so a day of slack is safe.
        setWhere: sql`${lineArchive.result} is null and (${lineArchive.closePrice} is distinct from excluded.close_price or ${lineArchive.closeAt} < excluded.close_at - interval '20 hours' or (${lineArchive.team} is null and excluded.team is not null) or (${lineArchive.modelOver} is null and excluded.model_over is not null))`,
      })
  );
  return uniq.length;
}

/** Archives this sync's prop lines (the model's own fair line is left out). */
export async function archivePropLines(
  sport: string,
  season: number,
  week: number,
  props: ArchiveProp[],
  /** The model's own Over chance for a player/stat/line (no market), when it projects one. */
  modelOver?: (player: string, statType: string, line: number) => number | undefined
): Promise<number> {
  // This week's lines already on file: unchanged ones seen in the last 20
  // hours are skipped before anything is sent to the database.
  const existing = await db
    .select({ player: lineArchive.player, statType: lineArchive.statType, line: lineArchive.line, side: lineArchive.side, book: lineArchive.book, closePrice: lineArchive.closePrice, closeAt: lineArchive.closeAt, team: lineArchive.team, result: lineArchive.result, modelOver: lineArchive.modelOver })
    .from(lineArchive)
    // Only open lines seen in the last 20 hours can be skipped, so only those
    // are read back (the whole week is 100,000+ lines on a busy NBA week).
    .where(and(eq(lineArchive.sport, sport), eq(lineArchive.season, season), eq(lineArchive.week, week), eq(lineArchive.market, "prop"), isNull(lineArchive.result), gt(lineArchive.closeAt, new Date(Date.now() - 20 * 3600_000))));
  const fresh = Date.now() - 20 * 3600_000;
  const skip = new Set(
    existing
      // (lines still missing the model's chance are written once to fill it)
      .filter((e) => e.result !== null || (e.closeAt.getTime() > fresh && (e.modelOver !== null || !modelOver)))
      .map((e) => `${e.player}|${e.statType}|${e.line}|${e.side}|${e.book}|${e.result !== null ? "*" : e.closePrice}|${e.result !== null ? "*" : (e.team ?? "")}`)
  );
  const isSkipped = (p: ArchiveProp) =>
    skip.has(`${p.player}|${p.statType}|${p.line}|${p.side}|${p.book}|*|*`) || skip.has(`${p.player}|${p.statType}|${p.line}|${p.side}|${p.book}|${p.priceAmerican}|${p.team ?? ""}`);
  return upsert(
    props
      .filter((p) => !isSkipped(p))
      .filter((p) => p.book !== MODEL_FAIR_BOOK && Number.isFinite(p.priceAmerican))
      .map((p) => ({
        sport,
        season,
        week,
        market: "prop",
        gameKey: "",
        player: p.player,
        team: p.team,
        statType: p.statType,
        line: p.line,
        side: p.side,
        book: p.book,
        openPrice: p.priceAmerican,
        closePrice: p.priceAmerican,
        modelOver: modelOver?.(p.player, p.statType, p.line) ?? null,
      }))
  );
}

interface GameLineSource {
  id: number;
  season: number;
  week: number;
  homeTeam: string;
  awayTeam: string;
  moneylineHomeOdds: number | null;
  moneylineAwayOdds: number | null;
  moneylineBook: string | null;
  spreadHomeLine: number | null;
  spreadHomePriceAmerican: number | null;
  spreadAwayPriceAmerican: number | null;
  spreadBook: string | null;
  totalLine: number | null;
  totalOverPriceAmerican: number | null;
  totalUnderPriceAmerican: number | null;
  totalBook: string | null;
}

function gameRows(sport: string, g: GameLineSource): Row[] {
  const base = { sport, season: g.season, week: g.week, gameKey: String(g.id) };
  const out: Row[] = [];
  const add = (market: string, player: string, team: string | null, statType: string, line: number, side: string, book: string | null, price: number | null) => {
    if (price == null) return;
    out.push({ ...base, market, player, team, statType, line, side, book: book ?? "Book", openPrice: price, closePrice: price });
  };
  add("ml", g.homeTeam, g.homeTeam, "Moneyline", 0, "home", g.moneylineBook, g.moneylineHomeOdds);
  add("ml", g.awayTeam, g.awayTeam, "Moneyline", 0, "away", g.moneylineBook, g.moneylineAwayOdds);
  if (g.spreadHomeLine != null) {
    add("spread", g.homeTeam, g.homeTeam, "Spread", g.spreadHomeLine, "home", g.spreadBook, g.spreadHomePriceAmerican);
    add("spread", g.awayTeam, g.awayTeam, "Spread", -g.spreadHomeLine, "away", g.spreadBook, g.spreadAwayPriceAmerican);
  }
  if (g.totalLine != null) {
    add("total", "game", null, "Total", g.totalLine, "Over", g.totalBook, g.totalOverPriceAmerican);
    add("total", "game", null, "Total", g.totalLine, "Under", g.totalBook, g.totalUnderPriceAmerican);
  }
  return out;
}

/** Archives the current lines of every game that hasn't started yet. */
export async function archiveGameLines(sport: string): Promise<number> {
  const now = new Date();
  const rows =
    sport === "nfl"
      ? await db.select().from(games).where(and(eq(games.isFinal, false), gt(games.kickoffAt, now)))
      : await db.select().from(sportGames).where(and(eq(sportGames.sport, sport), eq(sportGames.isFinal, false), gt(sportGames.kickoffAt, now)));
  return upsert(rows.flatMap((g) => gameRows(sport, g as GameLineSource)));
}

// ---------------------------------------------------------------- grading

const NFL_FIELD: Record<string, keyof PlayerWeekStats> = {
  "Pass Yds": "passYds",
  "Rush Yds": "rushYds",
  "Rec Yds": "recYds",
  "Rush + Rec Yds": "rushRecYds",
  Receptions: "receptions",
  ...Object.fromEntries(NFL_EXTRA_FIELDS.map((f) => [f.statType, f.field])),
};
const nameKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const over = (side: string) => /^(over|yes|home)$/i.test(side);
function outcome(side: string, line: number, actual: number): "hit" | "miss" | "push" {
  if (actual === line) return "push";
  return over(side) === actual > line ? "hit" : "miss";
}

/**
 * Grades archived lines whose game is final: game lines from final scores,
 * props from box scores (NFL from nflverse weekly rows). Props we can't
 * extract a stat for stay ungraded; a player with no box line is "void".
 */
export async function gradeLineArchive(sport: string, nflWeekStats?: PlayerWeekStats[]): Promise<string> {
  const pending = await db
    .select()
    .from(lineArchive)
    .where(and(eq(lineArchive.sport, sport), isNull(lineArchive.result), lte(lineArchive.closeAt, new Date(Date.now() - 3 * 3600_000))))
    // Oldest first: with 100k+ lines waiting (most for games not played
    // yet), an unordered batch could keep missing the gradable ones.
    .orderBy(asc(lineArchive.closeAt))
    .limit(40000);
  if (pending.length === 0) return "No archived lines to grade.";
  // Results are collected and written in bulk at the end (one UPDATE per
  // 1,000 lines; one per bet took up to 70s on a busy night).
  const updates: { id: number; result: string; actual: number | null }[] = [];
  const set = async (ids: number[], result: string, actual: number | null) => {
    for (const id of ids) updates.push({ id, result, actual });
  };
  const flush = () =>
    inBatches(updates, 1000, 1, (chunk) =>
      db.execute(sql`
        update ${lineArchive} as la set result = v.result, actual = v.actual
        from (values ${sql.join(
          chunk.map((u) => sql`(${u.id}::bigint, ${u.result}::text, ${u.actual}::real)`),
          sql`, `
        )}) as v(id, result, actual)
        where la.id = v.id`)
    );
  // Group identical bets across books so each is graded once.
  const groups = new Map<string, typeof pending>();
  for (const r of pending) {
    const k = `${r.market}|${r.gameKey}|${r.player}|${r.team}|${r.statType}|${r.line}|${r.side}|${r.week}|${r.season}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }

  // Games (for game lines and to place props).
  type G = { id: number; home: string; away: string; hs: number | null; as: number | null; final: boolean; at: number; season: number; week: number };
  const seasons = [...new Set(pending.map((p) => p.season))];
  const gameRows: G[] =
    sport === "nfl"
      ? (await db.select().from(games).where(inArray(games.season, seasons))).map((g) => ({
          id: g.id, home: g.homeTeam, away: g.awayTeam, hs: g.homeScore, as: g.awayScore, final: g.isFinal, at: g.kickoffAt?.getTime() ?? 0, season: g.season, week: g.week,
        }))
      : (await db.select().from(sportGames).where(and(eq(sportGames.sport, sport), inArray(sportGames.season, seasons)))).map((g) => ({
          id: g.id, home: g.homeTeam, away: g.awayTeam, hs: g.homeScore, as: g.awayScore, final: g.isFinal, at: g.kickoffAt?.getTime() ?? 0, season: g.season, week: g.week,
        }));
  const byId = new Map(gameRows.map((g) => [String(g.id), g]));
  const nextGame = (team: string, after: number) =>
    gameRows.filter((g) => (g.home === team || g.away === team) && g.at >= after - 4 * 3600_000).sort((a, b) => a.at - b.at)[0];

  // Box scores for other sports' props.
  const extractors = STAT_EXTRACTORS[sport as SportKey] ?? [];
  const propGames = new Set<number>();
  for (const rows of groups.values()) {
    const r = rows[0];
    if (r.market !== "prop" || !r.team || sport === "nfl") continue;
    const g = nextGame(r.team, r.closeAt.getTime());
    if (g?.final) propGames.add(g.id);
  }
  const box = propGames.size
    ? await db
        .select({ gameId: sportPlayerGameStats.gameId, player: sportPlayerGameStats.player, stats: sportPlayerGameStats.stats })
        .from(sportPlayerGameStats)
        .where(and(eq(sportPlayerGameStats.sport, sport), inArray(sportPlayerGameStats.gameId, [...propGames])))
    : [];
  const boxBy = new Map(box.map((b) => [`${b.gameId}|${nameKey(b.player)}`, b.stats as Record<string, string>]));
  const hasBox = new Set(box.map((b) => b.gameId));
  const nflBy = new Map((nflWeekStats ?? []).map((r) => [`${r.season}|${r.week}|${nameKey(r.player)}`, r]));
  const nflWeeks = new Set((nflWeekStats ?? []).map((r) => `${r.season}|${r.week}`));

  let graded = 0;
  let voided = 0;
  for (const rows of groups.values()) {
    const r = rows[0];
    const ids = rows.map((x) => x.id);
    if (r.market !== "prop") {
      const g = byId.get(r.gameKey);
      if (!g?.final || g.hs == null || g.as == null) continue;
      let actual: number;
      if (r.market === "total") actual = g.hs + g.as;
      else {
        const margin = r.side === "home" ? g.hs - g.as : g.as - g.hs;
        actual = r.market === "ml" ? (margin > 0 ? 1 : margin < 0 ? -1 : 0) : margin + r.line;
      }
      const res = r.market === "total" ? outcome(r.side, r.line, actual) : actual > 0 ? "hit" : actual < 0 ? "miss" : "push";
      await set(ids, res, actual);
      graded += ids.length;
      continue;
    }
    // A line whose game never went final (or never got a box score) 5+ days
    // after it was last seen is voided rather than left waiting forever.
    const stale = r.closeAt.getTime() < Date.now() - 5 * 86_400_000;
    if (!r.team) {
      if (stale) {
        await set(ids, "void", null);
        voided += ids.length;
      }
      continue;
    }
    const g = nextGame(r.team, r.closeAt.getTime());
    if (!g?.final) {
      if (stale) {
        await set(ids, "void", null);
        voided += ids.length;
      }
      continue;
    }
    let actual: number | null = null;
    let known = false;
    if (sport === "nfl") {
      const field = NFL_FIELD[r.statType];
      if (!field || !nflWeeks.has(`${g.season}|${g.week}`)) continue;
      const row = nflBy.get(`${g.season}|${g.week}|${nameKey(r.player)}`);
      known = true;
      actual = row ? Number(row[field]) || 0 : null;
    } else {
      const ex = extractors.find((e) => e.statType === r.statType);
      if (!ex || !hasBox.has(g.id)) {
        if (stale && g.at < Date.now() - 4 * 86_400_000) {
          await set(ids, "void", null);
          voided += ids.length;
        }
        continue;
      }
      known = true;
      const st = boxBy.get(`${g.id}|${nameKey(r.player)}`);
      actual = st ? ex.extract(st) : null;
    }
    if (!known) continue;
    if (actual === null) {
      await set(ids, "void", null);
      voided += ids.length;
    } else {
      await set(ids, outcome(r.side, r.line, actual), actual);
      graded += ids.length;
    }
  }
  await flush();
  return `Line archive: graded ${graded}, voided ${voided}, ${pending.length - graded - voided} waiting.`;
}
