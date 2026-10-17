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
import { propModelWeightDefault } from "./props-model";

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
export async function liveWeightRows(sport: string): Promise<WeightRow[]> {
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
    const withMarket = rows.filter((r) => r.market != null);
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
