// Parlay payout math — shared by the live preview in the builder, the
// per-card calculator on saved "Your Parlays", and the Auto Parlays cards.
// Parlay legs are treated as independent bets, so the combined decimal odds
// are just the product of each leg's own decimal odds (the standard way
// sportsbooks price a parlay payout).

import { americanToDecimalOdds } from "./stake-sizing";

export interface PriceLeg {
  priceAmerican: number;
}

/** Combined decimal odds across every leg (e.g. 1.91 x 2.20 x 1.74 for a 3-leg parlay). */
export function combinedDecimalOdds(legs: PriceLeg[]): number {
  return legs.reduce((acc, l) => acc * americanToDecimalOdds(l.priceAmerican), 1);
}

/** Inverse of americanToDecimalOdds — used to show a parlay's combined price back as a single American number (e.g. "+450" for a 3-leg slip), the same way a sportsbook's own bet slip does. */
export function decimalToAmerican(decimalOdds: number): number {
  return decimalOdds >= 2
    ? Math.round((decimalOdds - 1) * 100)
    : Math.round(-100 / (decimalOdds - 1));
}

export interface PayoutResult {
  decimalOdds: number;
  payout: number; // total returned if every leg hits, stake included
  profit: number; // payout - stake
}

/** Potential payout for a given stake across all legs — null when there's nothing to compute (no stake, or no legs). */
export function computePayout(stakeUsd: number, legs: PriceLeg[]): PayoutResult | null {
  if (!Number.isFinite(stakeUsd) || stakeUsd <= 0 || legs.length === 0) return null;
  const decimalOdds = combinedDecimalOdds(legs);
  const payout = stakeUsd * decimalOdds;
  return { decimalOdds, payout, profit: payout - stakeUsd };
}
