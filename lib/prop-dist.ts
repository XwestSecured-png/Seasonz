// Player-prop projection and probability engine, shared by every sport's
// props model and by the calibration check (lib/prop-calibration.ts), so
// what's tested is exactly what runs.
//
// Three upgrades over a plain "last 5 games average + bell curve":
//
//  1. Count distributions. Rebounds, assists, threes, receptions, shots,
//     strikeouts... are whole numbers, often small, with a hard floor at 0.
//     A Poisson or negative-binomial distribution fits them better than a
//     bell curve (which puts weight on -1 rebounds and treats 4.5 vs 5 as a
//     smooth slope). Negative binomial allows a player to be streakier than
//     Poisson (variance above the mean), measured from his own games.
//  2. Shrinkage (empirical Bayes). The last 5 games are noisy, so the
//     recent average is pulled toward the player's longer-run (20-game)
//     average; how hard is set per stat by the backtest.
//  3. Minutes. In basketball a player's output is rate x minutes; when
//     minutes are known, the projection is his per-minute rate (stable)
//     times his expected minutes (recent), so a game where he sat early
//     in a blowout doesn't drag down his rate.
//
// Client-safe: no server imports.

export type DistKind = "normal" | "poisson" | "negbin";

export interface PropModelConfig {
  dist: DistKind;
  /** Spread multiplier on the normal model's standard deviation. */
  sdMult: number;
  /** Shrinkage: weight of the 20-game average, in "games" against the recent 5. 0 = recent only. */
  shrinkK: number;
  /** Project as per-minute rate x expected minutes (when minutes are known). */
  useMinutes: boolean;
  /** Calibration: chances are pulled toward 50% (log-odds x temper) where the backtest showed overconfidence. */
  temper?: number;
}

/** The model before these upgrades: last-5 average, bell curve. */
export const LEGACY_PROP_MODEL = (sdMult: number): PropModelConfig => ({ dist: "normal", sdMult, shrinkK: 0, useMinutes: false });

export interface Projection {
  mean: number;
  sd: number; // normal model
  /** Negative-binomial size (null = Poisson). */
  nbSize: number | null;
  games: number;
}

const WINDOW = 5;
const LONG = 20;
const MIN_PRIOR = 3;
const FLOOR_PCT = 0.12;

const recencyMean = (vals: number[]): number => {
  // vals: oldest -> newest; weights 1..n, newest heaviest
  const n = vals.length;
  let s = 0;
  let w = 0;
  for (let i = 0; i < n; i++) {
    s += vals[i] * (i + 1);
    w += i + 1;
  }
  return w ? s / w : 0;
};
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);

/**
 * Projection from a player's prior games (oldest first; zeros included).
 * `minutes` (same order) is optional; games with 0 minutes are skipped.
 */
export function projectProp(
  values: number[],
  cfg: PropModelConfig,
  floorAbs: number,
  minutes?: (number | null)[]
): Projection | null {
  let vals = values;
  let mins = minutes;
  if (mins) {
    const keep = vals.map((_, i) => (mins![i] ?? 0) > 0);
    vals = vals.filter((_, i) => keep[i]);
    mins = mins.filter((_, i) => keep[i]);
  }
  if (vals.length < MIN_PRIOR) return null;
  const recent = vals.slice(-WINDOW);
  const long = vals.slice(-LONG);

  let m: number;
  if (cfg.useMinutes && mins && mins.length === vals.length) {
    const rMin = mins.slice(-WINDOW) as number[];
    const lMin = mins.slice(-LONG) as number[];
    const rateRecent = recent.reduce((a, b) => a + b, 0) / Math.max(1, rMin.reduce((a, b) => a + b, 0));
    const rateLong = long.reduce((a, b) => a + b, 0) / Math.max(1, lMin.reduce((a, b) => a + b, 0));
    const rate = (WINDOW * rateRecent + cfg.shrinkK * rateLong) / (WINDOW + cfg.shrinkK);
    m = rate * recencyMean(rMin);
  } else {
    const r = recencyMean(recent);
    m = (WINDOW * r + cfg.shrinkK * mean(long)) / (WINDOW + cfg.shrinkK);
  }

  const raw = mean(recent);
  const variance = recent.length > 1 ? recent.reduce((a, v) => a + (v - raw) ** 2, 0) / (recent.length - 1) : 0;
  const sd = Math.max(Math.sqrt(variance), Math.max(m * FLOOR_PCT, floorAbs)) * cfg.sdMult;

  // Negative-binomial size from the longer window's spread (method of moments).
  const lm = mean(long);
  const lv = long.length > 1 ? long.reduce((a, v) => a + (v - lm) ** 2, 0) / (long.length - 1) : 0;
  const nbSize = lv > lm * 1.05 && lm > 0 ? Math.max(0.5, (lm * lm) / (lv - lm)) : null;

  return { mean: Math.max(0, m), sd, nbSize, games: vals.length };
}

function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

function lgamma(x: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  let t = x + 5.5;
  t -= (x + 0.5) * Math.log(t);
  let s = 1.000000000190015;
  for (const v of c) s += v / ++y;
  return -t + Math.log((2.5066282746310005 * s) / x);
}

/** P(X <= k) for a count with mean m (Poisson, or negative binomial with size r). */
function countCdf(k: number, m: number, r: number | null): number {
  if (k < 0) return 0;
  if (m <= 0) return 1;
  let s = 0;
  for (let i = 0; i <= k; i++) {
    s += r
      ? Math.exp(lgamma(i + r) - lgamma(r) - lgamma(i + 1) + r * Math.log(r / (r + m)) + i * Math.log(m / (r + m)))
      : Math.exp(i * Math.log(m) - m - lgamma(i + 1));
  }
  return Math.min(1, s);
}

/** Chance the stat goes OVER the line (pushes on whole-number lines count as half). */
export function overProbability(p: Projection, line: number, dist: DistKind): number {
  if (dist === "normal") {
    if (p.sd <= 0) return p.mean > line ? 1 : 0;
    return 1 - normalCdf((line - p.mean) / p.sd);
  }
  const r = dist === "negbin" ? p.nbSize : null;
  if (Number.isInteger(line)) {
    const below = countCdf(line - 1, p.mean, r);
    const atOrBelow = countCdf(line, p.mean, r);
    const push = atOrBelow - below;
    return 1 - atOrBelow + push / 2;
  }
  return 1 - countCdf(Math.floor(line), p.mean, r);
}

/** The model's chance for a side of a line, with the stat's calibration applied. */
export function propChance(p: Projection, line: number, cfg: PropModelConfig, side: "Over" | "Under"): number {
  const raw = Math.min(0.999, Math.max(0.001, overProbability(p, line, cfg.dist)));
  const t = cfg.temper ?? 1;
  const o = t === 1 ? raw : 1 / (1 + Math.exp(-t * Math.log(raw / (1 - raw))));
  return side === "Over" ? o : 1 - o;
}
