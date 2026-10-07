import { americanToDecimalOdds } from "./stake-sizing";

export type BetResult = "WON" | "LOST" | "PUSH";

/**
 * Grades one logged bet (db/schema.ts's user_bets) against a final game's
 * actual score. Mirrors the same market math as lib/spread-total-picks.ts
 * and lib/game-picks.ts, just run in reverse — "did this specific bet win"
 * instead of "does the model have an edge."
 */
export function gradeBet(
  bet: {
    market: string; // "ML" | "SPREAD" | "TOTAL"
    selection: string; // team abbr for ML/SPREAD, "OVER" | "UNDER" for TOTAL
    line: number | null;
    priceAmerican: number;
    stakeUsd: number;
  },
  game: { homeTeam: string; awayTeam: string; homeScore: number; awayScore: number }
): { result: BetResult; payoutUsd: number } {
  let result: BetResult;

  if (bet.market === "ML") {
    if (game.homeScore === game.awayScore) {
      result = "PUSH";
    } else {
      const winner = game.homeScore > game.awayScore ? game.homeTeam : game.awayTeam;
      result = bet.selection === winner ? "WON" : "LOST";
    }
  } else if (bet.market === "SPREAD") {
    const line = bet.line ?? 0;
    const isHome = bet.selection === game.homeTeam;
    const actualMargin = game.homeScore - game.awayScore; // home-perspective
    // The team's own line, and their own margin, both from that team's
    // perspective — so "covers" is always just marginForTeam + teamLine > 0,
    // whichever side was picked (matches how spreadHomeLine is stored: a
    // negative number favors the home team).
    const teamLine = isHome ? line : -line;
    const marginForTeam = isHome ? actualMargin : -actualMargin;
    const margin = marginForTeam + teamLine;
    result = margin === 0 ? "PUSH" : margin > 0 ? "WON" : "LOST";
  } else {
    // TOTAL
    const line = bet.line ?? 0;
    const total = game.homeScore + game.awayScore;
    if (total === line) {
      result = "PUSH";
    } else if (bet.selection === "OVER") {
      result = total > line ? "WON" : "LOST";
    } else {
      result = total < line ? "WON" : "LOST";
    }
  }

  let payoutUsd: number;
  if (result === "PUSH") {
    payoutUsd = 0;
  } else if (result === "WON") {
    const decimalOdds = americanToDecimalOdds(bet.priceAmerican);
    payoutUsd = bet.stakeUsd * (decimalOdds - 1);
  } else {
    payoutUsd = -bet.stakeUsd;
  }

  return { result, payoutUsd };
}
