import { americanToImpliedProb } from "./props-model";
import { SIM, PhiInv } from "./sports/game-sim";

// Same bar as moneyline/props (lib/game-picks.ts, lib/props-model.ts) —
// below this, the model's lean is just noise around the book's own number.
const MIN_EDGE_PCT = 0.06;

// Spread of final margins and totals around expectation, measured on the
// 2024-25 NFL closing lines (scripts/backtest-game-model/README.md): margin
// 12.2 points, total 13.0 points. (Previously one assumed 13.45 for both.)
const MARGIN_STDEV = SIM.nfl.sdMargin;
const TOTAL_STDEV = SIM.nfl.sdTotal;

/** Standard normal CDF via the Abramowitz & Stegun 7.1.26 approximation (accurate to ~1e-7) — a standard numerical method, not a sports-specific figure. */
function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t) *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/**
 * Converts the model's final pre-game home win% into the expected home
 * scoring margin that gives exactly that win chance under the game
 * simulation's margin distribution (lib/sports/game-sim.ts: normal, with
 * the spread measured on 2024-25 closing lines), so the moneyline, spread
 * and total views of a game always agree with each other.
 */
export function predictedMarginFromWinPct(homeWinPctPre: number): number {
  return SIM.nfl.sdMargin * PhiInv(homeWinPctPre);
}

export interface SpreadEdge {
  edgePct: number; // signed, home-perspective
  pickTeam: "HOME" | "AWAY" | null;
  // The model's own probability of the PICKED side covering (not the book's
  // implied probability) — basis for the confidence score and Kelly sizing.
  modelProb: number;
}

/**
 * Compares the model's probability of the home team covering `spreadHomeLine`
 * (negative = home favored, matching how books quote it) against the book's
 * own price-implied probability on each side, and picks whichever side (if
 * either) clears the minimum edge bar.
 */
export function computeSpreadEdge(
  homeWinPctPre: number,
  spreadHomeLine: number,
  spreadHomePriceAmerican: number,
  spreadAwayPriceAmerican: number
): SpreadEdge {
  const predictedMargin = predictedMarginFromWinPct(homeWinPctPre);
  const modelProbHomeCovers = 1 - normalCdf((-spreadHomeLine - predictedMargin) / MARGIN_STDEV);

  const impliedHome = americanToImpliedProb(spreadHomePriceAmerican);
  const impliedAway = americanToImpliedProb(spreadAwayPriceAmerican);
  const homeEdge = modelProbHomeCovers - impliedHome;
  const awayEdge = 1 - modelProbHomeCovers - impliedAway;

  if (homeEdge < MIN_EDGE_PCT && awayEdge < MIN_EDGE_PCT) {
    return {
      edgePct: homeEdge >= awayEdge ? homeEdge : -awayEdge,
      pickTeam: null,
      modelProb: homeEdge >= awayEdge ? modelProbHomeCovers : 1 - modelProbHomeCovers,
    };
  }
  return homeEdge >= awayEdge
    ? { edgePct: homeEdge, pickTeam: "HOME", modelProb: modelProbHomeCovers }
    : { edgePct: -awayEdge, pickTeam: "AWAY", modelProb: 1 - modelProbHomeCovers };
}

export interface TotalEdge {
  edgePct: number; // signed, OVER-perspective (positive favors the over)
  pick: "OVER" | "UNDER" | null;
  modelProb: number; // model's own probability of the PICKED side hitting
}

export function computeTotalEdge(
  predictedTotal: number,
  totalLine: number,
  overPriceAmerican: number,
  underPriceAmerican: number
): TotalEdge {
  const modelProbOver = 1 - normalCdf((totalLine - predictedTotal) / TOTAL_STDEV);
  const impliedOver = americanToImpliedProb(overPriceAmerican);
  const impliedUnder = americanToImpliedProb(underPriceAmerican);
  const overEdge = modelProbOver - impliedOver;
  const underEdge = 1 - modelProbOver - impliedUnder;

  if (overEdge < MIN_EDGE_PCT && underEdge < MIN_EDGE_PCT) {
    return {
      edgePct: overEdge >= underEdge ? overEdge : -underEdge,
      pick: null,
      modelProb: overEdge >= underEdge ? modelProbOver : 1 - modelProbOver,
    };
  }
  return overEdge >= underEdge
    ? { edgePct: overEdge, pick: "OVER", modelProb: modelProbOver }
    : { edgePct: -underEdge, pick: "UNDER", modelProb: 1 - modelProbOver };
}

export type BestMarket = "ML" | "SPREAD" | "TOTAL";

export interface BestBet {
  market: BestMarket;
  label: string; // human-readable, e.g. "KC -3.5", "KC ML", "Over 47.5"
  edgePct: number; // unsigned — how far past the minimum bar this pick is
  // The model's own win probability for this specific pick (0-1), carried
  // straight from whichever market won out — see lib/confidence.ts for how
  // this becomes the 0-100 badge shown next to the pick everywhere.
  modelProb: number;
}

/**
 * Picks whichever of the three markets has the single biggest edge over the
 * book, so Model Tracker can surface one "best bet" per game instead of
 * three separate numbers. Only considers markets that actually cleared
 * their own minimum-edge bar (a pick of null from a market means "no real
 * edge there") — returns null when none of the three markets clear it.
 */
export function pickBestMarket(candidates: {
  moneyline: { pickTeam: string | null; edgePct: number; homeTeam: string; awayTeam: string; modelProb: number };
  spread?: {
    pickTeam: "HOME" | "AWAY" | null;
    edgePct: number;
    homeTeam: string;
    awayTeam: string;
    spreadHomeLine: number;
    modelProb: number;
  };
  total?: { pick: "OVER" | "UNDER" | null; edgePct: number; totalLine: number; modelProb: number };
}): BestBet | null {
  const options: BestBet[] = [];

  if (candidates.moneyline.pickTeam) {
    options.push({
      market: "ML",
      label: `${candidates.moneyline.pickTeam} ML`,
      edgePct: Math.abs(candidates.moneyline.edgePct),
      modelProb: candidates.moneyline.modelProb,
    });
  }
  if (candidates.spread?.pickTeam) {
    const team = candidates.spread.pickTeam === "HOME" ? candidates.spread.homeTeam : candidates.spread.awayTeam;
    const line =
      candidates.spread.pickTeam === "HOME" ? candidates.spread.spreadHomeLine : -candidates.spread.spreadHomeLine;
    options.push({
      market: "SPREAD",
      label: `${team} ${line > 0 ? "+" : ""}${line}`,
      edgePct: Math.abs(candidates.spread.edgePct),
      modelProb: candidates.spread.modelProb,
    });
  }
  if (candidates.total?.pick) {
    options.push({
      market: "TOTAL",
      label: `${candidates.total.pick === "OVER" ? "Over" : "Under"} ${candidates.total.totalLine}`,
      edgePct: Math.abs(candidates.total.edgePct),
      modelProb: candidates.total.modelProb,
    });
  }

  if (options.length === 0) return null;
  return options.reduce((best, o) => (o.edgePct > best.edgePct ? o : best));
}
