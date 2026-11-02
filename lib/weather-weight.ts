// Weather weight (1.37.0) for NFL, college football and MLB.
//
// Two effects, both measured against the betting line (the books already
// price the forecast, so only what the line misses counts):
//
//   Totals: wind, cold and rain take points off. shift = -(wind*a + cold*b + wet*c)
//   Winners: rough weather means fewer scoring chances, which makes upsets
//     a little likelier, so the favorite's chance is pulled toward 50-50:
//     logit(p) * (1 - shrink * severity). (The NFL's win model already has
//     its own weather term, lib/weather.ts, so the shrink is MLB/college only.)
//
// The coded starting weights are deliberately small. Every night the refit
// (lib/model-weights.ts) re-learns them from graded games that have
// game-time weather, fitting on one half of the dates and scoring on the
// other; a learned weight replaces the coded one only when it does better
// on the half it didn't see.

export type WxSport = "nfl" | "ncaaf" | "mlb";

export interface WxReading {
  tempF: number | null;
  windMph: number | null;
  /** Chance of rain/snow that hour (forecast), 0-100. */
  precipPct?: number | null;
  /** Measured precipitation that hour (archive), mm. */
  precipMm?: number | null;
}

export interface WxFeatures {
  /** mph above 12 */
  wind: number;
  /** degrees below 40F */
  cold: number;
  /** 0..1: rain/snow likelihood or amount */
  wet: number;
}

export interface WxWeights {
  /** points (runs) off the total per unit of each feature */
  wind: number;
  cold: number;
  wet: number;
  /** winner shrink at full severity (0 = none) */
  shrink: number;
}

export const WX_PRIOR: Record<WxSport, WxWeights> = {
  // Closing NFL totals still went under more often than not in 20+ mph wind;
  // a small residual: ~1 point at 20 mph.
  nfl: { wind: 0.12, cold: 0.03, wet: 0.5, shrink: 0 },
  ncaaf: { wind: 0.15, cold: 0.03, wet: 0.6, shrink: 0.04 },
  // No wind direction in the feed (out to center vs in from left matter in
  // opposite ways), so wind starts at 0 for baseball; cold dampens carry.
  mlb: { wind: 0, cold: 0.01, wet: 0.15, shrink: 0.02 },
};

/** Most the weather can take off a total. */
export const WX_TOTAL_CAP: Record<WxSport, number> = { nfl: 5, ncaaf: 6, mlb: 1 };

export function wxFeatures(w: WxReading | null | undefined, indoor: boolean): WxFeatures | null {
  if (!w || indoor) return null;
  if (w.tempF == null && w.windMph == null) return null;
  const wind = Math.max(0, (w.windMph ?? 0) - 12);
  const cold = Math.max(0, 40 - (w.tempF ?? 60));
  const wet =
    w.precipMm != null ? Math.min(1, Math.max(0, w.precipMm) / 2) : w.precipPct != null ? Math.min(1, Math.max(0, w.precipPct - 40) / 60) : 0;
  return { wind, cold, wet };
}

/** 0..1, how rough the conditions are. */
export function wxSeverity(f: WxFeatures | null): number {
  if (!f) return 0;
  return Math.min(1, Math.max(f.wind / 13, f.cold / 30, f.wet));
}

/** Points (runs) to add to the expected total: zero or negative, capped. */
export function wxTotalShift(sport: WxSport, f: WxFeatures | null, w: WxWeights): number {
  if (!f) return 0;
  const raw = -(w.wind * f.wind + w.cold * f.cold + w.wet * f.wet);
  return Math.max(-WX_TOTAL_CAP[sport], Math.min(0, raw));
}

const clampP = (p: number) => Math.min(0.995, Math.max(0.005, p));
const logit = (p: number) => Math.log(clampP(p) / (1 - clampP(p)));
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** Pulls the favorite toward 50-50 in rough weather. */
export function wxWinShrink(p: number, f: WxFeatures | null, w: WxWeights): number {
  const s = wxSeverity(f) * Math.min(0.3, Math.max(0, w.shrink));
  return s > 0 ? sigmoid(logit(p) * (1 - s)) : p;
}

// ------------------------------------------------------------------ fitting

export interface WxTotalRow {
  at: number;
  f: WxFeatures;
  /** actual total minus the closing total line */
  resid: number;
}
export interface WxWinRow {
  at: number;
  f: WxFeatures;
  p: number;
  y: 0 | 1;
}

export const WX_MIN_TOTAL_N = 150;
export const WX_MIN_WIN_N = 200;
/** Pseudo-games pulling the fit toward the coded prior. */
const RIDGE = 150;

function solve3(A: number[][], b: number[]): number[] | null {
  const m = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < 3; c++) {
    let piv = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
    if (Math.abs(m[piv][c]) < 1e-12) return null;
    [m[c], m[piv]] = [m[piv], m[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const k = m[r][c] / m[c][c];
      for (let j = c; j < 4; j++) m[r][j] -= k * m[c][j];
    }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
}

/** Ridge least squares of -resid on the features, shrunk toward the prior; weights kept >= 0. */
function fitTotalOn(rows: WxTotalRow[], prior: WxWeights): [number, number, number] {
  const X = rows.map((r) => [r.f.wind, r.f.cold, r.f.wet]);
  const y = rows.map((r) => -r.resid);
  const p0 = [prior.wind, prior.cold, prior.wet];
  // Scale the ridge to each feature's spread so one penalty fits all three.
  const scale = [0, 1, 2].map((j) => Math.max(1e-6, X.reduce((s, x) => s + x[j] * x[j], 0) / Math.max(1, X.length)));
  const A = [0, 1, 2].map((i) => [0, 1, 2].map((j) => X.reduce((s, x) => s + x[i] * x[j], 0) + (i === j ? RIDGE * scale[i] : 0)));
  const b = [0, 1, 2].map((i) => X.reduce((s, x, k) => s + x[i] * y[k], 0) + RIDGE * scale[i] * p0[i]);
  const w = solve3(A, b) ?? p0;
  return [Math.max(0, w[0]), Math.max(0, w[1]), Math.max(0, w[2])];
}

const mse = (rows: WxTotalRow[], w: [number, number, number]) =>
  rows.reduce((s, r) => {
    const pred = -(w[0] * r.f.wind + w[1] * r.f.cold + w[2] * r.f.wet);
    return s + (r.resid - pred) ** 2;
  }, 0) / Math.max(1, rows.length);

const halves = <T extends { at: number }>(rows: T[]): [T[], T[]] => {
  const s = [...rows].sort((a, b) => a.at - b.at);
  const cut = s[Math.floor(s.length / 2)]?.at ?? 0;
  return [s.filter((r) => r.at < cut), s.filter((r) => r.at >= cut)];
};

export interface WxTotalFit {
  n: number;
  weights: [number, number, number];
  learned: [number, number, number] | null;
  msePrior: number | null;
  mseLearned: number | null;
  applied: boolean;
}

/** Learns the totals weights; keeps the prior unless the learned ones score better on held-out dates. */
export function fitWxTotals(rows: WxTotalRow[], prior: WxWeights): WxTotalFit {
  const p: [number, number, number] = [prior.wind, prior.cold, prior.wet];
  const rough = rows.filter((r) => r.f.wind + r.f.cold + r.f.wet > 0);
  if (rows.length < WX_MIN_TOTAL_N || rough.length < 30) return { n: rows.length, weights: p, learned: null, msePrior: null, mseLearned: null, applied: false };
  const [A, B] = halves(rows);
  const wA = fitTotalOn(A, prior);
  const wB = fitTotalOn(B, prior);
  const mseL = (mse(B, wA) + mse(A, wB)) / 2;
  const mseP = (mse(B, p) + mse(A, p)) / 2;
  const learned = fitTotalOn(rows, prior);
  const applied = mseL < mseP - 1e-6;
  return { n: rows.length, weights: applied ? learned : p, learned, msePrior: +mseP.toFixed(3), mseLearned: +mseL.toFixed(3), applied };
}

const ll = (rows: WxWinRow[], shrink: number) =>
  rows.reduce((s, r) => {
    const q = clampP(wxWinShrink(r.p, r.f, { wind: 0, cold: 0, wet: 0, shrink }));
    return s - (r.y ? Math.log(q) : Math.log(1 - q));
  }, 0) / Math.max(1, rows.length);

export interface WxWinFit {
  n: number;
  shrink: number;
  best: number | null;
  llPrior: number | null;
  llBest: number | null;
  applied: boolean;
}

/** Learns the winner shrink (0-0.3) by held-out log loss. */
export function fitWxWinners(rows: WxWinRow[], prior: WxWeights): WxWinFit {
  if (rows.length < WX_MIN_WIN_N) return { n: rows.length, shrink: prior.shrink, best: null, llPrior: null, llBest: null, applied: false };
  const [A, B] = halves(rows);
  const grid = Array.from({ length: 16 }, (_, i) => i * 0.02);
  const bestOn = (rs: WxWinRow[]) => grid.reduce((b, s) => (ll(rs, s) < ll(rs, b) ? s : b), 0);
  const sA = bestOn(A);
  const sB = bestOn(B);
  const llL = (ll(B, sA) + ll(A, sB)) / 2;
  const llP = (ll(B, prior.shrink) + ll(A, prior.shrink)) / 2;
  const best = bestOn(rows);
  const applied = llL < llP - 1e-5;
  return { n: rows.length, shrink: applied ? best : prior.shrink, best, llPrior: +llP.toFixed(5), llBest: +llL.toFixed(5), applied };
}

/** Weights in use now: learned ones from the refit's store, else the coded prior. */
export function wxWeightsFrom(store: Record<string, { weight: number } | undefined>, sport: WxSport): WxWeights {
  const pr = WX_PRIOR[sport];
  const g = (k: keyof WxWeights, lo: number, hi: number) => {
    const v = store[`wx:${sport}:${k}`]?.weight;
    return typeof v === "number" && v >= lo && v <= hi ? v : pr[k];
  };
  return { wind: g("wind", 0, 1), cold: g("cold", 0, 0.5), wet: g("wet", 0, 5), shrink: g("shrink", 0, 0.3) };
}
