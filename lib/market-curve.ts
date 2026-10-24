// The market's price curve for a prop (1.24.0). Client-safe: no server imports.
//
// A player's prop is posted at many lines across many books: the main line
// two-sided at a dozen books, alternate lines one-sided at a few. Each line
// used to be priced on its own: the books' no-vig chance at exactly that
// line, or one book's juiced one-sided alt price. Here every two-sided line
// for the player is pooled into one curve (log-odds of the Over is close to
// straight in the line: logit P = a + b (line - c)) and any line is read
// off it. The slope comes from the player's own ladder when he has several
// two-sided lines, shrunk toward a per-stat prior (b = -k / sqrt(line)).

const clampP = (p: number) => Math.min(0.995, Math.max(0.005, p));
const logit = (p: number) => Math.log(clampP(p) / (1 - clampP(p)));
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export interface CurvePoint {
  line: number;
  /** Weighted no-vig Over chance at this line. */
  p: number;
  w: number;
}
export interface Curve {
  c: number;
  a: number;
  b: number;
  w: number;
}

/** Shrinkage (in effective squared-line units x weight) toward the prior slope. */
const SLOPE_PRIOR = 4;
export const DEFAULT_CURVE_K = 1;

export function priorSlope(center: number, k: number): number {
  return -k / Math.sqrt(Math.max(0.5, Math.abs(center)));
}

export function buildCurve(points: CurvePoint[], k: number): Curve | undefined {
  const pts = points.filter((p) => p.w > 0);
  if (!pts.length) return undefined;
  const W = pts.reduce((s, p) => s + p.w, 0);
  const c = pts.reduce((s, p) => s + p.w * p.line, 0) / W;
  const a0 = pts.reduce((s, p) => s + p.w * logit(p.p), 0) / W;
  const b0 = priorSlope(c, k);
  let sxy = 0;
  let sxx = 0;
  for (const p of pts) {
    sxy += p.w * (p.line - c) * (logit(p.p) - a0);
    sxx += p.w * (p.line - c) ** 2;
  }
  // Prior strength scales with the stat's line size so yards and goals shrink alike.
  const lam = SLOPE_PRIOR * Math.max(0.25, Math.abs(c) / 4);
  let b = (sxy + lam * b0) / (sxx + lam);
  if (!(b < 0)) b = b0; // more of a stat can't be likelier to go Over
  return { c, a: a0, b, w: W };
}

export function curveChance(curve: Curve, line: number): number {
  return clampP(sigmoid(curve.a + curve.b * (line - curve.c)));
}

/** Blend two chances in log-odds; w = share of the second. */
export function blendLogit(p: number, q: number, w: number): number {
  if (w <= 0) return p;
  if (w >= 1) return q;
  return clampP(sigmoid((1 - w) * logit(p) + w * logit(q)));
}

export interface CurveLearn {
  /** Slope prior per stat (k in b = -k/sqrt(line)). */
  k: Record<string, number>;
  /** Curve's share against the exact-line two-sided price. */
  wExact: number;
  /** Curve's share against a one-sided (alt ladder) price. */
  wOne: number;
}

/**
 * Starting values, from the line archive's first graded week (curvecal).
 * See the 1.24.0 notes in lib/changelog.ts.
 */
export const CURVE_DEFAULT: CurveLearn = { k: {}, wExact: 0, wOne: 0 };

/** Curves per "player|stat" from two-sided books (pairs already reduced to no-vig chances). */
export function curvesFrom(
  noVig: Iterable<{ player: string; statType: string; line: number; p: number; w: number }>,
  kOf: (stat: string) => number
): Map<string, Curve> {
  const pts = new Map<string, Map<number, { s: number; w: number }>>();
  for (const r of noVig) {
    const key = `${r.player}|${r.statType}`;
    const m = pts.get(key) ?? pts.set(key, new Map()).get(key)!;
    const e = m.get(r.line) ?? { s: 0, w: 0 };
    e.s += r.w * r.p;
    e.w += r.w;
    m.set(r.line, e);
  }
  const out = new Map<string, Curve>();
  for (const [key, m] of pts) {
    const c = buildCurve(
      [...m].map(([line, e]) => ({ line, p: e.s / e.w, w: e.w })),
      kOf(key.split("|")[1])
    );
    if (c) out.set(key, c);
  }
  return out;
}
