// Applies what lib/market-learn.ts learned from the line archive to the
// market's no-vig Over chance: a per-sport Over bias and how much of a
// line's move since open keeps going. Client-safe: no server imports.
export interface MarketLearn {
  bias: number;
  move: number;
  /** Opening weighted no-vig Over chance per "player|stat|line". */
  open?: Map<string, number>;
}

const clampP = (p: number) => Math.min(0.995, Math.max(0.005, p));
const logit = (p: number) => Math.log(clampP(p) / (1 - clampP(p)));
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** The market's Over chance after the learned bias and line-move continuation. */
export function adjustMarket(close: number, key: string, ml: MarketLearn | undefined): number {
  if (!ml || (ml.bias === 0 && ml.move === 0)) return close;
  const open = ml.open?.get(key);
  const mv = open === undefined ? 0 : logit(close) - logit(open);
  return clampP(sigmoid(logit(close) + ml.bias + ml.move * Math.max(-1, Math.min(1, mv))));
}

export function adjustMarketMap(m: Map<string, number>, ml: MarketLearn | undefined): Map<string, number> {
  if (!ml || (ml.bias === 0 && ml.move === 0)) return m;
  return new Map([...m].map(([k, v]) => [k, adjustMarket(v, k, ml)]));
}

/**
 * Self-learned strength of the projection adjustments (1.19.0): k = 1 uses
 * them as coded, k < 1 softens them, k > 1 leans harder, in log-odds between
 * the unadjusted and adjusted chance. Fitted on graded picks.
 */
export function scaleAdjustments(base: number, adjusted: number, k: number): number {
  if (k === 1 || base === adjusted) return adjusted;
  return clampP(sigmoid(logit(base) + k * (logit(adjusted) - logit(base))));
}
