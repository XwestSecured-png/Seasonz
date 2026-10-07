import { americanToImpliedProb } from "./props-model";

// Same bar as moneyline/props (lib/game-picks.ts, lib/props-model.ts) —
// below this, the model's lean is just noise around the book's own number.
const MIN_EDGE_PCT = 0.06;

// How many Elo rating points equal 1 point of expected scoring margin, and
// the logistic divisor behind the win-probability formula itself — both are
// FiveThirtyEight's own published NFL Elo methodology (confirmed: 25 Elo
// points per point of margin, Pr(home) = 1 / (1 + 10^(-eloDiff/400)), and a
// 65-Elo-point home-field edge — which is exactly this app's own
// HOME_ADVANTAGE constant in lib/elo.ts, so this app's Elo model already
// matches that calibration). Inverting the win-probability formula algebraically
// turns games.homeWinPctPre — the model's FINAL pre-game number, with every
// adjustment already baked in (weather, injuries, FPI/QBR, etc.) — into an
// equivalent predicted scoring margin, rather than reverting to raw Elo.
const ELO_POINTS_PER_MARGIN_POINT = 25;
const ELO_LOGISTIC_DIVISOR = 400;

// The observed standard deviation of NFL final-score margins, used to turn a
// predicted margin into a probability of covering a given spread (assuming
// margins are roughly normally distributed around the prediction) — a
// commonly cited empirical figure (~13.45) from public NFL betting-market
// modeling writeups. Game totals don't have an equally well-documented
// public figure, so this app uses the SAME stdev for totals too, under the
// explicit simplifying assumption that the two teams' scores are
// uncorrelated (if so, Var(total) = Var(home) + Var(away) = Var(margin)
// exactly, since Var(margin) = Var(home) + Var(away) - 2*Cov and
// Var(total) = Var(home) + Var(away) + 2*Cov collapse to the same value
// when Cov ≈ 0). Treat totalAiEdgePct as a rougher estimate than the
// spread/moneyline edges for that reason.
const MARGIN_STDEV = 13.45;

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

/** Converts the model's final pre-game home win% into an equivalent predicted home-perspective scoring margin (positive = home favored). */
export function predictedMarginFromWinPct(homeWinPctPre: number): number {
  const clamped = Math.min(0.999, Math.max(0.001, homeWinPctPre));
  const eloDiff = ELO_LOGISTIC_DIVISOR * Math.log10(clamped / (1 - clamped));
  return eloDiff / ELO_POINTS_PER_MARGIN_POINT;
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
  const modelProbOver = 1 - normalCdf((totalLine - predictedTotal) / MARGIN_STDEV);
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
