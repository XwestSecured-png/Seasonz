// Prop trust score: how much to believe a prop pick's chance.
//
// Every listed prop already has a 70%+ model chance, so the chance alone
// doesn't separate them much. The trust score is the chance the backtest says
// picks like this one actually hit, using what the model's chance leaves out:
//   - games of data: 3-4 games is thin, and those picks hit less than the
//     model said;
//   - the player's recent hit rate on this exact line and side;
//   - volatility (the stat's spread vs its average over his last 10 games);
//     oddly, very steady players are the ones the model overrates (a narrow
//     recent spread understates what can happen);
//   - minutes stability where minutes are known (rotation changes, blowouts).
// The adjustment is a logistic fit per sport on replayed player histories
// (lib/prop-trust.ts trustBacktest, via /api/health/insights?trustcal=),
// checked on held-out games. On top, one rule that can't be backtested
// without historical prices: when our chance beats the book's price by 15+
// points, trust is capped at Medium (books are usually right when the gap is
// that big; the model may be missing news).
//
// Client-safe: no server imports.
import { projectProp, propChance, type PropModelConfig } from "./prop-dist";

export type TrustTier = "High" | "Medium" | "Low";

export interface Trust {
  /** Backtested chance picks like this hit (0-1). */
  adj: number;
  tier: TrustTier;
  /** Recent hit count on this line and side, e.g. 8 of 10. */
  hits: number | null;
  of: number | null;
  games: number;
  reasons: string[];
}

/** Logistic coefficients: [intercept, logit p, n<5, 5<=n<8, cv<0.3, cv, hitRate, minutesCv]. */
export type TrustCoef = [number, number, number, number, number, number, number, number];

const clampP = (p: number) => Math.min(0.995, Math.max(0.005, p));
const logit = (p: number) => Math.log(clampP(p) / (1 - clampP(p)));
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

// Fitted per sport by trustBacktest (see the header). DEFAULT is the NFL fit,
// used for any sport without its own.
//
// Held-out check (latest 25% of each sport's replayed games; hit rate of
// High / Medium / Low tiers, and log loss raw model -> with trust adjustment):
//   NFL   84.6 / 74.8 / 68.4%   .4551 -> .4521
//   NBA   85.3 / 74.6 / 69.5%   .4506 -> .4475
//   WNBA  85.7 / 76.0 / 72.3%   .4420 -> .4394
//   NHL   87.0 / 74.2 / 70.5%   .4292 -> .4288
//   MLB   87.8 / 75.7 / 72.5%   .4182 -> .4170
//   NCAAF 84.5 / 83.5 / 67.2%   .4541 -> .4498 with its own fit (unstable; uses NFL's, below)
export const TRUST_COEF: Record<string, TrustCoef> = {
  nfl: [-0.2529, 0.7487, -0.4326, -0.1494, -0.3048, -0.1803, 0.968, 0],
  nba: [0.2196, 0.737, -0.2389, -0.0957, -0.2991, -0.3545, 0.6754, -0.246],
  wnba: [-0.0265, 0.703, -0.4776, -0.1186, -0.264, -0.2978, 0.9681, -0.2386],
  nhl: [0.5875, 0.979, -0.2652, -0.0708, -0.3548, -0.5086, 0.0308, -0.4705],
  mlb: [0.3822, 0.97, -0.2133, -0.1725, -0.1966, -0.4682, 0.1014, 0],
  // NCAAF's own fit (-0.9608, 0.5953, 0.5756, 0.6592, -0.5976, 0.0073, 1.0318) is
  // unstable: few players have 8+ games, so it pushed steady veterans under
  // 55%. College football uses the NFL fit.
  ncaaf: [-0.2529, 0.7487, -0.4326, -0.1494, -0.3048, -0.1803, 0.968, 0],
  // NCAAB has no box scores synced yet: NBA's fit.
  DEFAULT: [0.2196, 0.737, -0.2389, -0.0957, -0.2991, -0.3545, 0.6754, -0.246],
};

export interface TrustFeatures {
  n: number;
  hits: number | null;
  of: number | null;
  hitRate: number | null;
  cv: number | null;
  minutesCv: number | null;
}

/** Features from the player's prior games (oldest first) for one line and side. */
export function trustFeatures(values: number[], line: number, side: "Over" | "Under", minutes?: (number | null)[]): TrustFeatures {
  const n = values.length;
  const last = values.slice(-10);
  const hits = last.length ? last.filter((v) => (side === "Over" ? v > line : v < line)).length : null;
  const m = last.length ? last.reduce((a, b) => a + b, 0) / last.length : 0;
  const sd = last.length > 1 ? Math.sqrt(last.reduce((a, v) => a + (v - m) ** 2, 0) / (last.length - 1)) : 0;
  const mins = minutes?.slice(-10).filter((x): x is number => x != null && x > 0) ?? [];
  const mm = mins.length ? mins.reduce((a, b) => a + b, 0) / mins.length : 0;
  const msd = mins.length > 1 ? Math.sqrt(mins.reduce((a, v) => a + (v - mm) ** 2, 0) / (mins.length - 1)) : 0;
  return {
    n,
    hits,
    of: last.length || null,
    hitRate: last.length ? hits! / last.length : null,
    cv: m > 0 ? sd / m : null,
    minutesCv: mins.length >= 3 && mm > 0 ? msd / mm : null,
  };
}

function vector(p: number, f: TrustFeatures): number[] {
  const cv = f.cv === null ? 0.7 : Math.min(2, f.cv);
  return [
    1,
    logit(p),
    f.n < 5 ? 1 : 0,
    f.n >= 5 && f.n < 8 ? 1 : 0,
    f.cv !== null && f.cv < 0.3 ? 1 : 0,
    cv,
    f.hitRate ?? 0.8,
    f.minutesCv === null ? 0 : Math.min(1, f.minutesCv),
  ];
}

export function adjustedChance(sport: string, p: number, f: TrustFeatures): number {
  const c = TRUST_COEF[sport] ?? TRUST_COEF.DEFAULT;
  const x = vector(p, f);
  return sigmoid(x.reduce((s, v, i) => s + v * c[i], 0));
}

export const TRUST_HIGH = 0.78;
export const TRUST_MEDIUM = 0.72;
export const BOOK_GAP_CAP = 0.15;

/** The trust score for one prop pick. `implied` is the market's no-vig chance for the side (else the price's; null for model-only props). */
export function propTrust(sport: string, p: number, f: TrustFeatures, implied: number | null): Trust {
  const adj = adjustedChance(sport, p, f);
  let tier: TrustTier = adj >= TRUST_HIGH && f.n >= 5 ? "High" : adj >= TRUST_MEDIUM ? "Medium" : "Low";
  const reasons: string[] = [];
  if (f.hits !== null && f.of) reasons.push(`Hit this line in ${f.hits} of the last ${f.of} games`);
  if (f.n < 5) reasons.push(`Only ${f.n} games of data`);
  else if (f.n >= 8) reasons.push(`${f.n} games of data`);
  if (f.cv !== null && f.cv < 0.3) reasons.push("Very steady lately, which the model tends to overrate");
  else if (f.cv !== null && f.cv > 1.2) reasons.push("Up-and-down stat game to game");
  if (f.minutesCv !== null && f.minutesCv > 0.25) reasons.push("Minutes have moved around");
  if (implied !== null && p - implied >= BOOK_GAP_CAP) {
    if (tier === "High") tier = "Medium";
    reasons.push(`Our chance is ${Math.round((p - implied) * 100)} pts above the betting market's; gaps that big often mean news the model hasn't seen`);
  }
  return { adj, tier, hits: f.hits, of: f.of, games: f.n, reasons };
}

/** Trust for a game leg (moneyline/spread/total): the blended chance is already market-anchored. */
export function gameTrust(p: number, hasLine: boolean): Trust {
  const tier: TrustTier = !hasLine ? (p >= 0.75 ? "Medium" : "Low") : p >= 0.72 ? "High" : p >= 0.62 ? "Medium" : "Low";
  return {
    adj: p,
    tier,
    hits: null,
    of: null,
    games: 0,
    reasons: hasLine ? ["Model blended with the betting line"] : ["No betting line yet: model only"],
  };
}

/** Trust for a model-only prop (no book line, e.g. anytime TD): never High, nothing to check it against. */
export function modelOnlyTrust(p: number): Trust {
  return {
    adj: p,
    tier: p >= 0.75 ? "Medium" : "Low",
    hits: null,
    of: null,
    games: 0,
    reasons: ["Model-only prop: no sportsbook line to check it against"],
  };
}

/** Overall parlay trust: held down by the weakest leg, and long parlays can't be High. */
export function parlayTrust(legs: { tier: TrustTier; prob: number }[]): { tier: TrustTier; reason: string } {
  if (legs.length === 0) return { tier: "Low", reason: "No legs" };
  const rank: Record<TrustTier, number> = { Low: 0, Medium: 1, High: 2 };
  const weakest = legs.reduce((w, l) => (rank[l.tier] < rank[w.tier] ? l : w));
  const combined = legs.reduce((a, l) => a * l.prob, 1);
  let tier = weakest.tier;
  if (tier === "High" && (legs.length > 4 || combined < 0.3)) tier = "Medium";
  if (combined < 0.08) tier = "Low";
  const lows = legs.filter((l) => l.tier === "Low").length;
  const reason =
    lows > 0
      ? `${lows} leg${lows > 1 ? "s" : ""} with low trust`
      : tier === "High"
        ? "Every leg is high trust"
        : combined < 0.08
          ? "Long shot: all legs have to hit"
          : "Held down by its weakest leg";
  return { tier, reason };
}

// ---------------------------------------------------------------------------
// Backtest and fit (server-side, via the health endpoint).

export interface TrustSample {
  t: number; // time order, for the train/test split
  y: 0 | 1;
  x: number[];
  p: number;
}

/** Replays each player's history: lines at the projection and +/- 0.5 and 1 sd; keeps 70%+ sides, like the app. */
export function trustSamples(
  series: { values: { t: number; v: number; min?: number | null }[] }[],
  cfg: PropModelConfig,
  floorAbs: number,
  maxGames = 25000
): TrustSample[] {
  const out: TrustSample[] = [];
  // Evenly thin very large histories so one request can replay them.
  const total = series.reduce((a, s) => a + Math.max(0, s.values.length - 3), 0);
  const step = Math.max(1, Math.ceil(total / maxGames));
  let k = 0;
  for (const s of series) {
    const vals = s.values.map((x) => x.v);
    const mins = s.values.map((x) => x.min ?? null);
    const useMin = cfg.useMinutes && mins.every((m) => m !== null);
    for (let i = 3; i < vals.length; i++) {
      if (k++ % step !== 0) continue;
      if (useMin && !((mins[i] ?? 0) > 0)) continue;
      const prior = vals.slice(0, i);
      const priorMin = mins.slice(0, i);
      const proj = projectProp(prior, cfg, floorAbs, useMin ? priorMin : undefined);
      if (!proj || proj.mean <= 0) continue;
      for (const k of [-1, -0.5, 0, 0.5, 1]) {
        let line = Math.round((proj.mean + k * proj.sd) * 2) / 2;
        if (Number.isInteger(line)) line += 0.5;
        if (line <= 0) continue;
        const pOver = propChance(proj, line, cfg, "Over");
        const side = pOver >= 0.5 ? "Over" : "Under";
        const p = Math.max(pOver, 1 - pOver);
        if (p < 0.7) continue;
        const y = vals[i];
        const f = trustFeatures(prior, line, side, priorMin);
        out.push({ t: s.values[i].t, y: (side === "Over" ? y > line : y < line) ? 1 : 0, x: vector(p, f), p });
      }
    }
  }
  return out;
}

/** Logistic regression by Newton's method (small, ridge-stabilized). */
export function fitLogistic(samples: TrustSample[], iters = 25, ridge = 1): number[] {
  const d = samples[0]?.x.length ?? 0;
  const w = new Array(d).fill(0);
  w[1] = 1;
  for (let it = 0; it < iters; it++) {
    const g = new Array(d).fill(0);
    const H = Array.from({ length: d }, () => new Array(d).fill(0));
    for (const s of samples) {
      const q = sigmoid(s.x.reduce((a, v, i) => a + v * w[i], 0));
      const r = q * (1 - q);
      for (let i = 0; i < d; i++) {
        g[i] += (q - s.y) * s.x[i];
        for (let j = 0; j < d; j++) H[i][j] += r * s.x[i] * s.x[j];
      }
    }
    for (let i = 1; i < d; i++) {
      g[i] += ridge * (w[i] - (i === 1 ? 1 : 0));
      H[i][i] += ridge;
    }
    const step = solve(H, g);
    if (!step) break;
    let max = 0;
    for (let i = 0; i < d; i++) {
      w[i] -= step[i];
      max = Math.max(max, Math.abs(step[i]));
    }
    if (max < 1e-7) break;
  }
  return w;
}

function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) {
      // Feature never varies (e.g. no minutes): leave its weight alone.
      M[c][c] = 1;
      for (let j = c + 1; j <= n; j++) M[c][j] = 0;
      continue;
    }
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

const ll = (y: number, q: number) => -(y * Math.log(clampP(q)) + (1 - y) * Math.log(1 - clampP(q)));

export interface TrustBacktest {
  n: number;
  train: number;
  test: number;
  coef: number[];
  llRaw: number;
  llAdj: number;
  /** Held-out games by tier: predicted (raw model) vs actual hit rate. */
  tiers: Record<TrustTier, { n: number; model: number; adj: number; actual: number }>;
}

/** Fits on the earliest 75% of samples (by time) and scores the latest 25%. */
export function trustBacktest(samples: TrustSample[]): TrustBacktest | null {
  if (samples.length < 500) return null;
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const cut = Math.floor(sorted.length * 0.75);
  const train = sorted.slice(0, cut);
  const test = sorted.slice(cut);
  // Thin very large training sets for speed.
  const step = Math.max(1, Math.ceil(train.length / 60000));
  const coef = fitLogistic(train.filter((_, i) => i % step === 0));
  let llRaw = 0;
  let llAdj = 0;
  const tiers: TrustBacktest["tiers"] = {
    High: { n: 0, model: 0, adj: 0, actual: 0 },
    Medium: { n: 0, model: 0, adj: 0, actual: 0 },
    Low: { n: 0, model: 0, adj: 0, actual: 0 },
  };
  for (const s of test) {
    const q = sigmoid(s.x.reduce((a, v, i) => a + v * coef[i], 0));
    llRaw += ll(s.y, s.p);
    llAdj += ll(s.y, q);
    const nSmall = s.x[2] === 1;
    const tier: TrustTier = q >= TRUST_HIGH && !nSmall ? "High" : q >= TRUST_MEDIUM ? "Medium" : "Low";
    const b = tiers[tier];
    b.n++;
    b.model += s.p;
    b.adj += q;
    b.actual += s.y;
  }
  for (const b of Object.values(tiers)) {
    if (b.n) {
      b.model /= b.n;
      b.adj /= b.n;
      b.actual /= b.n;
    }
  }
  return { n: samples.length, train: train.length, test: test.length, coef: coef.map((c) => +c.toFixed(4)), llRaw: llRaw / test.length, llAdj: llAdj / test.length, tiers };
}
