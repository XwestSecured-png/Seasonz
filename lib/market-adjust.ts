// Applies what lib/market-learn.ts learned from the line archive to the
// market's no-vig Over chance: a per-sport Over bias and how much of a
// line's move since open keeps going. Client-safe: no server imports.
export interface MarketLearn {
  bias: number;
  move: number;
  /** Log-odds scale on the market chance (lib/market-learn.ts fitMarketTemp); 1 = as priced. */
  temp?: number;
  /** Per-stat Over bias (log-odds), shrunk toward the sport's; replaces `bias` for that stat. */
  biasByStat?: Record<string, number>;
  /** Log-odds shift for a price posted on one side only (alt ladders), see ONE_SIDED_SHIFT. */
  oneSided?: number;
  /** Model calibration in log-odds (lib/market-learn.ts fitModelCal): sigmoid(t*logit(p)+b). */
  modelCal?: { t: number; b: number };
  /** Per-stat model calibration (replaces the sport's for that stat). */
  modelCalByStat?: Record<string, { t: number; b: number }>;
  /** Learned Over/Under log-odds shift on a pick's final chance (lib/model-weights.ts "side:<sport>"). */
  side?: { Over: number; Under: number };
  /** Learned share of the market price curve (lib/market-curve.ts) against a two-sided / one-sided price. */
  curveExact?: number;
  curveOne?: number;
  /** Opening weighted no-vig Over chance per "player|stat|line". */
  open?: Map<string, number>;
}

const clampP = (p: number) => Math.min(0.995, Math.max(0.005, p));
const logit = (p: number) => Math.log(clampP(p) / (1 - clampP(p)));
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** The market's Over chance after the learned bias and line-move continuation. */
export function adjustMarket(close: number, key: string, ml: MarketLearn | undefined): number {
  if (!ml) return close;
  const stat = key.split("|")[1];
  const bias = ml.biasByStat?.[stat] ?? ml.bias;
  const t = ml.temp ?? 1;
  if (bias === 0 && ml.move === 0 && t === 1) return close;
  const open = ml.open?.get(key);
  const mv = open === undefined ? 0 : logit(close) - logit(open);
  return clampP(sigmoid(t * logit(close) + bias + ml.move * Math.max(-1, Math.min(1, mv))));
}

/**
 * A price posted on one side only (usually an alternate-line ladder: "25+
 * points" with no Under). The old estimate took 4.5% off the implied chance;
 * graded lines (1.20.0, first two weeks of the line archive) said one-sided
 * prices are far richer than that: NBA Overs priced ~15% hit 9%, ~6% hit 1%,
 * ~64% hit 49%; NHL the same. The best fit was a flat log-odds shift of
 * -0.6 to -0.7 (slope 1) in both leagues and on both halves of the data,
 * 3-8% better log loss on the half it wasn't fitted on. Re-fitted nightly
 * per sport (lib/market-learn.ts).
 */
export const ONE_SIDED_SHIFT = -0.65;
export function oneSidedChance(overPrice: number | undefined, underPrice: number | undefined, shift = ONE_SIDED_SHIFT): number | undefined {
  const imp = (a: number) => (a < 0 ? -a / (-a + 100) : 100 / (a + 100));
  const c = (p: number) => Math.min(0.97, Math.max(0.01, p));
  if (overPrice !== undefined) return c(sigmoid(logit(imp(overPrice)) + shift));
  if (underPrice !== undefined) return c(1 - sigmoid(logit(imp(underPrice)) + shift));
  return undefined;
}

export function adjustMarketMap(m: Map<string, number>, ml: MarketLearn | undefined): Map<string, number> {
  if (!ml || (ml.bias === 0 && ml.move === 0 && !ml.biasByStat && (ml.temp ?? 1) === 1)) return m;
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

/** A pick's final chance for its side after the learned Over/Under calibration. */
export function sideCalibrate(p: number, side: "Over" | "Under", ml: MarketLearn | undefined): number {
  const c = ml?.side?.[side] ?? 0;
  return c === 0 ? p : clampP(sigmoid(logit(p) + c));
}

/** The model's own Over chance after the learned calibration (1.28.0). */
export function calibrateModel(pOver: number, ml: MarketLearn | undefined, stat?: string): number {
  const c = (stat !== undefined ? ml?.modelCalByStat?.[stat] : undefined) ?? ml?.modelCal;
  if (!c || (c.t === 1 && c.b === 0)) return pOver;
  return clampP(sigmoid(c.t * logit(pOver) + c.b));
}
