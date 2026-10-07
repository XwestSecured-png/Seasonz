// Suggested bet size, from the model's own edge — the Kelly criterion,
// run at a conservative fraction. Several of the apps researched for this
// feature (HyperPicks' "Smart Bankroll Sizing", Oddible's bet grading) sell
// this as a core feature: not just a direction, but how much to actually
// risk on it.
//
// Full Kelly (f* = (bp - q) / b) maximizes long-run bankroll growth in
// theory, but is notoriously aggressive against a model whose edge estimate
// itself has error — standard practice (and what this app follows) is to
// bet a FRACTION of full Kelly ("fractional Kelly") to cut variance, plus a
// hard cap so a single, possibly-overconfident edge can never eat too much
// of the bankroll in one bet.

const KELLY_FRACTION = 0.5; // half-Kelly — the common conservative default
const MAX_STAKE_PCT = 0.05; // never suggest more than 5% of bankroll on one pick
const MIN_STAKE_PCT = 0; // Kelly can and should suggest 0 when there's no real edge

export function americanToDecimalOdds(priceAmerican: number): number {
  return priceAmerican > 0 ? 1 + priceAmerican / 100 : 1 + 100 / Math.abs(priceAmerican);
}

/** Full Kelly fraction of bankroll to stake, given the model's win probability and the price offered. Clamped to [0, 1] — never suggests staking against your own edge. */
export function kellyFraction(modelProb: number, priceAmerican: number): number {
  const decimalOdds = americanToDecimalOdds(priceAmerican);
  const b = decimalOdds - 1; // net odds (profit per $1 staked, if it wins)
  const p = Math.min(0.999, Math.max(0.001, modelProb));
  const q = 1 - p;
  const f = (b * p - q) / b;
  return Math.max(0, f);
}

/** Half-Kelly, capped at MAX_STAKE_PCT — the number actually shown to the user as "suggested stake". */
export function suggestedStakePct(modelProb: number, priceAmerican: number): number {
  const full = kellyFraction(modelProb, priceAmerican);
  return Math.min(MAX_STAKE_PCT, Math.max(MIN_STAKE_PCT, full * KELLY_FRACTION));
}

/** Suggested stake in dollars for a given bankroll, rounded to the nearest dollar. Returns null when bankroll isn't set. */
export function suggestedStakeUsd(
  modelProb: number,
  priceAmerican: number,
  bankrollUsd: number | null
): number | null {
  if (bankrollUsd === null || bankrollUsd <= 0) return null;
  return Math.round(bankrollUsd * suggestedStakePct(modelProb, priceAmerican));
}
