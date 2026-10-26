// Prop pick log: every prop the model lists is saved with its model-only
// chance, the market's no-vig chance and the final blended chance, then
// graded once the game is final. lib/model-weights.ts re-fits each sport's
// model/market blend for props from these graded picks.
import { NFL_EXTRA_FIELDS } from "./props-model";
import { db } from "@/db";
import { games, propPickLog, sportGames, sportPlayerGameStats } from "@/db/schema";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { STAT_EXTRACTORS } from "./sports/stat-extract";
import type { SportKey } from "./sports/types";
import type { PlayerWeekStats } from "./nflverse";

export interface LoggablePick {
  player: string;
  team: string;
  statType: string;
  line: number;
  side: "Over" | "Under";
  book: string;
  priceAmerican: number;
  modelWinPct: number;
  modelOnly?: number;
  modelBase?: number;
  market?: number | null;
  gameDate: string | null;
  trust?: { adj: number } | null;
}

/** Saves this sync's picks (one row per player/stat/line/side). Rows already graded are never touched. */
export async function logPropPicks(sport: string, season: number, week: number, picks: LoggablePick[]): Promise<number> {
  const seen = new Set<string>();
  const rows = [];
  for (const p of picks) {
    const k = `${p.player}|${p.statType}|${p.line}|${p.side}`;
    if (seen.has(k)) continue;
    seen.add(k);
    rows.push({
      sport,
      season,
      week,
      player: p.player,
      statType: p.statType,
      line: p.line,
      side: p.side,
      book: p.book,
      priceAmerican: p.priceAmerican,
      modelOnly: p.modelOnly ?? p.modelWinPct,
      market: p.market ?? null,
      final: p.modelWinPct,
      trustAdj: p.trust?.adj ?? null,
      modelBase: p.modelBase ?? null,
      gameDate: p.gameDate,
      team: p.team,
      loggedAt: new Date(),
    });
  }
  // Batched; closing numbers keep updating until the pick is graded.
  for (let i = 0; i < rows.length; i += 300) {
    await db
      .insert(propPickLog)
      .values(rows.slice(i, i + 300))
      .onConflictDoUpdate({
        target: [propPickLog.sport, propPickLog.season, propPickLog.week, propPickLog.player, propPickLog.statType, propPickLog.line, propPickLog.side],
        set: {
          book: sql`excluded.book`,
          priceAmerican: sql`excluded.price_american`,
          modelOnly: sql`excluded.model_only`,
          market: sql`excluded.market`,
          final: sql`excluded.final`,
          trustAdj: sql`excluded.trust_adj`,
          modelBase: sql`excluded.model_base`,
          gameDate: sql`excluded.game_date`,
          team: sql`excluded.team`,
          loggedAt: sql`excluded.logged_at`,
        },
        setWhere: isNull(propPickLog.result),
      });
  }
  return rows.length;
}

function outcome(side: string, line: number, actual: number): "hit" | "miss" | "push" {
  if (actual === line) return "push";
  return (side === "Over") === actual > line ? "hit" : "miss";
}

const NFL_FIELD: Record<string, keyof PlayerWeekStats> = {
  "Pass Yds": "passYds",
  "Rush Yds": "rushYds",
  "Rec Yds": "recYds",
  "Rush + Rec Yds": "rushRecYds",
  Receptions: "receptions",
  ...Object.fromEntries(NFL_EXTRA_FIELDS.map((f) => [f.statType, f.field])),
};
const norm = (s: string) => s.trim().toLowerCase();

/** Grades pending logged picks whose game is final. NFL needs this season's nflverse weekly rows. */
export async function gradePropLog(sport: string, nflWeekStats?: PlayerWeekStats[]): Promise<string> {
  const pending = await db
    .select()
    .from(propPickLog)
    .where(and(eq(propPickLog.sport, sport), or(isNull(propPickLog.result))));
  if (pending.length === 0) return "No pending logged props.";
  let graded = 0;
  let voided = 0;
  const set = async (id: number, result: string, actual: number | null) => {
    await db.update(propPickLog).set({ result, actual, gradedAt: new Date() }).where(eq(propPickLog.id, id));
  };

  if (sport === "nfl") {
    if (!nflWeekStats?.length) return `${pending.length} pending (no weekly stats yet).`;
    const weeks = [...new Set(pending.map((p) => p.week))];
    const seasons = [...new Set(pending.map((p) => p.season))];
    const g = await db.select().from(games).where(and(inArray(games.season, seasons), inArray(games.week, weeks)));
    const statsBy = new Map(nflWeekStats.map((r) => [`${r.season}|${r.week}|${norm(r.player)}`, r]));
    for (const p of pending) {
      const game = g.find((x) => x.season === p.season && x.week === p.week && (x.homeTeam === p.team || x.awayTeam === p.team));
      if (!game?.isFinal) continue;
      const field = NFL_FIELD[p.statType];
      if (!field) continue;
      const row = statsBy.get(`${p.season}|${p.week}|${norm(p.player)}`);
      // nflverse posts a day or two after games; void only once the week is clearly in.
      const weekIn = nflWeekStats.some((r) => r.season === p.season && r.week === p.week);
      if (!weekIn) continue;
      if (!row) {
        await set(p.id, "void", null);
        voided++;
        continue;
      }
      const actual = Number(row[field]) || 0;
      await set(p.id, outcome(p.side, p.line, actual), actual);
      graded++;
    }
    return `Logged props graded: ${graded}, voided ${voided}, ${pending.length - graded - voided} still pending.`;
  }

  const extractors = STAT_EXTRACTORS[sport as SportKey] ?? [];
  const dates = [...new Set(pending.map((p) => p.gameDate).filter((d): d is string => !!d))];
  if (dates.length === 0) return `${pending.length} pending (no game dates).`;
  const sg = await db
    .select()
    .from(sportGames)
    .where(and(eq(sportGames.sport, sport), inArray(sportGames.gameDate, dates)));
  const finalIds = sg.filter((x) => x.isFinal).map((x) => x.id);
  const box = finalIds.length
    ? await db
        .select({ gameId: sportPlayerGameStats.gameId, player: sportPlayerGameStats.player, stats: sportPlayerGameStats.stats })
        .from(sportPlayerGameStats)
        .where(and(eq(sportPlayerGameStats.sport, sport), inArray(sportPlayerGameStats.gameId, finalIds)))
    : [];
  const boxBy = new Map(box.map((b) => [`${b.gameId}|${norm(b.player)}`, b.stats as Record<string, string>]));
  const hasBox = new Set(box.map((b) => b.gameId));
  // A pick whose game never went final with a box score 4+ days after its
  // date (postponed, moved to a new game id, or no box score from ESPN) is
  // voided instead of waiting forever.
  const staleBefore = new Date(Date.now() - 4 * 86_400_000).toISOString().slice(0, 10);
  for (const p of pending) {
    // Doubleheaders/makeup games: prefer the final game with a box score.
    const sameDay = sg.filter((x) => x.gameDate === p.gameDate && (x.homeTeam === p.team || x.awayTeam === p.team));
    const game = sameDay.find((x) => x.isFinal && hasBox.has(x.id)) ?? sameDay[0];
    if (!game?.isFinal || !hasBox.has(game.id)) {
      if (p.gameDate && p.gameDate < staleBefore) {
        await set(p.id, "void", null);
        voided++;
      }
      continue;
    }
    const ex = extractors.find((e) => e.statType === p.statType);
    if (!ex) continue;
    const stats = boxBy.get(`${game.id}|${norm(p.player)}`);
    const v = stats ? ex.extract(stats) : null;
    if (v === null) {
      await set(p.id, "void", null);
      voided++;
      continue;
    }
    await set(p.id, outcome(p.side, p.line, v), v);
    graded++;
  }
  return `Logged props graded: ${graded}, voided ${voided}, ${pending.length - graded - voided} still pending.`;
}

/** Hit rate of graded logged picks by sport (for the Results page). */
export interface PropLogSummary {
  sport: string;
  n: number;
  hits: number;
  predicted: number;
  modelOnly: number;
  /** Graded picks whose line+book closing price is on file, and how many closed at a shorter price than we took. */
  clvN: number;
  clvBeat: number;
  clvWorse: number;
  /** Average closing implied chance minus the taken price's, in percentage points (positive = we beat the close). */
  clvPts: number | null;
}

/**
 * Graded prop picks per sport, with closing-line value (1.25.0): each pick's
 * price against the same book's closing price on the same line and side
 * (lib/line-archive.ts). Beating the close is the best early sign of a real
 * edge, long before the hit rate settles.
 */
export async function propLogSummary(): Promise<PropLogSummary[]> {
  const rows = await db.execute<{ sport: string; n: number; hits: number; predicted: number; model_only: number; clv_n: number; clv_beat: number; clv_worse: number; clv_pts: number | null }>(sql`
    with p as (
      select l.*, (select a.close_price from line_archive a
                    where a.sport = l.sport and a.market = 'prop' and a.season = l.season and a.week = l.week
                      and a.player = l.player and a.stat_type = l.stat_type and a.line = l.line and a.side = l.side and a.book = l.book
                    limit 1) as close_price
      from prop_pick_log l where l.result in ('hit', 'miss') and abs(l.price_american) < 5000
    ), q as (
      select *, case when price_american < 0 then -price_american / (-price_american + 100.0) else 100.0 / (price_american + 100) end as imp_taken,
                case when close_price is null then null when close_price < 0 then -close_price / (-close_price + 100.0) else 100.0 / (close_price + 100) end as imp_close
      from p
    )
    select sport, count(*)::int as n, count(*) filter (where result = 'hit')::int as hits,
           avg(final)::float as predicted, avg(model_only)::float as model_only,
           count(imp_close)::int as clv_n,
           count(*) filter (where imp_close > imp_taken + 0.0001)::int as clv_beat,
           count(*) filter (where imp_close < imp_taken - 0.0001)::int as clv_worse,
           (avg(imp_close - imp_taken) * 100)::float as clv_pts
    from q group by sport order by sport`);
  return [...rows].map((r) => ({
    sport: r.sport,
    n: Number(r.n),
    hits: Number(r.hits),
    predicted: Number(r.predicted),
    modelOnly: Number(r.model_only),
    clvN: Number(r.clv_n),
    clvBeat: Number(r.clv_beat),
    clvWorse: Number(r.clv_worse),
    clvPts: r.clv_pts === null ? null : Number(r.clv_pts),
  }));
}
