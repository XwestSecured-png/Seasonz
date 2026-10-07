import { americanToImpliedProb } from "./props-model";

// Same bar as player props (lib/props-model.ts) — below this, the model's
// favorite is just the book's favorite too, and "picking" it isn't adding
// any real value over just betting the chalk.
const MIN_EDGE_PCT = 0.06;

export interface GameEdge {
  edgePct: number; // signed, home-perspective: model home win% - book implied home win%
  pickTeam: "HOME" | "AWAY" | null; // null when no real edge over the book
  // The model's own win probability for the picked side (not the book's) —
  // >0.5 whenever pickTeam is set, since a pick only exists where the model
  // actually favors clearing the book's implied number. Used as the basis
  // for the 0-100 "confidence score" shown alongside every pick (see
  // lib/confidence.ts) and for Kelly stake sizing (lib/stake-sizing.ts).
  modelProb: number;
}

/**
 * Compares the Elo model's own pre-game home win% against the book's
 * moneyline-implied home win% and flags a pick only where they really
 * disagree — mirrors buildPropPicks' edge logic, applied to game winners
 * instead of player props.
 */
export function computeGameEdge(
  modelHomeWinPct: number,
  homePriceAmerican: number
): GameEdge {
  const bookImpliedHomeWinPct = americanToImpliedProb(homePriceAmerican);
  const edgePct = modelHomeWinPct - bookImpliedHomeWinPct;
  const modelProb = edgePct >= 0 ? modelHomeWinPct : 1 - modelHomeWinPct;
  if (Math.abs(edgePct) < MIN_EDGE_PCT) return { edgePct, pickTeam: null, modelProb };
  return { edgePct, pickTeam: edgePct > 0 ? "HOME" : "AWAY", modelProb };
}
