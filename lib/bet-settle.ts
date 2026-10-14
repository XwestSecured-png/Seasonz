// Grades every pending logged bet (user_bets) that can be graded
// automatically, for every sport, and records its closing-line value.
//
//   ML / SPREAD / TOTAL: against the final score (lib/bet-grading.ts).
//   PROP: against the player's box score (other sports: ESPN box scores via
//     STAT_EXTRACTORS; NFL: nflverse weekly stats for yardage/receptions).
//     A player with no box-score line once the game's box score is in is
//     voided, the way books do.
//   PARLAY: settled by the user (legs can span sports and markets).
//
// Closing-line value (CLV) = the closing no-vig chance of your side minus
// the chance your price implied, in win-chance points. Lines stop updating
// at kickoff (the odds stages skip started games), so the game row's
// moneyline/spread/total ARE the closing numbers once it has started.
import { db } from "@/db";
import { games, sportGames, sportPlayerGameStats, userBets } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { gradeBet } from "./bet-grading";
import { americanToDecimalOdds } from "./stake-sizing";
import { noVigPair } from "./sports/game-model";
import { SIM, Phi, PhiInv } from "./sports/game-sim";
import { STAT_EXTRACTORS } from "./sports/stat-extract";
import { isCalledOff, type SportKey } from "./sports/types";
import type { PlayerWeekStats } from "./nflverse";

export type BetRow = typeof userBets.$inferSelect;
export interface PropSpec {
  player: string;
  statType: string;
  line: number;
  side: "Over" | "Under";
}

const implied = (a: number) => (a < 0 ? -a / (-a + 100) : 100 / (a + 100));

interface ClosingGame {
  homeTeam: string;
  awayTeam: string;
  mlHome: number | null;
  mlAway: number | null;
  spreadHome: number | null;
  spreadHomePrice: number | null;
  spreadAwayPrice: number | null;
  total: number | null;
  overPrice: number | null;
  underPrice: number | null;
  /** Consensus no-vig home chance at the close, when stored. */
  closeHomePct: number | null;
}

/** Closing-line value of a game bet, plus the closing number on its side. */
export function closingValue(
  sport: string,
  bet: { market: string; selection: string; line: number | null; priceAmerican: number },
  g: ClosingGame
): { clvPct: number | null; closingPriceAmerican: number | null; closingLine: number | null } {
  const sim = SIM[(sport in SIM ? sport : "nfl") as keyof typeof SIM];
  const mine = implied(bet.priceAmerican);
  if (bet.market === "ML") {
    const isHome = bet.selection === g.homeTeam;
    const homeClose = g.closeHomePct ?? noVigPair(g.mlHome, g.mlAway);
    const closePrice = isHome ? g.mlHome : g.mlAway;
    if (homeClose == null) return { clvPct: null, closingPriceAmerican: closePrice, closingLine: null };
    return { clvPct: (isHome ? homeClose : 1 - homeClose) - mine, closingPriceAmerican: closePrice, closingLine: null };
  }
  if (bet.market === "SPREAD") {
    if (g.spreadHome == null || bet.line == null) return { clvPct: null, closingPriceAmerican: null, closingLine: g.spreadHome };
    const isHome = bet.selection === g.homeTeam;
    const closeLine = isHome ? g.spreadHome : -g.spreadHome; // your team's closing line
    const closeCover = noVigPair(
      isHome ? g.spreadHomePrice : g.spreadAwayPrice,
      isHome ? g.spreadAwayPrice : g.spreadHomePrice
    );
    // bet.line is stored as the HOME spread (same convention as
    // lib/bet-grading.ts); your team's line is its sign-flip for the away side.
    const myLine = isHome ? bet.line : -bet.line;
    // Chance of covering YOUR line, judged by the closing market.
    const atMine = Phi(PhiInv(closeCover ?? 0.5) + (myLine - closeLine) / sim.sdMargin);
    return {
      clvPct: atMine - mine,
      closingPriceAmerican: isHome ? g.spreadHomePrice : g.spreadAwayPrice,
      closingLine: closeLine,
    };
  }
  if (bet.market === "TOTAL") {
    if (g.total == null || bet.line == null) return { clvPct: null, closingPriceAmerican: null, closingLine: g.total };
    const over = bet.selection === "OVER";
    const closeSide = noVigPair(over ? g.overPrice : g.underPrice, over ? g.underPrice : g.overPrice);
    const shift = over ? (g.total - bet.line) / sim.sdTotal : (bet.line - g.total) / sim.sdTotal;
    const atMine = Phi(PhiInv(closeSide ?? 0.5) + shift);
    return { clvPct: atMine - mine, closingPriceAmerican: over ? g.overPrice : g.underPrice, closingLine: g.total };
  }
  return { clvPct: null, closingPriceAmerican: null, closingLine: null };
}

export function payoutFor(result: string, priceAmerican: number, stakeUsd: number): number {
  if (result === "WON") return Math.round(stakeUsd * (americanToDecimalOdds(priceAmerican) - 1) * 100) / 100;
  if (result === "LOST") return -stakeUsd;
  return 0; // PUSH / VOID
}

/** Prop result from an actual stat value (whole-number lines can push). */
export function gradeProp(spec: PropSpec, actual: number): "WON" | "LOST" | "PUSH" {
  if (actual === spec.line) return "PUSH";
  const over = actual > spec.line;
  return (spec.side === "Over") === over ? "WON" : "LOST";
}

const NFL_FIELD: Record<string, keyof PlayerWeekStats> = {
  "Pass Yds": "passYds",
  "Rush Yds": "rushYds",
  "Rec Yds": "recYds",
  Receptions: "receptions",
};

/**
 * Settles pending bets. `sport` limits it to one sport ("nfl" or a SportKey);
 * NFL prop bets need this week's nflverse stats passed in.
 */
export async function settlePendingBets(opts: { sport?: string; nflWeekStats?: PlayerWeekStats[] } = {}): Promise<string> {
  const pendingAll = await db.select().from(userBets).where(eq(userBets.result, "PENDING"));
  const pending = pendingAll.filter((b) => b.market !== "PARLAY" && (!opts.sport || b.sport === opts.sport));
  if (pending.length === 0) return "No pending bets to grade.";

  const nflIds = [...new Set(pending.map((b) => b.gameId).filter((x): x is number => x != null))];
  const sportIds = [...new Set(pending.map((b) => b.sportGameId).filter((x): x is number => x != null))];
  const nflGames = new Map((nflIds.length ? await db.select().from(games).where(inArray(games.id, nflIds)) : []).map((g) => [g.id, g]));
  const otherGames = new Map(
    (sportIds.length ? await db.select().from(sportGames).where(inArray(sportGames.id, sportIds)) : []).map((g) => [g.id, g])
  );

  let graded = 0;
  let voided = 0;
  let waiting = 0;
  for (const bet of pending) {
    try {
      const ng = bet.gameId != null ? nflGames.get(bet.gameId) : undefined;
      const sg = bet.sportGameId != null ? otherGames.get(bet.sportGameId) : undefined;
      const g = ng ?? sg;
      // Canceled / postponed and never played: void, like the books.
      if (sg && !sg.isFinal && isCalledOff(sg.extra, sg.kickoffAt)) {
        await db
          .update(userBets)
          .set({ result: "VOID", payoutUsd: 0, gradedAt: new Date() })
          .where(and(eq(userBets.id, bet.id), eq(userBets.result, "PENDING")));
        voided++;
        continue;
      }
      if (!g || !g.isFinal || g.homeScore === null || g.awayScore === null) {
        waiting++;
        continue;
      }
      let result: "WON" | "LOST" | "PUSH" | "VOID" | null = null;
      let clv: ReturnType<typeof closingValue> = { clvPct: null, closingPriceAmerican: null, closingLine: null };

      if (bet.market === "ML" || bet.market === "SPREAD" || bet.market === "TOTAL") {
        result = gradeBet(
          { market: bet.market, selection: bet.selection, line: bet.line, priceAmerican: bet.priceAmerican, stakeUsd: bet.stakeUsd },
          { homeTeam: g.homeTeam, awayTeam: g.awayTeam, homeScore: g.homeScore, awayScore: g.awayScore }
        ).result;
        const lockedHome = ng
          ? ng.lockedMarketPct
          : ((sg?.extra as { locked?: { market?: number | null } } | null)?.locked?.market ?? null);
        clv = closingValue(bet.sport, bet, {
          homeTeam: g.homeTeam,
          awayTeam: g.awayTeam,
          mlHome: g.moneylineHomeOdds,
          mlAway: g.moneylineAwayOdds,
          spreadHome: g.spreadHomeLine,
          spreadHomePrice: g.spreadHomePriceAmerican,
          spreadAwayPrice: g.spreadAwayPriceAmerican,
          total: g.totalLine,
          overPrice: g.totalOverPriceAmerican,
          underPrice: g.totalUnderPriceAmerican,
          closeHomePct: lockedHome ?? null,
        });
      } else if (bet.market === "PROP" && bet.prop) {
        const spec = bet.prop as PropSpec;
        if (sg) {
          const rows = await db
            .select({ player: sportPlayerGameStats.player, stats: sportPlayerGameStats.stats })
            .from(sportPlayerGameStats)
            .where(and(eq(sportPlayerGameStats.sport, sg.sport), eq(sportPlayerGameStats.gameId, sg.id)));
          if (rows.length === 0) {
            waiting++; // box score not fetched yet
            continue;
          }
          const ex = STAT_EXTRACTORS[sg.sport as SportKey]?.find((x) => x.statType === spec.statType);
          const row = rows.find((r) => r.player.trim().toLowerCase() === spec.player.trim().toLowerCase());
          if (!ex) {
            waiting++; // stat we can't read — user settles it
            continue;
          }
          const v = row ? ex.extract(row.stats as Record<string, string>) : null;
          result = v === null ? "VOID" : gradeProp(spec, v);
        } else if (ng) {
          const field = NFL_FIELD[spec.statType];
          const week = opts.nflWeekStats?.filter((r) => r.week === ng.week);
          if (!field || !week?.length) {
            waiting++;
            continue;
          }
          const row = week.find((r) => r.player.trim().toLowerCase() === spec.player.trim().toLowerCase());
          result = row ? gradeProp(spec, Number(row[field]) || 0) : "VOID";
        }
      }
      if (!result) {
        waiting++;
        continue;
      }
      await db
        .update(userBets)
        .set({
          result,
          payoutUsd: payoutFor(result, bet.priceAmerican, bet.stakeUsd),
          gradedAt: new Date(),
          clvPct: clv.clvPct,
          closingPriceAmerican: clv.closingPriceAmerican,
          closingLine: clv.closingLine,
        })
        .where(eq(userBets.id, bet.id));
      if (result === "VOID") voided++;
      else graded++;
    } catch {
      waiting++;
    }
  }
  return `${graded} bet(s) graded${voided ? `, ${voided} voided (player didn't play)` : ""}; ${waiting} still waiting on a final score or box score.`;
}
