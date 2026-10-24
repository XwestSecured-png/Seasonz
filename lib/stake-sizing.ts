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

/**
 * Prop stake (1.26.0): eighth-Kelly, capped at 2% of bankroll. Props are
 * more correlated (several on one game) and their chances noisier than a
 * game line's, and at half-Kelly nearly every 70%+ prop hit the 5% cap,
 * which says nothing. Graded prop picks run about 5 points over the market
 * on average; an eighth of Kelly on that is ~1-2%.
 */
const PROP_KELLY_FRACTION = 0.125;
const PROP_MAX_STAKE_PCT = 0.02;
export function propStakePct(modelProb: number, priceAmerican: number): number {
  return Math.min(PROP_MAX_STAKE_PCT, kellyFraction(modelProb, priceAmerican) * PROP_KELLY_FRACTION);
}

/** "1.5% · $15" (dollars only when a bankroll is set); null when there's no edge at this price. */
export function propStakeLabel(modelProb: number | null, priceAmerican: number | null, bankrollUsd: number | null): string | null {
  if (modelProb === null || priceAmerican === null) return null;
  const pct = propStakePct(modelProb, priceAmerican);
  if (pct < 0.001) return null;
  const usd = bankrollUsd && bankrollUsd > 0 ? Math.max(1, Math.round(bankrollUsd * pct)) : null;
  return `${(pct * 100).toFixed(1)}%${usd !== null ? ` · $${usd}` : ""}`;
}
