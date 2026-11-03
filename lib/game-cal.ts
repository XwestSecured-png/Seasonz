// Game-model confidence calibration (1.38.0), every sport but the NFL.
//
// The model's own win chance ("model-only", before the betting line) can be
// too timid or too bold for a sport: on 2026-27 graded games it was much too
// timid in college basketball (early-season mismatches it rated 85% that
// won far more often) and a little too bold in the NBA. Each night the refit
// learns a rescale, logit(p) -> a + b * logit(p), per sport from graded
// games, fitting on one half of the dates and scoring on the other, and
// keeps it only when it predicts the half it didn't see clearly better.
//
// Fitting uses the raw model-only number saved before this layer (locked
// "modelRaw"), so the layer never learns from its own output.

const clampP = (p: number) => Math.min(0.999, Math.max(0.001, p));
const logit = (p: number) => Math.log(clampP(p) / (1 - clampP(p)));
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export interface GameCalRow {
  at: number;
  p: number;
  y: 0 | 1;
}

export interface GameCal {
  n: number;
  a: number;
  b: number;
  llRaw: number | null;
  llHeld: number | null;
  applied: boolean;
}

export const GAME_CAL_MIN_N = 150;
/** Held-out log loss must improve by at least this much. */
export const GAME_CAL_MIN_GAIN = 0.002;
const B_GRID = Array.from({ length: 41 }, (_, i) => 0.5 + i * 0.05); // 0.5 .. 2.5
const A_GRID = Array.from({ length: 13 }, (_, i) => -0.3 + i * 0.05); // -0.3 .. 0.3

export const applyGameCal = (p: number, c: { a: number; b: number } | null | undefined) =>
  c && (c.a !== 0 || c.b !== 1) ? sigmoid(c.a + c.b * logit(p)) : p;

function ll(rows: GameCalRow[], a: number, b: number): number {
  let s = 0;
  for (const r of rows) {
    const q = clampP(sigmoid(a + b * logit(r.p)));
    s -= r.y ? Math.log(q) : Math.log(1 - q);
  }
  return s / Math.max(1, rows.length);
}

function best(rows: GameCalRow[]): { a: number; b: number } {
  let out = { a: 0, b: 1, v: ll(rows, 0, 1) };
  for (const b of B_GRID)
    for (const a of A_GRID) {
      const v = ll(rows, a, b);
      if (v < out.v - 1e-9) out = { a, b, v };
    }
  return { a: +out.a.toFixed(2), b: +out.b.toFixed(2) };
}

export function fitGameCal(rows: GameCalRow[]): GameCal {
  const n = rows.length;
  if (n < GAME_CAL_MIN_N) return { n, a: 0, b: 1, llRaw: null, llHeld: null, applied: false };
  const s = [...rows].sort((x, y) => x.at - y.at);
  const cut = s[Math.floor(n / 2)].at;
  const A = s.filter((r) => r.at < cut);
  const B = s.filter((r) => r.at >= cut);
  if (A.length < 30 || B.length < 30) return { n, a: 0, b: 1, llRaw: null, llHeld: null, applied: false };
  const fA = best(A);
  const fB = best(B);
  const held = (ll(B, fA.a, fA.b) * B.length + ll(A, fB.a, fB.b) * A.length) / n;
  const raw = ll(s, 0, 1);
  const applied = raw - held >= GAME_CAL_MIN_GAIN;
  const all = best(s);
  return { n, a: applied ? all.a : 0, b: applied ? all.b : 1, llRaw: +raw.toFixed(4), llHeld: +held.toFixed(4), applied };
}
