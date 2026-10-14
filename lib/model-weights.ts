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
import { appSettings, games, sportGames } from "@/db/schema";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { SPORTS, PRESEASON, type SportKey } from "./sports/types";
import { GAME_MODEL } from "./sports/game-model";
import { currentSeasonYear } from "./sports/espn";
import { NFL_MODEL_WEIGHT } from "./elo";

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
}

/** Log loss of blend weight w on the rows. */
export function blendLogLoss(rows: WeightRow[], w: number): number {
  let s = 0;
  for (const r of rows) {
    const q = clampP(sigmoid(w * logit(r.model) + (1 - w) * logit(r.market)));
    s -= r.won * Math.log(q) + (1 - r.won) * Math.log(1 - q);
  }
  return s / Math.max(1, rows.length);
}

/** Grid search 0..MAX_W; applies only with enough games and a clear gain. */
export function fitWeight(rows: WeightRow[], base: number, current: number): Omit<WeightFit, "at"> {
  const n = rows.length;
  if (n === 0) return { weight: current, base, n, best: null, llCurrent: null, llBest: null, applied: current !== base };
  let best = { w: current, v: blendLogLoss(rows, current) };
  const llCurrent = best.v;
  for (let w = 0; w <= MAX_W + 1e-9; w += 0.01) {
    const v = blendLogLoss(rows, w);
    if (v < best.v - 1e-12) best = { w: +w.toFixed(2), v };
  }
  const better = n >= MIN_N && llCurrent - best.v >= MIN_GAIN;
  const weight = better ? best.w : current;
  return { weight, base, n, best: best.w, llCurrent, llBest: best.v, applied: weight !== base };
}

let cache: { at: number; v: WeightStore } | null = null;

export async function getModelWeights(): Promise<WeightStore> {
  if (cache && Date.now() - cache.at < 60_000) return cache.v;
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, KEY));
  const v = (row?.value ?? {}) as WeightStore;
  cache = { at: Date.now(), v };
  return v;
}

/** The weight to use now for a sport (bounded; falls back to the coded default). */
export function weightFor(store: WeightStore, sport: string): number {
  const base = sport === "nfl" ? NFL_MODEL_WEIGHT : GAME_MODEL[sport as SportKey]?.modelWeight ?? 0;
  const w = store[sport]?.weight;
  return typeof w === "number" && w >= 0 && w <= MAX_W ? w : base;
}

const OTHER: SportKey[] = ["nba", "wnba", "nhl", "mlb", "ncaaf", "ncaab"];

/** Live graded games with a locked model-only and market number. */
export async function liveWeightRows(sport: string): Promise<WeightRow[]> {
  const out: WeightRow[] = [];
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
  for (const sport of ["nfl", ...OTHER]) {
    const base = sport === "nfl" ? NFL_MODEL_WEIGHT : GAME_MODEL[sport as SportKey].modelWeight;
    const current = weightFor(store, sport);
    const rows = await liveWeightRows(sport);
    const fit = fitWeight(rows, base, current);
    next[sport] = { ...fit, at: new Date().toISOString() };
    msgs.push(`${sport} ${Math.round(fit.weight * 100)}% (n=${fit.n}${fit.best !== null ? `, best ${Math.round(fit.best * 100)}%` : ""})`);
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
  return ["nfl", ...OTHER].map((sport) => {
    const f = store[sport];
    const current = weightFor(store, sport);
    const n = f?.n ?? 0;
    const status = !f
      ? "Not tested yet"
      : n < MIN_N
        ? `Collecting live games (${n} of ${MIN_N})`
        : f.applied
          ? "Updated from live results"
          : "Current share holds up";
    return { sport, label: sport === "nfl" ? "NFL" : SPORTS[sport as SportKey].label, current, n, best: f?.best ?? null, status };
  });
}
