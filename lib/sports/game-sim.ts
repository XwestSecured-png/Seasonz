// Game simulation: turns the model's win chance and the book's total into a
// full distribution of final scores, so spreads, totals and alternate lines
// are all priced from one consistent picture of the game.
//
//   Basketball / football: the final margin is roughly normal around the
//   expected margin; its spread (sdMargin) was measured on 2024-26 closing
//   spreads. The expected margin is the one that gives the model's win
//   chance.
//   Hockey / baseball: each team's score is a count (Poisson for NHL goals,
//   negative binomial for MLB runs, which bunch up more), solved so the
//   home win chance matches the model and the expected total matches the
//   book's over/under price.
//
// Totals stay anchored to the book's own over/under price: in testing
// (scripts/backtest-game-model/README.md) our scoring-based total did not
// beat the closing total in 5 of 6 sports, so we don't claim a totals edge.
// Client-safe: no server imports.
import type { SportKey } from "./types";

export interface SimParams {
  kind: "normal" | "count";
  /** Normal sports: standard deviation of (final margin - expected margin). */
  sdMargin: number;
  /** Normal sports: standard deviation of the final total around its expectation. */
  sdTotal: number;
  /** Count sports: negative-binomial size (higher = closer to Poisson). */
  nbSize?: number;
  /** League-average total, used when no book total is posted. */
  avgTotal: number;
}

// Measured on 2024-26 closing lines (residual of final margin vs. closing
// spread, final total vs. closing total).
export const SIM: Record<SportKey | "nfl", SimParams> = {
  nba: { kind: "normal", sdMargin: 13.8, sdTotal: 17.6, avgTotal: 228 },
  wnba: { kind: "normal", sdMargin: 13.5, sdTotal: 16.1, avgTotal: 164 },
  ncaab: { kind: "normal", sdMargin: 11.2, sdTotal: 16.9, avgTotal: 149 },
  nfl: { kind: "normal", sdMargin: 12.2, sdTotal: 13.0, avgTotal: 45 },
  ncaaf: { kind: "normal", sdMargin: 14.8, sdTotal: 16.2, avgTotal: 54 },
  nhl: { kind: "count", sdMargin: 2.7, sdTotal: 2.3, nbSize: 30, avgTotal: 6.1 },
  mlb: { kind: "count", sdMargin: 4.6, sdTotal: 4.5, nbSize: 8, avgTotal: 8.8 },
};

export interface SimInput {
  homePct: number;
  spreadHome?: number | null; // home team's spread, e.g. -4.5
  spreadHomePrice?: number | null;
  spreadAwayPrice?: number | null;
  total?: number | null;
  overPrice?: number | null;
  underPrice?: number | null;
}

export interface GameSim {
  projHome: number;
  projAway: number;
  /** Model's fair spread for the home team (negative = home favored). */
  fairSpreadHome: number;
  projTotal: number;
  /** At the book's spread: model chance the home side covers, and the book's no-vig chance. */
  spreadHome: number | null;
  coverHome: number | null;
  bookCoverHome: number | null;
  /** At the book's total: chance of the over (anchored to the book's price). */
  total: number | null;
  over: number | null;
}

const implied = (a: number) => (a < 0 ? -a / (-a + 100) : 100 / (a + 100));
function noVig(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null || b == null || a === 0 || b === 0) return null;
  const x = implied(a);
  const y = implied(b);
  return x / (x + y);
}

export function Phi(z: number): number {
  const s = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const e = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + s * e);
}
export function PhiInv(p: number): number {
  const q = Math.min(0.9999, Math.max(0.0001, p));
  let lo = -8;
  let hi = 8;
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2;
    if (Phi(m) < q) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
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

/** P(score = k) for a team expected to score m: Poisson, or negative binomial with size r. */
function scorePmf(m: number, r: number | undefined, max = 30): number[] {
  const out: number[] = [];
  for (let k = 0; k <= max; k++) {
    out.push(
      r
        ? Math.exp(lgamma(k + r) - lgamma(r) - lgamma(k + 1) + r * Math.log(r / (r + m)) + k * Math.log(m / (r + m)))
        : Math.exp(k * Math.log(m) - m - lgamma(k + 1))
    );
  }
  return out;
}

interface CountDist {
  win: number;
  coverAt: (spreadHome: number) => number;
  overAt: (line: number) => number;
}
function countDist(lh: number, la: number, r: number | undefined): CountDist {
  const ph = scorePmf(lh, r);
  const pa = scorePmf(la, r);
  const cells: { m: number; t: number; p: number }[] = [];
  let win = 0;
  let tie = 0;
  for (let i = 0; i < ph.length; i++)
    for (let j = 0; j < pa.length; j++) {
      const p = ph[i] * pa[j];
      cells.push({ m: i - j, t: i + j, p });
      if (i > j) win += p;
      else if (i === j) tie += p;
    }
  const share = (f: (c: { m: number; t: number }) => number) => {
    let yes = 0;
    let push = 0;
    for (const c of cells) {
      const v = f(c);
      if (v > 0) yes += c.p;
      else if (v === 0) push += c.p;
    }
    return yes / Math.max(1e-9, 1 - push);
  };
  return {
    // Ties go to overtime / extra innings: split evenly.
    win: win + tie / 2,
    coverAt: (s) => share((c) => c.m + s),
    overAt: (line) => share((c) => c.t - line),
  };
}

/** P(total > line), pushes excluded. */
function countOver(lh: number, la: number, r: number | undefined, line: number): number {
  const ph = scorePmf(lh, r);
  const pa = scorePmf(la, r);
  let over = 0;
  let push = 0;
  for (let i = 0; i < ph.length; i++)
    for (let j = 0; j < pa.length; j++) {
      const t = i + j - line;
      if (t > 0) over += ph[i] * pa[j];
      else if (t === 0) push += ph[i] * pa[j];
    }
  return over / Math.max(1e-9, 1 - push);
}

/** Home win chance (ties split) without building the full score grid. */
function countWin(lh: number, la: number, r: number | undefined): number {
  const ph = scorePmf(lh, r);
  const pa = scorePmf(la, r);
  let cumA = 0;
  let win = 0;
  for (let i = 0; i < ph.length; i++) {
    win += ph[i] * (cumA + pa[i] / 2); // away scored fewer, plus half the ties
    cumA += pa[i];
  }
  return win;
}

/** Expected scores (home, away) for a count sport that give win chance p and expected total T. */
function solveCount(p: number, T: number, r: number | undefined): [number, number] {
  let lo = -T * 0.9;
  let hi = T * 0.9;
  for (let i = 0; i < 30; i++) {
    const d = (lo + hi) / 2;
    if (countWin(T / 2 + d / 2, T / 2 - d / 2, r) < p) lo = d;
    else hi = d;
  }
  const d = (lo + hi) / 2;
  return [T / 2 + d / 2, T / 2 - d / 2];
}

export function simulateGame(sport: SportKey | "nfl", x: SimInput): GameSim {
  const P = SIM[sport];
  const bookOver = x.total != null ? noVig(x.overPrice, x.underPrice) : null;
  const bookCoverHome = x.spreadHome != null ? noVig(x.spreadHomePrice, x.spreadAwayPrice) : null;
  const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

  if (P.kind === "normal") {
    const mu = P.sdMargin * PhiInv(x.homePct);
    // The book's expected total: its line, nudged by how the over is priced.
    const T = x.total != null ? x.total + (bookOver != null ? P.sdTotal * PhiInv(bookOver) : 0) : P.avgTotal;
    return {
      projHome: round(T / 2 + mu / 2),
      projAway: round(T / 2 - mu / 2),
      fairSpreadHome: Math.round(-mu * 2) / 2 || 0, // nearest half point
      projTotal: round(T),
      spreadHome: x.spreadHome ?? null,
      coverHome: x.spreadHome != null ? Phi((mu + x.spreadHome) / P.sdMargin) : null,
      bookCoverHome,
      total: x.total ?? null,
      over: x.total != null ? 1 - Phi((x.total - T) / P.sdTotal) : null,
    };
  }

  // Count sports: find the expected total that reproduces the book's over price.
  let T = x.total ?? P.avgTotal;
  if (x.total != null && bookOver != null) {
    let lo = Math.max(0.5, x.total - 3);
    let hi = x.total + 3;
    for (let i = 0; i < 25; i++) {
      const mid = (lo + hi) / 2;
      const [h, a] = solveCount(x.homePct, mid, P.nbSize);
      if (countOver(h, a, P.nbSize, x.total) < bookOver) lo = mid;
      else hi = mid;
    }
    T = (lo + hi) / 2;
  }
  const [lh, la] = solveCount(x.homePct, T, P.nbSize);
  const d = countDist(lh, la, P.nbSize);
  return {
    projHome: round(lh),
    projAway: round(la),
    fairSpreadHome: round(la - lh),
    projTotal: round(lh + la),
    spreadHome: x.spreadHome ?? null,
    coverHome: x.spreadHome != null ? d.coverAt(x.spreadHome) : null,
    bookCoverHome,
    total: x.total ?? null,
    over: x.total != null ? d.overAt(x.total) : null,
  };
}
