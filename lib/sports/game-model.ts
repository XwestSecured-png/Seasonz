// Win-probability model for every sport except NFL (which has its own
// pipeline in lib/sync.ts). Built in layers, each one kept only because it
// beat the layer below it on a held-out season (scripts/backtest-game-model):
//
//   1. Elo (lib/sports/sport-elo.ts) — team strength from past results.
//   2. Recent scoring margin (last 20 games), plus points in the paint for
//      the NBA (lib/sports/nba-model.ts).
//   3. Starters: MLB starting pitcher quality; NHL "backup goalie starting".
//   4. Injuries: players OUT or suspended (can't be backtested — ESPN keeps
//      no history of injury reports — so the shift is small and capped).
//   = the "model-only" chance.
//   5. Sportsbook line: the model-only chance is blended with the book's
//      moneyline after the book's built-in margin (vig) is removed. The
//      market is the single strongest predictor in every sport, so it gets
//      most of the weight; the model still moves the number.
//   6. Calibration: if this season's graded games show the final numbers
//      drifting too high or too low, upcoming games are nudged back
//      (bounded; see calibrate()).
import type { SportKey } from "./types";

export interface GameModelParams {
  formN: number;
  /** Model-only weights on [1, logit(Elo), form/formSd]. */
  form: [number, number, number];
  formSd: number;
  /** MLB/NHL: weights on [1, logit(Elo), form/formSd, starter/starterSd, backup]. */
  starter?: [number, number, number, number, number];
  starterSd?: number;
  /** Final weights on [1, logit(model-only), logit(no-vig market)]. */
  blend: [number, number, number];
  /** How a 1-point change in expected scoring margin moves logit(win). */
  logitPerPoint: number;
  /** Injury: per-player value above a replacement-level fill-in. */
  replacement: number;
  /** Most an injury list can move a team's chance (probability points). */
  injuryCap: number;
}

// Held-out season results (log loss / picked winner), see README in
// scripts/backtest-game-model:
export const GAME_MODEL: Record<SportKey, GameModelParams> = {
  // 2025-26: Elo .6005 / 67.9% -> + form .5983 / 68.3% -> + FanDuel-style line .5761 / 68.9-69.1%
  nba: { formN: 20, form: [0.0481, 0.761, 0.2239], formSd: 9.5589, blend: [-0.0466, 0.1077, 0.9461], logitPerPoint: 0.115, replacement: 8, injuryCap: 0.1 },
  // 2026: .5949 / 68.0% -> .592 / 68.3% -> .5802 / 69.7%
  wnba: { formN: 20, form: [0.0014, 0.8812, 0.1594], formSd: 9.3908, blend: [-0.006, 0.1601, 0.7991], logitPerPoint: 0.115, replacement: 6, injuryCap: 0.1 },
  // 2025-26: Elo .6952 / 53.0% -> + backup-goalie flag .6928 / 54.6% -> + line .6862 / 54.6%
  nhl: { formN: 20, form: [0.0104, 1.1077, 0], formSd: 1, starter: [0.0104, 1.1077, 0, 0, 0.1654], starterSd: 1, blend: [0.0968, 0.1136, 0.9715], logitPerPoint: 0.6, replacement: 0.35, injuryCap: 0.06 },
  // 2026: Elo .6846 / 56.1% -> + form & starting pitchers .6833 / 56.5%; with a line (2,045 games) .6829-.683
  mlb: { formN: 10, form: [0.0642, 0.7891, 0.0717], formSd: 2.569, starter: [0.0737, 0.7314, 0.0707, 0.0705, 0], starterSd: 0.7616, blend: [0.0658, 0.1915, 0.796], logitPerPoint: 0.35, replacement: 0.35, injuryCap: 0.04 },
  // 2025 (FBS + FCS): Elo .5339 / 72.6% -> + form .5308 / 73.1%; with a line (867 games): .5799 / 69.1% -> .5157 / 74.3%
  ncaaf: { formN: 10, form: [-0.0125, 1.0072, 0.2785], formSd: 18.6887, blend: [0.1249, 0.1585, 0.9383], logitPerPoint: 0.1, replacement: 0, injuryCap: 0.08 },
  // 2025-26: Elo .5345 / 73.0% -> + form .5327 / 73.5%; with a line (5,569 games): .5731 / 70.6% -> .5285 / 72.0%
  ncaab: { formN: 20, form: [0.218, 0.9337, 0.2502], formSd: 10.6753, blend: [0.0061, 0.0377, 1.111], logitPerPoint: 0.1, replacement: 6, injuryCap: 0.08 },
};

const clampP = (p: number) => Math.min(0.995, Math.max(0.005, p));
export const logit = (p: number) => Math.log(clampP(p) / (1 - clampP(p)));
export const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** American odds -> implied probability (with the book's margin still in). */
export function impliedProb(american: number): number {
  return american < 0 ? -american / (-american + 100) : 100 / (american + 100);
}

/** Home team's chance from a two-way moneyline, with the vig removed. */
export function noVigHome(mlHome: number | null | undefined, mlAway: number | null | undefined): number | null {
  if (mlHome == null || mlAway == null || mlHome === 0 || mlAway === 0) return null;
  const h = impliedProb(mlHome);
  const a = impliedProb(mlAway);
  if (!(h > 0 && a > 0)) return null;
  return h / (h + a);
}

export interface ModelInputs {
  eloPct: number;
  /** Home avg margin minus away avg margin over the last formN games (null when either team has under 5). */
  formDiff: number | null;
  /** MLB: away starter's runs/9 minus home starter's (positive favors home). NHL: unused. */
  starterDiff: number | null;
  /** NHL: (away starting a backup ? 1 : 0) - (home starting a backup ? 1 : 0). */
  backup: number | null;
}

/** Elo + recent form + starters, before injuries and the betting line. */
export function modelOnlyPct(sport: SportKey, x: ModelInputs): number {
  const p = GAME_MODEL[sport];
  const L = logit(x.eloPct);
  const f = (x.formDiff ?? 0) / p.formSd;
  if (p.starter) {
    const s = (x.starterDiff ?? 0) / (p.starterSd ?? 1);
    const w = p.starter;
    return sigmoid(w[0] + w[1] * L + w[2] * f + w[3] * s + w[4] * (x.backup ?? 0));
  }
  const w = p.form;
  return sigmoid(w[0] + w[1] * L + w[2] * f);
}

/** Shifts a chance by the scoring each side is missing, capped per sport. */
export function injuryShift(sport: SportKey, homePct: number, homeLost: number, awayLost: number): number {
  const p = GAME_MODEL[sport];
  // Teammates cover part of a missing player's output, so 60% counts.
  const z = logit(homePct) + 0.6 * (awayLost - homeLost) * p.logitPerPoint;
  const raw = sigmoid(z) - homePct;
  return Math.max(-p.injuryCap, Math.min(p.injuryCap, raw));
}

/** Blends the model-only chance with the book's no-vig chance (when there is a line). */
export function blendWithMarket(sport: SportKey, modelPct: number, marketPct: number | null): number {
  if (marketPct == null) return modelPct;
  const w = GAME_MODEL[sport].blend;
  return sigmoid(w[0] + w[1] * logit(modelPct) + w[2] * logit(marketPct));
}

export interface Calibration {
  a: number;
  b: number;
  n: number;
  llBefore: number;
  llAfter: number;
  applied: boolean;
}

/**
 * Checks this season's graded games: if a bounded rescale
 * (logit p -> a + b * logit p) would have scored them clearly better, it is
 * applied to upcoming games. Needs 300+ graded games and only moves
 * within tight limits, so one odd week can't swing it.
 */
export function calibrate(graded: { pct: number; homeWon: number }[]): Calibration {
  const n = graded.length;
  const ll = (a: number, b: number) =>
    graded.reduce((s, g) => {
      const q = clampP(sigmoid(a + b * logit(g.pct)));
      return s - (g.homeWon * Math.log(q) + (1 - g.homeWon) * Math.log(1 - q));
    }, 0) / Math.max(1, n);
  const before = ll(0, 1);
  if (n < 300) return { a: 0, b: 1, n, llBefore: before, llAfter: before, applied: false };
  let best = { a: 0, b: 1, v: before };
  for (let b = 0.8; b <= 1.2001; b += 0.02) {
    for (let a = -0.15; a <= 0.1501; a += 0.01) {
      const v = ll(a, b);
      if (v < best.v) best = { a, b, v };
    }
  }
  const applied = before - best.v > 0.002;
  return { a: +best.a.toFixed(2), b: +best.b.toFixed(2), n, llBefore: before, llAfter: best.v, applied };
}

export function applyCalibration(pct: number, c: Calibration | null): number {
  if (!c?.applied) return pct;
  return sigmoid(c.a + c.b * logit(pct));
}

/** Pitcher quality on a runs-per-9 scale: average of FIP and ERA, shrunk toward league average over 40 innings. */
export function pitcherRuns9(lines: { ip: number; er: number; hr: number; bb: number; k: number }[]): { value: number; ip: number } {
  let ip = 0;
  let f = 0;
  for (const l of lines) {
    if (!(l.ip > 0)) continue;
    const fipRuns = 13 * l.hr + 3 * l.bb - 2 * l.k + 3.2 * l.ip; // FIP x IP
    f += 0.5 * fipRuns + 0.5 * 9 * l.er;
    ip += l.ip;
  }
  const PRIOR = 40;
  const LEAGUE = 4.3;
  return { value: (f + PRIOR * LEAGUE) / (ip + PRIOR), ip };
}

/** "6.1" innings -> 6.333 */
export function inningsToNumber(s: string | number | null | undefined): number {
  const [a, b] = String(s ?? "0").split(".");
  return Number(a) + (Number(b) || 0) / 3;
}
