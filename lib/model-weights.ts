// Auto re-testing of how much each sport's final number trusts the model vs
// the betting line.
//
// Every locked pre-game snapshot keeps the model-only chance and the market
// chance next to the final blend. Once games are graded, a grid search finds
// the model share that would have scored them best (log loss). A new share is
// only used when a sport has MIN_N+ live graded games and it beats the current
// share by MIN_GAIN; it's capped at MAX_W so the line always does most of the
// work. Results are stored in app_settings "modelWeights".
import { db } from "@/db";
import { appSettings, games, propPickLog, sportGames } from "@/db/schema";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { SPORTS, PRESEASON, type SportKey } from "./sports/types";
import { GAME_MODEL } from "./sports/game-model";
import { currentSeasonYear } from "./sports/espn";
import { NFL_MODEL_WEIGHT } from "./elo";
import { propModelWeightDefault, codedBookWeight } from "./props-model";
import { fitCurveShares, curveRows } from "./curve-calibration";
import { fitBookWeights, bookRows } from "./book-weights";
import { curveK, CURVE_SHARE, CURVE_SHARE_DEFAULT } from "./market-curve";
import { fitMarket, marketRows, fitStatBias, fitOneSided, oneSidedRows, fitArchiveWeights, fitClv, clvFactor, clvRows, fitModelCal, fitModelCalByStat } from "./market-learn";
import { ONE_SIDED_SHIFT } from "./market-adjust";

const KEY = "modelWeights";
export const MIN_N = 300;
export const MIN_GAIN = 0.001;
export const MAX_W = 0.5;

export interface WeightFit {
  weight: number; // in use
  base: number; // the coded default
  n: number;
  best: number | null;
  llCurrent: number | null;
  llBest: number | null;
  applied: boolean;
  at: string;
}
export type WeightStore = Record<string, WeightFit>;

const clampP = (p: number) => Math.min(0.999, Math.max(0.001, p));
const logit = (p: number) => Math.log(clampP(p) / (1 - clampP(p)));
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export interface WeightRow {
  model: number;
  market: number;
  won: 0 | 1;
  /** Row weight (props: 1 / number of alternate lines logged for the same player, stat and game). */
  w?: number;
}

/** Log loss of blend weight w on the rows. */
export function blendLogLoss(rows: WeightRow[], w: number): number {
  let s = 0;
  let n = 0;
  for (const r of rows) {
    const q = clampP(sigmoid(w * logit(r.model) + (1 - w) * logit(r.market)));
    const k = r.w ?? 1;
    s -= k * (r.won * Math.log(q) + (1 - r.won) * Math.log(1 - q));
    n += k;
  }
  return s / Math.max(1e-9, n);
}

/** Grid search 0..maxW; applies only with enough games and a clear gain. */
export function fitWeight(rows: WeightRow[], base: number, current: number, maxW = MAX_W): Omit<WeightFit, "at"> {
  const n = rows.length;
  if (n === 0) return { weight: current, base, n, best: null, llCurrent: null, llBest: null, applied: current !== base };
  let best = { w: current, v: blendLogLoss(rows, current) };
  const llCurrent = best.v;
  for (let w = 0; w <= maxW + 1e-9; w += 0.01) {
    const v = blendLogLoss(rows, w);
    if (v < best.v - 1e-12) best = { w: +w.toFixed(2), v };
  }
  const better = n >= MIN_N && llCurrent - best.v >= MIN_GAIN;
  const weight = better ? best.w : current;
  return { weight, base, n, best: best.w, llCurrent, llBest: best.v, applied: weight !== base };
}

/**
 * Props: graded picks come in clusters (a player's alternate lines all hit
 * or miss together), so they're weighted to one vote per player-game, and
 * the fitted share moves in gradually: base + (best - base) x n / (n + 150),
 * n = player-games, starting at 40. One odd week can't swing it.
 */
export const PROP_MIN_N = 40;
const PROP_PRIOR_N = 150;
export function fitPropWeight(rows: WeightRow[], base: number): Omit<WeightFit, "at"> {
  const n = Math.round(rows.reduce((a, r) => a + (r.w ?? 1), 0));
  if (rows.length === 0) return { weight: base, base, n, best: null, llCurrent: null, llBest: null, applied: false };
  let best = { w: base, v: blendLogLoss(rows, base) };
  const llBase = best.v;
  for (let w = 0; w <= 1 + 1e-9; w += 0.01) {
    const v = blendLogLoss(rows, w);
    if (v < best.v - 1e-12) best = { w: +w.toFixed(2), v };
  }
  const weight = n >= PROP_MIN_N ? +(base + ((best.w - base) * n) / (n + PROP_PRIOR_N)).toFixed(2) : base;
  return { weight, base, n, best: best.w, llCurrent: llBase, llBest: best.v, applied: weight !== base };
}

/** Per-stat props share: the stat's own fit when it has one against today's sport share, else the sport's. */
export function propWeightFn(store: WeightStore, sport: string): (stat: string) => number {
  const sportW = weightFor(store, `prop:${sport}`);
  // Closing-line multiplier (lib/market-learn.ts clvFactor) for stats without their own fit yet.
  const factor = (key: string) => {
    const w = store[key]?.weight;
    return typeof w === "number" && w >= 0.25 && w <= 1.5 ? w : undefined;
  };
  return (stat: string) => {
    const f = store[`prop:${sport}:${stat}`];
    if (f && f.applied && Math.abs(f.base - sportW) < 1e-9 && f.weight >= 0 && f.weight <= 1) return f.weight;
    const m = factor(`clv:${sport}:${stat}`) ?? factor(`clv:${sport}`) ?? 1;
    return Math.min(0.8, sportW * m);
  };
}

const TRUST_MIN_N = 50;
const TRUST_PRIOR_N = 200;
/** Log-odds shift that best fits graded picks' trust scores to results (shrunk toward 0). */
async function fitTrustShift(sport: string): Promise<Omit<WeightFit, "at"> | null> {
  const rows = await db
    .select({ adj: propPickLog.trustAdj, result: propPickLog.result, player: propPickLog.player, stat: propPickLog.statType, date: propPickLog.gameDate, week: propPickLog.week })
    .from(propPickLog)
    .where(and(eq(propPickLog.sport, sport), inArray(propPickLog.result, ["hit", "miss"])));
  const usable = rows.filter((r) => r.adj != null);
  if (usable.length === 0) return null;
  const ck = (r: (typeof usable)[number]) => `${r.player}|${r.stat}|${r.date ?? r.week}`;
  const size = new Map<string, number>();
  for (const r of usable) size.set(ck(r), (size.get(ck(r)) ?? 0) + 1);
  const ll = (c: number) => {
    let s = 0;
    let n = 0;
    for (const r of usable) {
      const w = 1 / size.get(ck(r))!;
      const q = clampP(sigmoid(logit(r.adj!) + c));
      s -= w * (r.result === "hit" ? Math.log(q) : Math.log(1 - q));
      n += w;
    }
    return s / n;
  };
  let best = { c: 0, v: ll(0) };
  for (let c = -1.5; c <= 1.5001; c += 0.05) {
    const v = ll(c);
    if (v < best.v - 1e-12) best = { c: +c.toFixed(2), v };
  }
  const n = size.size;
  const weight = n >= TRUST_MIN_N ? +((best.c * n) / (n + TRUST_PRIOR_N)).toFixed(3) : 0;
  return { weight, base: 0, n, best: best.c, llCurrent: ll(0), llBest: best.v, applied: weight !== 0 };
}

export const SIDE_MIN_N = 50;
const SIDE_PRIOR_N = 200;
export const SIDE_MAX = 0.6;
/**
 * Over/Under calibration (1.26.0): a log-odds shift per sport and side on a
 * pick's final chance. NBA Unders rated 79% hit 86% while Overs rated 77%
 * hit 68% (first two weeks): one shift for both sides can't fix that. Fit on
 * graded picks (one vote per player-game) as a correction on top of the
 * shift already in use, moved in by n/(n+200) once a side has 50+.
 */
async function fitSideShift(sport: string, side: "Over" | "Under", current: number): Promise<Omit<WeightFit, "at"> | null> {
  const rows = await db
    .select({ final: propPickLog.final, result: propPickLog.result, player: propPickLog.player, stat: propPickLog.statType, date: propPickLog.gameDate, week: propPickLog.week })
    .from(propPickLog)
    .where(and(eq(propPickLog.sport, sport), eq(propPickLog.side, side), inArray(propPickLog.result, ["hit", "miss"])));
  const usable = rows.filter((r) => r.final != null);
  if (usable.length === 0) return null;
  const ck = (r: (typeof usable)[number]) => `${r.player}|${r.stat}|${r.date ?? r.week}`;
  const size = new Map<string, number>();
  for (const r of usable) size.set(ck(r), (size.get(ck(r)) ?? 0) + 1);
  const ll = (c: number) => {
    let s = 0;
    let n = 0;
    for (const r of usable) {
      const w = 1 / size.get(ck(r))!;
      const q = clampP(sigmoid(logit(r.final!) + c));
      s -= w * (r.result === "hit" ? Math.log(q) : Math.log(1 - q));
      n += w;
    }
    return s / n;
  };
  let best = { c: 0, v: ll(0) };
  for (let c = -1; c <= 1.0001; c += 0.02) {
    const v = ll(c);
    if (v < best.v - 1e-12) best = { c: +c.toFixed(2), v };
  }
  const n = size.size;
  const step = n >= SIDE_MIN_N ? (best.c * n) / (n + SIDE_PRIOR_N) : 0;
  const weight = +Math.max(-SIDE_MAX, Math.min(SIDE_MAX, current + step)).toFixed(3);
  return { weight, base: 0, n, best: +(current + best.c).toFixed(2), llCurrent: ll(0), llBest: best.v, applied: weight !== 0 };
}

/** Learned Over/Under shift (log-odds) on a sport's pick chances. */
export function sideShiftFor(store: WeightStore, sport: string): { Over: number; Under: number } {
  const g = (side: string) => {
    const w = store[`side:${sport}:${side}`]?.weight;
    return typeof w === "number" && Math.abs(w) <= SIDE_MAX ? w : 0;
  };
  return { Over: g("Over"), Under: g("Under") };
}

const ADJ_MIN_N = 100;
const ADJ_PRIOR_N = 300;
/**
 * How hard to lean on the projection adjustments (lib/market-adjust.ts
 * scaleAdjustments): k on graded picks' unadjusted vs adjusted model-only
 * chance, moved in from 1 by n/(n+300) once 100+ player-games are graded.
 */
async function fitAdjStrength(sport: string): Promise<Omit<WeightFit, "at"> | null> {
  const rows = await db
    .select({ base: propPickLog.modelBase, model: propPickLog.modelOnly, result: propPickLog.result, player: propPickLog.player, stat: propPickLog.statType, date: propPickLog.gameDate, week: propPickLog.week })
    .from(propPickLog)
    .where(and(eq(propPickLog.sport, sport), inArray(propPickLog.result, ["hit", "miss"])));
  const usable = rows.filter((r) => r.base != null && Math.abs(r.base - r.model) > 1e-6);
  if (usable.length === 0) return null;
  const ck = (r: (typeof usable)[number]) => `${r.player}|${r.stat}|${r.date ?? r.week}`;
  const size = new Map<string, number>();
  for (const r of usable) size.set(ck(r), (size.get(ck(r)) ?? 0) + 1);
  const ll = (k: number) => {
    let s = 0;
    let n = 0;
    for (const r of usable) {
      const w = 1 / size.get(ck(r))!;
      const q = clampP(sigmoid(logit(r.base!) + k * (logit(r.model) - logit(r.base!))));
      s -= w * (r.result === "hit" ? Math.log(q) : Math.log(1 - q));
      n += w;
    }
    return s / n;
  };
  let best = { k: 1, v: ll(1) };
  for (let k = 0; k <= 2.0001; k += 0.1) {
    const v = ll(k);
    if (v < best.v - 1e-12) best = { k: +k.toFixed(1), v };
  }
  const n = size.size;
  const weight = n >= ADJ_MIN_N ? +(1 + ((best.k - 1) * n) / (n + ADJ_PRIOR_N)).toFixed(3) : 1;
  return { weight, base: 1, n, best: best.k, llCurrent: ll(1), llBest: best.v, applied: weight !== 1 };
}

/** Learned adjustment strength for a sport; 1 until enough graded picks. */
export function adjStrengthFor(store: WeightStore, sport: string): number {
  const f = store[`adj:${sport}`];
  return f && typeof f.weight === "number" && f.weight >= 0 && f.weight <= 2 ? f.weight : 1;
}

/** Live trust shift (log-odds) for a sport; 0 until enough graded picks. */
export function trustShiftFor(store: WeightStore, sport: string): number {
  const f = store[`trust:${sport}`];
  return f && typeof f.weight === "number" && Math.abs(f.weight) <= 1.5 ? f.weight : 0;
}

let cache: { at: number; v: WeightStore } | null = null;

export async function getModelWeights(): Promise<WeightStore> {
  if (cache && Date.now() - cache.at < 60_000) return cache.v;
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, KEY));
  const v = (row?.value ?? {}) as WeightStore;
  cache = { at: Date.now(), v };
  return v;
}

/** Props are keyed "prop:<sport>" and may use any share 0..1 (the line isn't as sharp as a game line). */
const isProp = (key: string) => key.startsWith("prop:");
const baseFor = (key: string) =>
  isProp(key) ? propModelWeightDefault(key.slice(5)) : key === "nfl" ? NFL_MODEL_WEIGHT : (GAME_MODEL[key as SportKey]?.modelWeight ?? 0);

/** The weight to use now for a sport (bounded; falls back to the coded default). */
export function weightFor(store: WeightStore, sport: string): number {
  const base = baseFor(sport);
  const f = store[sport];
  const w = f?.weight;
  const max = isProp(sport) ? 1 : MAX_W;
  // A stored share only counts if it was fitted against today's default
  // (when a default changes in code, the old fit no longer applies).
  if (!f || f.base !== base) return base;
  return typeof w === "number" && w >= 0 && w <= max ? w : base;
}

const OTHER: SportKey[] = ["nba", "wnba", "nhl", "mlb", "ncaaf", "ncaab"];
const ALL_KEYS = ["nfl", ...OTHER, ...["nfl", ...OTHER].map((s) => `prop:${s}`)];
const keyLabel = (key: string) => {
  const s = isProp(key) ? key.slice(5) : key;
  const l = s === "nfl" ? "NFL" : SPORTS[s as SportKey].label;
  return isProp(key) ? `${l} props` : `${l} games`;
};

/** Live graded games with a locked model-only and market number. */
export async function liveWeightRows(sport: string, stat?: string): Promise<WeightRow[]> {
  const out: WeightRow[] = [];
  if (isProp(sport)) {
    const rows = await db
      .select({
        model: propPickLog.modelOnly,
        market: propPickLog.market,
        result: propPickLog.result,
        player: propPickLog.player,
        stat: propPickLog.statType,
        date: propPickLog.gameDate,
        week: propPickLog.week,
      })
      .from(propPickLog)
      .where(and(eq(propPickLog.sport, sport.slice(5)), inArray(propPickLog.result, ["hit", "miss"])));
    const withMarket = rows.filter((r) => r.market != null && (!stat || r.stat === stat));
    const ck = (r: (typeof rows)[number]) => `${r.player}|${r.stat}|${r.date ?? r.week}`;
    const size = new Map<string, number>();
    for (const r of withMarket) size.set(ck(r), (size.get(ck(r)) ?? 0) + 1);
    for (const r of withMarket) out.push({ model: r.model, market: r.market!, won: r.result === "hit" ? 1 : 0, w: 1 / size.get(ck(r))! });
    return out;
  }
  if (sport === "nfl") {
    const now = new Date();
    const season = now.getMonth() >= 1 ? now.getFullYear() : now.getFullYear() - 1;
    const rows = await db
      .select()
      .from(games)
      .where(and(inArray(games.season, [season - 1, season]), eq(games.isFinal, true)));
    for (const g of rows) {
      if (g.homeScore === null || g.awayScore === null || g.homeScore === g.awayScore) continue;
      if (g.lockedModelPct == null || g.lockedMarketPct == null) continue;
      out.push({ model: g.lockedModelPct, market: g.lockedMarketPct, won: g.homeScore > g.awayScore ? 1 : 0 });
    }
    return out;
  }
  const season = currentSeasonYear(sport as SportKey);
  const rows = await db
    .select({ homeScore: sportGames.homeScore, awayScore: sportGames.awayScore, extra: sportGames.extra })
    .from(sportGames)
    .where(
      and(eq(sportGames.sport, sport), inArray(sportGames.season, [season - 1, season]), eq(sportGames.isFinal, true), ne(sportGames.seasonType, PRESEASON))
    );
  for (const g of rows) {
    if (g.homeScore === null || g.awayScore === null || g.homeScore === g.awayScore) continue;
    const l = (g.extra as { locked?: { modelOnly?: number | null; market?: number | null } } | null)?.locked;
    if (l?.modelOnly == null || l.market == null) continue;
    out.push({ model: l.modelOnly, market: l.market, won: g.homeScore > g.awayScore ? 1 : 0 });
  }
  return out;
}

export async function refitModelWeights(): Promise<string> {
  const store = await getModelWeights();
  const next: WeightStore = {};
  const msgs: string[] = [];
  for (const sport of ALL_KEYS) {
    const base = baseFor(sport);
    const current = weightFor(store, sport);
    const rows = await liveWeightRows(sport);
    const fit = isProp(sport) ? fitPropWeight(rows, base) : fitWeight(rows, base, current, MAX_W);
    next[sport] = { ...fit, at: new Date().toISOString() };
    msgs.push(`${sport} ${Math.round(fit.weight * 100)}% (n=${fit.n}${fit.best !== null ? `, best ${Math.round(fit.best * 100)}%` : ""})`);
  }
  // Per-stat shares: each stat starts from its sport's share and moves toward
  // its own best fit as its graded player-games come in.
  for (const sport of ALL_KEYS.filter(isProp)) {
    const sportW = next[sport]?.weight ?? baseFor(sport);
    const stats = await db
      .selectDistinct({ stat: propPickLog.statType })
      .from(propPickLog)
      .where(and(eq(propPickLog.sport, sport.slice(5)), inArray(propPickLog.result, ["hit", "miss"])));
    for (const { stat } of stats) {
      const rows = await liveWeightRows(sport, stat);
      const fit = fitPropWeight(rows, sportW);
      next[`${sport}:${stat}`] = { ...fit, at: new Date().toISOString() };
      if (fit.applied) msgs.push(`${sport}:${stat} ${Math.round(fit.weight * 100)}% (n=${fit.n})`);
    }
  }
  // Trust calibration: one log-odds shift per sport on the trust score's
  // backtested chance, fitted on graded picks and moved in gradually.
  for (const s of ["nfl", ...OTHER]) {
    const fit = await fitTrustShift(s);
    if (fit) {
      next[`trust:${s}`] = { ...fit, at: new Date().toISOString() };
      if (fit.applied) msgs.push(`trust:${s} shift ${fit.weight.toFixed(2)} (n=${fit.n})`);
    }
  }

  // Over/Under calibration on the final chance.
  for (const s of ["nfl", ...OTHER]) {
    for (const side of ["Over", "Under"] as const) {
      const cur = sideShiftFor(store, s)[side];
      const fit = await fitSideShift(s, side, cur);
      if (fit) {
        next[`side:${s}:${side}`] = { ...fit, at: new Date().toISOString() };
        if (fit.applied) msgs.push(`side:${s}:${side} ${fit.weight.toFixed(2)} (n=${fit.n})`);
      }
    }
  }

  // Adjustment strength (lib/market-adjust.ts scaleAdjustments).
  for (const s of ["nfl", ...OTHER]) {
    const fit = await fitAdjStrength(s);
    if (fit) {
      next[`adj:${s}`] = { ...fit, at: new Date().toISOString() };
      if (fit.applied) msgs.push(`adj:${s} strength ${fit.weight.toFixed(2)} (n=${fit.n})`);
    }
  }
  // Book weights (lib/book-weights.ts): learned from every graded line, used
  // only when they beat the coded weights on held-out dates.
  try {
    const bf = fitBookWeights(await bookRows(), codedBookWeight);
    const at = new Date().toISOString();
    const use = bf.llLearned < bf.llCoded - 1e-5 && bf.kappa > 0;
    for (const [book, w] of Object.entries(bf.weights)) {
      const e = bf.edges[book];
      if (use) next[`book:${book}`] = { base: codedBookWeight(book), n: e.n, weight: w, best: e.raw, llCurrent: bf.llCoded, llBest: bf.llLearned, applied: true, at };
    }
    msgs.push(`books: kappa ${bf.kappa}, log loss coded ${bf.llCoded} / learned ${bf.llLearned} / equal ${bf.llEqual} (n=${bf.n})${use ? "" : ", kept coded"}`);
  } catch {
    // archive not reachable: keep the coded weights
  }

  // Closing-line evidence per sport and stat (lib/market-learn.ts fitClv):
  // read first so the all-sports reference is known.
  const rowsBySport = new Map<string, Awaited<ReturnType<typeof marketRows>>>();
  const clvBySport = new Map<string, ReturnType<typeof fitClv>>();
  let refXY = 0;
  let refXX = 0;
  for (const s of ["nfl", ...OTHER]) {
    try {
      const rows = await marketRows(s);
      rowsBySport.set(s, rows);
      const c = fitClv(await clvRows(s));
      clvBySport.set(s, c);
      refXY += c.sxy;
      refXX += c.sxx;
    } catch {
      // archive not reachable
    }
  }
  const clvRef = refXX > 0 ? refXY / refXX : 0;

  // Market learning (lib/market-learn.ts): Over bias and line-move
  // continuation per sport, from the graded line archive, shrunk in.
  for (const s of ["nfl", ...OTHER]) {
    try {
      const rows = rowsBySport.get(s) ?? (await marketRows(s));
      const fit = fitMarket(rows);
      const at = new Date().toISOString();
      const common = { base: 0, n: fit.n, llCurrent: fit.llBase, llBest: fit.llFit, at };
      next[`mkt:${s}:bias`] = { ...common, weight: fit.bias, best: fit.fitBias, applied: fit.bias !== 0 };
      next[`mkt:${s}:move`] = { ...common, weight: fit.move, best: fit.fitMove, applied: fit.move !== 0 };
      if (fit.bias || fit.move) msgs.push(`market:${s} over-bias ${fit.bias.toFixed(2)}, move ${fit.move.toFixed(2)} (n=${fit.n})`);
      // Per-stat Over bias, shrunk toward the sport's.
      for (const [stat, f] of Object.entries(fitStatBias(rows, fit.bias, fit.move))) {
        next[`mkt:${s}:bias:${stat}`] = { ...common, n: f.n, weight: f.bias, best: f.fit, applied: f.bias !== fit.bias };
        msgs.push(`market:${s}:${stat} bias ${f.bias.toFixed(2)} (n=${f.n})`);
      }
      // Per-stat model share from every graded archived line (replaces the
      // picks-only fit for a stat once it has enough player-games).
      const sportW = next[`prop:${s}`]?.weight ?? baseFor(`prop:${s}`);
      // Model calibration (applied before the blend, so the shares below are fitted on it).
      const mc = fitModelCal(rows);
      next[`modelcal:${s}:t`] = { base: 1, n: mc.n, weight: mc.t, best: mc.fitT, llCurrent: mc.llRaw, llBest: mc.llFit, applied: mc.t !== 1, at };
      next[`modelcal:${s}:b`] = { base: 0, n: mc.n, weight: mc.b, best: mc.fitB, llCurrent: mc.llRaw, llBest: mc.llFit, applied: mc.b !== 0, at };
      if (mc.n) msgs.push(`modelcal:${s} t ${mc.t} b ${mc.b} (n=${mc.n}, fit ${mc.fitT}/${mc.fitB}, ll ${mc.llRaw}->${mc.llFit})`);
      const mcStat = fitModelCalByStat(rows, { t: mc.t, b: mc.b });
      for (const [stat, f] of Object.entries(mcStat)) {
        next[`modelcal:${s}:stat:${stat}:t`] = { base: mc.t, n: f.n, weight: f.t, best: f.fitT, llCurrent: f.llRaw, llBest: f.llFit, applied: true, at };
        next[`modelcal:${s}:stat:${stat}:b`] = { base: mc.b, n: f.n, weight: f.b, best: f.fitB, llCurrent: f.llRaw, llBest: f.llFit, applied: true, at };
      }
      const calOf = (stat: string) => (mcStat[stat] ? { t: mcStat[stat].t, b: mcStat[stat].b } : { t: mc.t, b: mc.b });
      // Closing-line multiplier per stat: where each stat's share starts.
      const clv = clvBySport.get(s);
      const factorOf = (stat: string) => (clv ? clvFactor(clv.stats[stat], clv, clvRef) : 1);
      if (clv) {
        next[`clv:${s}`] = { base: 1, n: clv.n, weight: factorOf("__sport__"), best: clv.beta, llCurrent: clvRef, llBest: clv.beta, applied: factorOf("__sport__") !== 1, at };
        msgs.push(`clv:${s} beta ${clv.beta} vs all ${clvRef.toFixed(4)} (n=${clv.n})`);
        for (const [stat, c] of Object.entries(clv.stats)) {
          next[`clv:${s}:${stat}`] = { base: 1, n: c.n, weight: factorOf(stat), best: c.beta, llCurrent: clvRef, llBest: c.beta, applied: factorOf(stat) !== 1, at };
        }
      }
      for (const [stat, f] of Object.entries(fitArchiveWeights(rows, sportW, (stat) => Math.min(0.8, sportW * factorOf(stat)), calOf))) {
        next[`prop:${s}:${stat}`] = { weight: f.weight, base: sportW, n: f.n, best: f.best, llCurrent: f.llCurrent, llBest: f.llBest, applied: f.weight !== sportW, at };
        msgs.push(`prop:${s}:${stat} ${Math.round(f.weight * 100)}% from archive (n=${f.n}, best ${Math.round(f.best * 100)}%)`);
      }
      // One-sided (alt-ladder) prices.
      const os = fitOneSided(await oneSidedRows(s), ONE_SIDED_SHIFT);
      next[`mkt:${s}:oneSided`] = { base: ONE_SIDED_SHIFT, n: os.n, llCurrent: os.llDefault, llBest: os.llFit, at, weight: os.used, best: os.fit, applied: os.used !== ONE_SIDED_SHIFT };
      if (os.n) msgs.push(`market:${s} one-sided ${os.used.toFixed(2)} (n=${os.n})`);
      // Market price curve's share (lib/market-curve.ts).
      const def = CURVE_SHARE[s] ?? CURVE_SHARE_DEFAULT;
      const cs = fitCurveShares(await curveRows(s), os.used, (stat) => curveK(s, stat), def);
      for (const k of ["exact", "one"] as const) {
        const f = cs[k];
        next[`curve:${s}:${k}`] = { base: def[k], n: f.n, llCurrent: f.llCurrent, llBest: f.llBest, at, weight: f.weight, best: f.best, applied: f.weight !== def[k] };
        if (f.n) msgs.push(`curve:${s}:${k} ${f.weight.toFixed(2)} (n=${f.n}, best ${f.best})`);
      }
    } catch {
      // archive not reachable: keep going
    }
  }

  await db
    .insert(appSettings)
    .values({ key: KEY, value: next })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: next, updatedAt: sql`now()` } });
  cache = { at: Date.now(), v: next };
  return `Model weights: ${msgs.join(", ")}`;
}

export interface WeightReport {
  sport: string;
  label: string;
  current: number;
  n: number;
  best: number | null;
  status: string;
}

export async function getWeightReport(): Promise<WeightReport[]> {
  const store = await getModelWeights();
  return ALL_KEYS.map((sport) => {
    const f = store[sport];
    const current = weightFor(store, sport);
    const n = f?.n ?? 0;
    const min = isProp(sport) ? PROP_MIN_N : MIN_N;
    const status = !f
      ? "Not tested yet"
      : n < min
        ? `Collecting live ${isProp(sport) ? "player-games" : "games"} (${n} of ${min})`
        : f.applied
          ? "Updated from live results"
          : "Current share holds up";
    return { sport, label: keyLabel(sport), current, n, best: f?.best ?? null, status };
  });
}
