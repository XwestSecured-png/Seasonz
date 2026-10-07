// Converts a plain win probability into "fair" (no-vig) American odds —
// used only for props that have no real sportsbook price behind them yet
// (Anytime TD / 2+ TDs — see the comment on computeTdProjections in
// lib/props-model.ts for why). This lets the TD Props page reuse the same
// parlay payout math (lib/parlay-math.ts, americanToDecimalOdds) as every
// other payout calculator in the app, clearly labeled as the model's own
// implied price rather than a number from a book.
export function probToFairAmerican(prob: number): number {
  const p = Math.min(0.99, Math.max(0.01, prob));
  const decimal = 1 / p;
  return decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1));
}
