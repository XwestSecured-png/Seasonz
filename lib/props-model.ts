import type { PlayerWeekStats, DefensivePlayerWeekStats, ScheduleGame, SnapRow } from "./nflverse";
import { NFL_DISPLAY_ONLY_STATS } from "./derived-props";
import { adjustMarketMap, scaleAdjustments, oneSidedChance, type MarketLearn } from "./market-adjust";
import type { PropOutcome } from "./odds";
import { MIN_MODEL_WIN_PCT } from "./confidence";
import { projectProp, propChance, type PropModelConfig, type Projection, streakFactor, streakReason } from "./prop-dist";
import { propTrust, calibrateTrust, trustFeatures, type Trust } from "./prop-trust";

// A one- or two-game season average is too small a sample to trust over a
// book's own (much larger) model — require a few games first.
const MIN_GAMES_FOR_PROJECTION = 3;
// Only the player's most recent games feed the projection, weighted toward
// the most recent of those — recent form, not a flat season-long average.
const RECENT_GAMES_WINDOW = 5;
// A player's own game-to-game std dev floor, so a tiny real sample (e.g. 3
// nearly-identical games) never reads as near-certain: an absolute floor
// per stat type (yards are a bigger number than receptions) or 12% of the
// mean, whichever is larger (applied in lib/prop-dist.ts).
// From the prop calibration check (lib/prop-calibration.ts) on 2024-2026
// weekly stats: the old spread said 81-84% on 70%+ picks that hit 74-77%.
// Wider spreads bring predicted and actual together (e.g. Rec Yds 78.1% / 78.2%).
const NFL_SD_MULT: Record<string, number> = { "Pass Yds": 1.3, "Rush Yds": 1.3, "Rec Yds": 1.4, Receptions: 1.3, "Rush + Rec Yds": 1.3 };

// Per-stat model, chosen on 2021-25 weekly stats (lib/prop-dist.ts; log loss,
// lower is better, old -> new): yardage stays a bell curve but the last 5
// games are pulled toward the 20-game average (Pass .612 -> .602, Rush
// .613 -> .609, Rec .618 -> .610); receptions are a count, so Poisson
// (.602 -> .582), with a small calibration pull toward 50%.
/** The 1.23.0 prop types: stat -> PlayerWeekStats field (projection and grading). */
export const NFL_EXTRA_FIELDS: { statType: string; field: keyof PlayerWeekStats }[] = [
  { statType: "Completions", field: "completions" },
  { statType: "Pass Attempts", field: "attempts" },
  { statType: "Pass + Rush Yds", field: "passRushYds" },
  { statType: "Rush Attempts", field: "carries" },
  { statType: "Pass TDs", field: "passTds" },
  { statType: "Rush TDs", field: "rushingTds" },
  { statType: "Rec TDs", field: "receivingTds" },
  { statType: "Anytime TD", field: "anytimeTd" },
  { statType: "INTs Thrown", field: "interceptionsThrown" },
  { statType: "Kicking Points", field: "kickPts" },
  { statType: "Sacks", field: "defSacks" },
  { statType: "Tackles + Assists", field: "tackles" },
  { statType: "Solo Tackles", field: "soloTackles" },
];

export const NFL_PROP_MODEL: Record<string, PropModelConfig> = {
  // Spread now pulls in the 20-game spread (sdShrinkK 10, multiplier x0.9);
  // backtest on 2022-26 weekly stats with lines out to 2 sd: Pass .4920 ->
  // .4812, Rush .5197 -> .5121, Rec .5265 -> .5189, Rush + Rec .5164 -> .5089.
  "Pass Yds": { dist: "normal", sdMult: 1.17, shrinkK: 5, useMinutes: false, temper: 0.94, sdShrinkK: 10 },
  "Rush Yds": { dist: "normal", sdMult: 1.17, shrinkK: 5, useMinutes: false, temper: 0.94, sdShrinkK: 10 },
  "Rec Yds": { dist: "normal", sdMult: 1.26, shrinkK: 5, useMinutes: false, sdShrinkK: 10 },
  Receptions: { dist: "poisson", sdMult: 1.3, shrinkK: 5, useMinutes: false, temper: 0.88 },
  // Rushing + receiving yards. Chosen on 2024-26 weekly stats (248 RB/WR/TE
  // histories, lines at the projection +/- 0.5 and 1 sd): bell curve, 20-game
  // pull 5, slight calibration pull.
  "Rush + Rec Yds": { dist: "normal", sdMult: 1.17, shrinkK: 5, useMinutes: false, temper: 0.94, sdShrinkK: 10 },
  // 1.23.0: the rest of the books' menu. Each chosen on nflverse weekly
  // stats (fitted 2022-24, checked 2025-26, lines around the projection or
  // the books' usual 0.5/1.5/2.5); the winner held on both splits:
  // Completions .6309/.6270, Pass Attempts .6416/.6383, Pass + Rush Yds
  // .6881/.6890 (bell curve); Rush Attempts .6293/.6142; TD counts and
  // interceptions (Rush TDs .3032/.3022, Rec TDs .2463/.2428, Anytime TD
  // .4888/.4655, Pass TDs .5223/.5470, INTs .5818/.5467), sacks and tackles
  // (negative binomial, the rare ones pulled toward 50% a little).
  Completions: { dist: "normal", sdMult: 1.2, shrinkK: 5, useMinutes: false, sdShrinkK: 10 },
  "Pass Attempts": { dist: "normal", sdMult: 1.2, shrinkK: 5, useMinutes: false, sdShrinkK: 10 },
  "Pass + Rush Yds": { dist: "normal", sdMult: 1.2, shrinkK: 5, useMinutes: false, sdShrinkK: 10 },
  "Rush Attempts": { dist: "negbin", sdMult: 1, shrinkK: 5, useMinutes: false },
  "Pass TDs": { dist: "negbin", sdMult: 1, shrinkK: 20, useMinutes: false, temper: 0.9 },
  "Rush TDs": { dist: "negbin", sdMult: 1, shrinkK: 20, useMinutes: false, temper: 0.8 },
  "Rec TDs": { dist: "negbin", sdMult: 1, shrinkK: 20, useMinutes: false, temper: 0.85 },
  "Anytime TD": { dist: "negbin", sdMult: 1, shrinkK: 20, useMinutes: false, temper: 0.8 },
  "INTs Thrown": { dist: "negbin", sdMult: 1, shrinkK: 20, useMinutes: false, temper: 0.8 },
  "Kicking Points": { dist: "negbin", sdMult: 1, shrinkK: 20, useMinutes: false, temper: 0.9 },
  Sacks: { dist: "negbin", sdMult: 1, shrinkK: 20, useMinutes: false, temper: 0.9 },
  "Tackles + Assists": { dist: "negbin", sdMult: 1, shrinkK: 20, useMinutes: false },
  "Solo Tackles": { dist: "negbin", sdMult: 1, shrinkK: 20, useMinutes: false, temper: 0.9 },
};

/** A prop is only picked when the model's chance beats the price's implied chance by at least this much. */
export const MIN_PROP_EDGE = 0.03;

export const NFL_STDDEV_FLOOR_ABS: Record<string, number> = {
  "Pass Yds": 15,
  "Rush Yds": 8,
  "Rec Yds": 8,
  Receptions: 1,
  "Rush + Rec Yds": 10,
};
// Opponent-allowed adjustment is clamped to a modest range — a defense that
// has only faced a couple of real offenses this season shouldn't be able to
// swing a projection wildly on a small sample.
const OPPONENT_FACTOR_CLAMP: [number, number] = [0.8, 1.25];
const MIN_DEFENSE_GAMES_FOR_FACTOR = 2;
// Per stat, from a backtest on 2025-26 weekly stats (log loss on lines at
// the projection +/- 0.5 sd; lower is better): the defense's factor is pulled
// toward 1 by 4 games' worth (a defense with 4 games counts half), then
// clamped. Passing gains the most (.6409 with no adjustment -> .6266 old
// -> .6202); rushing yards do best with none (.6355 vs .6427 old); the
// receiving stats prefer a narrower range (Rec Yds .6373 -> .6346,
// Receptions .6072 -> .6051, Rush + Rec .6404 -> .6378).
const OPPONENT_SHRINK_GAMES = 4;
const OPPONENT_CLAMP_BY_STAT: Record<string, [number, number] | null> = {
  "Pass Yds": [0.8, 1.25],
  "Rush Yds": null,
  "Rec Yds": [0.9, 1.12],
  Receptions: [0.9, 1.12],
  "Rush + Rec Yds": [0.9, 1.12],
};

const STAT_FIELDS: { statType: string; field: keyof PlayerWeekStats }[] = [
  { statType: "Pass Yds", field: "passYds" },
  { statType: "Rush Yds", field: "rushYds" },
  { statType: "Rec Yds", field: "recYds" },
  { statType: "Receptions", field: "receptions" },
  { statType: "Rush + Rec Yds", field: "rushRecYds" },
  ...NFL_EXTRA_FIELDS,
];

export interface PlayerSeasonAverage {
  player: string;
  team: string;
  statType: string; // matches PropOutcome.statType
  // The model's current projection for this stat: a recency-weighted
  // average of the player's last few games (see RECENT_GAMES_WINDOW),
  // adjusted for the upcoming opponent's real defensive numbers this
  // season (see computeOpponentAllowedFactors below) — no longer a flat
  // season-to-date average.
  average: number;
  // This player's own game-to-game spread for this stat (sample std dev
  // over the same recency window, floored — see STDDEV_FLOOR_*) — what
  // winProbability below uses to turn `average` vs. the book's line into
  // an actual statistical win chance, instead of just comparing two numbers.
  stdDev: number;
  games: number;
  /** Full projection (distribution shape) and the stat's model settings. */
  proj?: Projection;
  /** Projected mean before the matchup/game-day/efficiency/streak multipliers. */
  baseMean?: number;
  cfg?: PropModelConfig;
  /** Every game's value, oldest first (for the trust score). */
  values?: number[];
  /** Snap-share trend (last 2 games vs last 8), when known. */
  snapTrend?: number;
  /** Back-from-injury adjustment applied to the projection, when any. */
  returnAdj?: { kind: "self" | "teammate"; who: string; factor: number };
  /** Wind trim applied to the projection (below 1), when any. */
  windFactor?: number;
  /** Efficiency regression (1.18.0): factor applied and the plain-English reason. */
  efficiency?: { factor: number; reason: string };
  /** Streak correction applied (only when 3%+). */
  streak?: number;
  /** A teammate star is out this week (lead back / top target / QB). */
  starOut?: { factor: number; reason: string };
}

/**
 * Wind (1.17.0): passing and receiving yards drop in strong wind. Backtest
 * on 2020-23 weekly stats (checked on 2024-25), outdoor games, nflverse's
 * game-time wind: trimming 1.5% per mph above 10 mph cut log loss on Pass
 * Yds .5701 -> .5654 and Rec Yds .5795 -> .5784 on 2024-25. Floor 70%.
 * Uses the stored pre-game forecast (lib/weather-forecast.ts) for upcoming games.
 */
export const WIND_TRIM_PER_MPH = 0.015;

/**
 * Level calibration (1.17.1): projections ran a little high across the
 * board, home and away alike. Backtest on 2020-23 weekly stats, checked on
 * 2024-25 (lines up to 1.5 sd either side): best factors and 2024-25 log
 * loss, Pass Yds x0.98 (.4934 -> .4929), Rec Yds x0.95 (.5254 -> .5237),
 * Rush Yds x0.95 (.5206 -> .5186), Rush + Rec x0.95 (.5267 -> .5253),
 * Receptions x0.96 (.4772 -> .4765). A lopsided (gamma or lognormal) curve
 * was tested instead and did worse.
 */
export const NFL_LEVEL: Record<string, number> = { "Pass Yds": 0.98, "Rec Yds": 0.95, "Rush Yds": 0.95, "Rush + Rec Yds": 0.95, Receptions: 0.96 };
/**
 * Efficiency regression (1.18.0). A player's yards come from volume times
 * efficiency, and efficiency (yards per carry, per target, catch rate,
 * yards after contact, the offense's yards per play) swings a lot from
 * season to season, so a player running hot on it tends to come back down
 * while his volume holds. Measured on nflverse weekly stats 2020-26 (train
 * 2020-23, test 2024-26), this season's rates vs the league, log loss at
 * lines around the projection:
 *   Rush Yds: (yards per carry)^-0.3 x (yards after contact per carry)^-0.1
 *             -0.6% both splits.
 *   Rec Yds:  (yards per target)^-0.3 x (catch rate)^-0.3, -0.9% both.
 *   Receptions: (catch rate)^-0.3, -0.3/-0.4%.
 *   Pass Yds: (team yards per play)^-0.2 x (yards per attempt)^-0.1, -0.4/-0.6%.
 * Yards after the catch added nothing on top of yards per target (+0.04% on
 * the older seasons), and opponent missed tackles / yards-after-contact
 * allowed added nothing beyond the opponent adjustment, so they're not used.
 */
/** Streak correction strength (lib/prop-dist.ts streakFactor), measured with the efficiency factors above: log loss -0.15 to -0.3% on top of them. Rush Yds showed none. */
export const NFL_STREAK_POW: Record<string, number> = { "Pass Yds": 0.2, "Rec Yds": 0.2, Receptions: 0.2 };

export const EFF_LEAGUE = { ypc: 4.3, ypt: 7.5, catchRate: 0.65, ypa: 6.8 };
const effX = (r: number) => Math.min(1.6, Math.max(0.6, r));
export function efficiencyFactor(
  statType: string,
  season: PlayerWeekStats[],
  teamYppRatio: number | undefined,
  ycoRatio: number | undefined
): { factor: number; reason: string } | undefined {
  const sum = (f: (r: PlayerWeekStats) => number | undefined) => season.reduce((a, r) => a + (f(r) ?? 0), 0);
  let f = 1;
  const why: string[] = [];
  const pct = (x: number) => `${x >= 1 ? "+" : ""}${Math.round((x - 1) * 100)}%`;
  if (statType === "Rush Yds") {
    const car = sum((r) => r.carries);
    if (car < 25) return undefined;
    const ypc = sum((r) => r.rushYds) / car / EFF_LEAGUE.ypc;
    f *= effX(ypc) ** -0.3;
    why.push(`${(ypc * EFF_LEAGUE.ypc).toFixed(1)} yards per carry (${pct(ypc)} vs league)`);
    if (ycoRatio !== undefined) {
      f *= effX(ycoRatio) ** -0.1;
      why.push(`yards after contact ${pct(ycoRatio)} vs league`);
    }
  } else if (statType === "Rec Yds" || statType === "Receptions") {
    const tgt = sum((r) => r.targets);
    const rec = sum((r) => r.receptions);
    if (rec < 10 || tgt <= 0) return undefined;
    const cr = rec / tgt / EFF_LEAGUE.catchRate;
    f *= effX(cr) ** -0.3;
    if (statType === "Rec Yds") {
      const ypt = sum((r) => r.recYds) / tgt / EFF_LEAGUE.ypt;
      f *= effX(ypt) ** -0.3;
      why.push(`${(ypt * EFF_LEAGUE.ypt).toFixed(1)} yards per target (${pct(ypt)} vs league)`);
    }
    why.push(`catch rate ${Math.round(cr * EFF_LEAGUE.catchRate * 100)}%`);
  } else if (statType === "Pass Yds") {
    const att = sum((r) => r.attempts);
    if (att < 60) return undefined;
    const ypa = sum((r) => r.passYds) / att / EFF_LEAGUE.ypa;
    f *= effX(ypa) ** -0.1;
    why.push(`${(ypa * EFF_LEAGUE.ypa).toFixed(1)} yards per attempt`);
    if (teamYppRatio !== undefined) {
      f *= effX(teamYppRatio) ** -0.2;
      why.push(`offense ${pct(teamYppRatio)} yards per play vs league`);
    }
  } else return undefined;
  f = Math.min(1.15, Math.max(0.85, f));
  if (Math.abs(f - 1) < 0.02) return undefined;
  return {
    factor: f,
    reason: `${f < 1 ? "Running hot" : "Running cold"} on efficiency (${why.join(", ")}): projection ${f < 1 ? "trimmed" : "raised"} ${Math.round(Math.abs(1 - f) * 100)}% since these rates tend to even out`,
  };
}

/**
 * Stars out (1.21.0). When a team's lead back (40%+ of carries), top target
 * (20%+ of targets) or starting QB (70%+ of attempts) over its last 4 games
 * (playing 3+ of them) is listed Out, his teammates' roles change. Measured
 * on nflverse weekly stats 2020-26 (train 2020-23, test 2024-26), lines
 * around the projection:
 *   lead back out:  other backs' rush yards x1.5 (log loss -6 to -13%),
 *                   catches x1.3-1.5 (-10 to -14%), rec yards x1.3-1.4
 *   top target out: depth receivers' catches x1.2-1.3 (-4 to -5%), rec
 *                   yards x1.15-1.2; regular receivers' catches x1.05-1.15;
 *                   the QB's pass yards x0.9 (-5% both splits)
 *   QB out:         backs' receiving yards x0.85 (-3 to -5%)
 * Values below are a little under the measured ones.
 */
export const NFL_STAR_OUT = {
  RUSH: { RB: { "Rush Yds": 1.45, Receptions: 1.3, "Rec Yds": 1.25, "Rush + Rec Yds": 1.35 } },
  TGT: {
    depth: { Receptions: 1.18, "Rec Yds": 1.12, "Rush + Rec Yds": 1.1 },
    main: { Receptions: 1.08, "Rec Yds": 1.0, "Rush + Rec Yds": 1.0 },
    QB: { "Pass Yds": 0.92 },
  },
  QB: { RB: { "Rec Yds": 0.88, Receptions: 0.93 }, REC: { "Rec Yds": 0.95 } },
} as const;

/** Who's out this week among each team's lead back / top target / starting QB, and each teammate's role. */
export function nflStarsOut(rows: PlayerWeekStats[], out: Set<string>): Map<string, { factorFor: (stat: string) => number; reason: string }> {
  const key = (team: string, name: string) => `${team}|${name.toLowerCase().replace(/[^a-z]/g, "")}`;
  const res = new Map<string, { factorFor: (stat: string) => number; reason: string }>();
  if (out.size === 0) return res;
  const byTeam = new Map<string, PlayerWeekStats[]>();
  for (const r of rows) (byTeam.get(r.team) ?? byTeam.set(r.team, []).get(r.team)!).push(r);
  for (const [team, l] of byTeam) {
    const weeks = [...new Set(l.map((r) => r.week))].sort((a, b) => a - b).slice(-4);
    if (weeks.length < 4) continue;
    const recent = l.filter((r) => weeks.includes(r.week));
    const tot = { tgt: 0, car: 0, att: 0 };
    const pl = new Map<string, { tgt: number; car: number; att: number; n: number; pos: string }>();
    for (const r of recent) {
      const e = pl.get(r.player) ?? { tgt: 0, car: 0, att: 0, n: 0, pos: r.position };
      e.tgt += r.targets ?? 0;
      e.car += r.carries ?? 0;
      e.att += r.attempts ?? 0;
      e.n++;
      pl.set(r.player, e);
      tot.tgt += r.targets ?? 0;
      tot.car += r.carries ?? 0;
      tot.att += r.attempts ?? 0;
    }
    const top = (f: (e: { tgt: number; car: number; att: number }) => number) => [...pl].filter(([, e]) => e.n >= 3).sort((a, b) => f(b[1]) - f(a[1]))[0];
    const isOut = (p: [string, unknown] | undefined) => !!p && out.has(key(team, p[0]));
    const t = top((e) => e.tgt);
    const c = top((e) => e.car);
    const q = top((e) => e.att);
    const tgtOut = t && tot.tgt > 0 && t[1].tgt / tot.tgt >= 0.2 && isOut(t) ? t[0] : null;
    const rushOut = c && tot.car > 0 && c[1].car / tot.car >= 0.4 && isOut(c) ? c[0] : null;
    const qbOut = q && tot.att > 0 && q[1].att / tot.att >= 0.7 && isOut(q) ? q[0] : null;
    if (!tgtOut && !rushOut && !qbOut) continue;
    for (const [player, e] of pl) {
      if ([tgtOut, rushOut, qbOut].includes(player) || out.has(key(team, player))) continue;
      const rec = e.pos === "WR" || e.pos === "TE";
      const parts: Record<string, number>[] = [];
      const why: string[] = [];
      if (rushOut && e.pos === "RB") {
        parts.push(NFL_STAR_OUT.RUSH.RB);
        why.push(`${rushOut} (lead back) is out`);
      }
      if (tgtOut && rec) {
        parts.push(tot.tgt > 0 && e.tgt / tot.tgt >= 0.12 ? NFL_STAR_OUT.TGT.main : NFL_STAR_OUT.TGT.depth);
        why.push(`${tgtOut} (top target) is out`);
      }
      if (tgtOut && e.pos === "QB") {
        parts.push(NFL_STAR_OUT.TGT.QB);
        why.push(`his top target ${tgtOut} is out`);
      }
      if (qbOut && (e.pos === "RB" || rec)) {
        parts.push(e.pos === "RB" ? NFL_STAR_OUT.QB.RB : NFL_STAR_OUT.QB.REC);
        why.push(`starting QB ${qbOut} is out`);
      }
      if (!parts.length) continue;
      const factorFor = (stat: string) => Math.min(1.6, Math.max(0.75, parts.reduce((a, m) => a * ((m as Record<string, number>)[stat] ?? 1), 1)));
      res.set(player, { factorFor, reason: why.join("; ") });
    }
  }
  return res;
}

/** Each team's yards per play this season vs the league (QB passing + all rushing over attempts, sacks and carries). */
export function teamYardsPerPlay(rows: PlayerWeekStats[]): Map<string, number> {
  const t = new Map<string, { y: number; p: number }>();
  let Y = 0;
  let P = 0;
  for (const r of rows) {
    const y = (r.position === "QB" ? r.passYds : 0) + r.rushYds;
    const p = (r.attempts ?? 0) + (r.position === "QB" ? r.sacksTaken : 0) + (r.carries ?? 0);
    const e = t.get(r.team) ?? { y: 0, p: 0 };
    e.y += y;
    e.p += p;
    t.set(r.team, e);
    Y += y;
    P += p;
  }
  const lg = P > 0 ? Y / P : 0;
  const out = new Map<string, number>();
  for (const [k, e] of t) if (e.p >= 150 && lg > 0) out.set(k, e.y / e.p / lg);
  return out;
}

export function windFactor(statType: string, windMph: number | undefined): number {
  if (!windMph || (statType !== "Pass Yds" && statType !== "Rec Yds")) return 1;
  return Math.max(0.7, 1 - WIND_TRIM_PER_MPH * Math.max(0, windMph - 10));
}

/** A key player expected back this week after missing games while listed Out. */
export interface Returner {
  player: string;
  team: string;
  position: string;
  missed: number;
}

/**
 * Back from injury (1.14.0). Backtest on 2020-23 weekly stats (chosen) and
 * checked on 2024-25, log loss at lines around the projection:
 *  - the player himself, first game back after missing 1+ games: Pass Yds
 *    x0.85 (.6313 -> .5797 on 2024-25), Rec Yds x0.88 (.5969 -> .552),
 *    Receptions x0.9 (.5594 -> .5302), Rush Yds x0.9 (.5688 -> .5486).
 *  - a teammate at the same position (WR/TE together) when a key player
 *    returns: his recent games came with a bigger role that's going away.
 *    Rec Yds x0.8 (.5485 -> .5192), Rush Yds x0.8 (.5677 -> .4954),
 *    Receptions x0.9 (train .5398 -> .5168; flat on 2024-25).
 * "Key": 8+ targets + carries a game (QBs: 25+ attempts) before the injury.
 */
export const RETURN_SELF: Record<string, number> = { "Pass Yds": 0.85, "Rush Yds": 0.9, "Rec Yds": 0.88, Receptions: 0.9, "Rush + Rec Yds": 0.89 };
// Teammate trims are measured on games the returner played; on 2025 reports
// 22 of 29 flagged returners did, so the trim is scaled by that ~75%.
const RETURN_PLAY_PROB = 0.75;
const RETURN_TEAMMATE_IF_PLAYS: Record<string, number> = { "Pass Yds": 0.9, "Rush Yds": 0.8, "Rec Yds": 0.8, Receptions: 0.9, "Rush + Rec Yds": 0.8 };
export const RETURN_TEAMMATE: Record<string, number> = Object.fromEntries(
  Object.entries(RETURN_TEAMMATE_IF_PLAYS).map(([k, f]) => [k, +(1 - RETURN_PLAY_PROB * (1 - f)).toFixed(3)])
);
const posGroup = (p: string) => (p === "WR" || p === "TE" ? "REC" : p);
const nameKey = (n: string) => n.toLowerCase().replace(/[^a-z]/g, "").replace(/(jr|sr|ii|iii|iv)$/, "");

/**
 * Key players coming back this week: they missed their team's last game(s)
 * while listed Out (or Doubtful), and this week's practice report lists them
 * without an Out or Doubtful tag.
 */
export function findReturners(
  rows: PlayerWeekStats[],
  injuries: { week: number; team: string; player: string; status: string }[],
  upcomingWeek: number
): Returner[] {
  const teamWeeks = new Map<string, Set<number>>();
  for (const r of rows) (teamWeeks.get(r.team) ?? teamWeeks.set(r.team, new Set()).get(r.team)!).add(r.week);
  const reportTeams = new Set(injuries.filter((i) => i.week === upcomingWeek).map((i) => i.team));
  const statusBy = new Map<string, Map<number, string>>();
  for (const i of injuries) {
    const k = `${i.team}|${nameKey(i.player)}`;
    (statusBy.get(k) ?? statusBy.set(k, new Map()).get(k)!).set(i.week, i.status);
  }
  const byPlayer = new Map<string, PlayerWeekStats[]>();
  for (const r of rows) (byPlayer.get(r.player) ?? byPlayer.set(r.player, []).get(r.player)!).push(r);
  const out: Returner[] = [];
  for (const [player, list] of byPlayer) {
    list.sort((a, b) => a.week - b.week);
    if (list.length < 3) continue;
    const last = list[list.length - 1];
    const team = last.team;
    if (!reportTeams.has(team)) continue; // this week's report isn't out yet
    const missedWeeks = [...(teamWeeks.get(team) ?? [])].filter((w) => w > last.week && w < upcomingWeek);
    if (missedWeeks.length === 0) continue;
    const use =
      list.reduce((a, r) => a + (r.targets ?? 0) + (r.carries ?? 0), 0) / list.length;
    const isQb = last.position === "QB";
    if (isQb ? !list.some((r) => r.passYds > 150) : use < 8) continue;
    const st = statusBy.get(`${team}|${nameKey(player)}`);
    if (!st) continue;
    const wasOut = missedWeeks.some((w) => /^(Out|Doubtful)$/i.test(st.get(w) ?? ""));
    // He must be on this week's report (practicing) and not Out/Doubtful:
    // players on injured reserve drop off the weekly report entirely.
    const now = st.get(upcomingWeek);
    if (now === undefined) continue;
    const nowOut = /^(Out|Doubtful)$/i.test(now);
    if (wasOut && !nowOut) out.push({ player, team, position: last.position, missed: missedWeeks.length });
  }
  return out;
}

/**
 * Real opponent-allowed adjustment: for each team, how much more or less of
 * each stat its opponents have actually put up against it this season,
 * relative to the league average — derived purely from already-synced
 * nflverse weekly stats cross-referenced with the schedule (never a
 * fabricated or guessed number). A defense that's allowed 15% more rushing
 * yards per game than the league average gets a 1.15x factor on a running
 * back's projection against them; one that's stingy gets a factor below 1.
 */
function computeOpponentAllowedFactors(
  rows: PlayerWeekStats[],
  schedule: ScheduleGame[]
): Map<string, Map<string, number>> {
  const opponentByTeamWeek = new Map<string, string>(); // `${team}|${week}` -> opponent
  for (const g of schedule) {
    opponentByTeamWeek.set(`${g.homeTeam}|${g.week}`, g.awayTeam);
    opponentByTeamWeek.set(`${g.awayTeam}|${g.week}`, g.homeTeam);
  }

  // allowedByDefense[defTeam].get(statType) accumulates what that defense
  // has given up; leagueTotals is the same thing summed across every team,
  // for the league-average denominator.
  const allowedByDefense = new Map<string, Map<string, { sum: number; weeks: Set<number> }>>();
  const leagueTotals = new Map<string, { sum: number; defenseWeeks: Set<string> }>();

  for (const row of rows) {
    const opponent = opponentByTeamWeek.get(`${row.team}|${row.week}`);
    if (!opponent) continue;
    for (const { statType, field } of STAT_FIELDS) {
      const value = Number(row[field]) || 0;
      if (value <= 0) continue;

      const defMap = allowedByDefense.get(opponent) ?? new Map();
      const entry = defMap.get(statType) ?? { sum: 0, weeks: new Set<number>() };
      entry.sum += value;
      entry.weeks.add(row.week);
      defMap.set(statType, entry);
      allowedByDefense.set(opponent, defMap);

      const lt = leagueTotals.get(statType) ?? { sum: 0, defenseWeeks: new Set<string>() };
      lt.sum += value;
      lt.defenseWeeks.add(`${opponent}|${row.week}`);
      leagueTotals.set(statType, lt);
    }
  }

  const leagueAvgPerGame = new Map<string, number>();
  for (const [statType, { sum, defenseWeeks }] of leagueTotals) {
    if (defenseWeeks.size > 0) leagueAvgPerGame.set(statType, sum / defenseWeeks.size);
  }

  const factors = new Map<string, Map<string, number>>();
  for (const [team, defMap] of allowedByDefense) {
    const teamFactors = new Map<string, number>();
    for (const [statType, { sum, weeks }] of defMap) {
      if (weeks.size < MIN_DEFENSE_GAMES_FOR_FACTOR) continue;
      const leagueAvg = leagueAvgPerGame.get(statType);
      if (!leagueAvg) continue;
      const raw = sum / weeks.size / leagueAvg;
      const clamp = statType in OPPONENT_CLAMP_BY_STAT ? OPPONENT_CLAMP_BY_STAT[statType] : OPPONENT_FACTOR_CLAMP;
      if (!clamp) continue; // no adjustment for this stat
      const shrunk = 1 + ((raw - 1) * weeks.size) / (weeks.size + OPPONENT_SHRINK_GAMES);
      teamFactors.set(statType, Math.min(clamp[1], Math.max(clamp[0], shrunk)));
    }
    factors.set(team, teamFactors);
  }
  return factors;
}

/**
 * Each player/stat combo's current projection and spread — a recency-
 * weighted average of their last RECENT_GAMES_WINDOW games (most recent
 * weighted heaviest), adjusted for the opponent they're about to face (see
 * computeOpponentAllowedFactors), plus the real std dev of their own recent
 * games for winProbability below to use. `team` is whichever team their
 * most recent game row has them on (handles a mid-season trade/signing).
 */
export function computeSeasonAverages(
  rows: PlayerWeekStats[],
  schedule: ScheduleGame[],
  upcomingWeek: number,
  /**
   * Last season's weekly rows. They feed each player's projection (the
   * 20-game long window) but never the opponent adjustments. Backtest on
   * 2025-26 games 4-8 of a season: with only this season's games, 70%+
   * Rec Yds picks said 75% and hit 66%; with last season added they said
   * 73% and hit 73% (Receptions 79% -> 73% vs 79% -> 76%; Pass Yds
   * 76% -> 62% vs 72% -> 74%).
   */
  prior: PlayerWeekStats[] = [],
  /** Snap-share trend by player (snapTrends); missing = no adjustment. */
  snapTrend: Map<string, number> = new Map(),
  /** Key players back from injury this week (findReturners). */
  returners: Returner[] = [],
  /** Forecast wind (mph) at each team's game this week, outdoor stadiums only. */
  windByTeam: Map<string, number> = new Map(),
  /** Yards after contact this season (fetchRushAfterContact); empty = skip that part. */
  rushAfterContact: Map<string, { carries: number; yco: number }> = new Map(),
  /** Players listed Out this week ("team|name", name as lowercase letters only). */
  outThisWeek: Set<string> = new Set()
): Map<string, PlayerSeasonAverage> {
  const starsOut = nflStarsOut(rows, outThisWeek);
  const ypp = teamYardsPerPlay(rows);
  let ycoC = 0;
  let ycoY = 0;
  for (const v of rushAfterContact.values()) {
    ycoC += v.carries;
    ycoY += v.yco;
  }
  const ycoLg = ycoC > 0 ? ycoY / ycoC : 0;
  const seasonRows = new Map<string, PlayerWeekStats[]>();
  for (const r of rows) (seasonRows.get(r.player) ?? seasonRows.set(r.player, []).get(r.player)!).push(r);
  const returningSelf = new Map(returners.map((r) => [r.player, r]));
  const posOf = new Map<string, string>();
  for (const r of rows) posOf.set(r.player, r.position);
  const byKey = new Map<string, { team: string; week: number; value: number }[]>();
  const currentGames = new Map<string, number>();
  for (const row of rows) currentGames.set(row.player, (currentGames.get(row.player) ?? 0) + 1);
  // Last season's games sort before this season's (week - 100); only for
  // players who've played this season.
  const priorRows = prior.filter((r) => currentGames.has(r.player)).map((r) => ({ ...r, week: r.week - 100 }));
  for (const row of [...priorRows, ...rows]) {
    for (const { statType, field } of STAT_FIELDS) {
      const value = Number(row[field]) || 0;
      // Zero games count: a receiver held without a catch is a real
      // outcome. (Leaving them out pushed projections up; the calibration
      // check in lib/prop-calibration.ts showed it.) Rows only exist for
      // games the player played, so byes never appear here. A player who
      // never records the stat (a QB's receiving yards) gets no line anyway.
      if (value < 0) continue;
      const key = `${row.player}|${statType}`;
      const list = byKey.get(key) ?? [];
      list.push({ team: row.team, week: row.week, value });
      byKey.set(key, list);
    }
  }

  const opponentFactors = computeOpponentAllowedFactors(rows, schedule);
  // Which team each team actually plays in `upcomingWeek`, so the right
  // defense's allowed-factor gets applied to each player's projection.
  const opponentThisWeek = new Map<string, string>();
  for (const g of schedule) {
    if (g.week !== upcomingWeek) continue;
    opponentThisWeek.set(g.homeTeam, g.awayTeam);
    opponentThisWeek.set(g.awayTeam, g.homeTeam);
  }

  const out = new Map<string, PlayerSeasonAverage>();
  for (const [key, list] of byKey) {
    const [player, statType] = key.split("|");
    const sorted = [...list].sort((a, b) => b.week - a.week);
    const cfg = NFL_PROP_MODEL[statType] ?? { dist: "normal", sdMult: NFL_SD_MULT[statType] ?? 1.3, shrinkK: 5, useMinutes: false };
    const proj = projectProp(
      [...sorted].reverse().map((g) => g.value),
      cfg,
      NFL_STDDEV_FLOOR_ABS[statType] ?? 5
    );
    if (!proj) continue;
    const n = Math.min(sorted.length, RECENT_GAMES_WINDOW);
    const stdDev = proj.sd;

    const team = sorted[0].team;
    const opponent = opponentThisWeek.get(team);
    const oppFactor = opponent ? (opponentFactors.get(opponent)?.get(statType) ?? 1) : 1;
    const trend = snapTrend.get(snapKey(player)) ?? 1;
    let returnAdj: PlayerSeasonAverage["returnAdj"];
    const self = returningSelf.get(player);
    if (self && RETURN_SELF[statType]) returnAdj = { kind: "self", who: player, factor: RETURN_SELF[statType] };
    else if (RETURN_TEAMMATE[statType]) {
      const g = posGroup(posOf.get(player) ?? "");
      const mate = returners.find((r) => r.team === team && r.player !== player && posGroup(r.position) === g);
      if (mate) returnAdj = { kind: "teammate", who: mate.player, factor: RETURN_TEAMMATE[statType] };
    }
    const wind = windFactor(statType, windByTeam.get(team));
    const yco = rushAfterContact.get(`${snapKey(player)}|${team}`);
    const eff = efficiencyFactor(statType, (seasonRows.get(player) ?? []).filter((r) => r.team === team), ypp.get(team), yco && yco.carries >= 25 && ycoLg > 0 ? yco.yco / yco.carries / ycoLg : undefined);
    const streak = streakFactor([...sorted].reverse().map((g) => g.value), NFL_STREAK_POW[statType]);
    const so = starsOut.get(player);
    const soF = so ? so.factorFor(statType) : 1;
    const projection = proj.mean * oppFactor * Math.pow(trend, SNAP_TREND_POWER) * (returnAdj?.factor ?? 1) * wind * (NFL_LEVEL[statType] ?? 1) * (eff?.factor ?? 1) * streak * soF;

    out.set(key, {
      player,
      team,
      statType,
      average: projection,
      stdDev,
      // This season's games (the 3-game minimum is on these).
      games: Math.min(currentGames.get(player) ?? 0, RECENT_GAMES_WINDOW),
      proj: { ...proj, mean: projection },
      baseMean: proj.mean,
      cfg,
      values: [...sorted].reverse().map((g) => g.value),
      snapTrend: snapTrend.get(snapKey(player)),
      returnAdj,
      windFactor: wind < 1 ? wind : undefined,
      efficiency: eff,
      streak: Math.abs(streak - 1) >= 0.03 ? streak : undefined,
      starOut: so && Math.abs(soF - 1) >= 0.02 ? { factor: soF, reason: so.reason } : undefined,
    });
  }
  return out;
}

const snapKey = (name: string) => name.toLowerCase().replace(/[^a-z]/g, "");

/**
 * Snap-share trend: each player's offensive snap share over his last 2
 * games vs his last 8 (this season, 3+ games), clamped to 0.5-1.6. A rising
 * share means a growing role (a coaching decision, or a teammate hurt) that
 * the stat average hasn't caught up with yet.
 */
export function snapTrends(snaps: SnapRow[]): Map<string, number> {
  const by = new Map<string, SnapRow[]>();
  for (const r of snaps) {
    const k = snapKey(r.player);
    const l = by.get(k) ?? [];
    l.push(r);
    by.set(k, l);
  }
  const out = new Map<string, number>();
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  for (const [k, l] of by) {
    if (l.length < 3) continue;
    l.sort((a, b) => a.week - b.week);
    const pct = l.map((r) => r.offensePct);
    const long = avg(pct.slice(-8));
    if (long <= 0) continue;
    out.set(k, Math.min(1.6, Math.max(0.5, avg(pct.slice(-2)) / long)));
  }
  return out;
}

/**
 * How much the snap trend moves a projection: projection x trend^0.25.
 * Backtest (2023-24 to choose, 2025-26 to check; log loss, lower is better):
 * Pass Yds .6409 -> .6395, Rush Yds .6355 -> .6339, Rec Yds .6353 -> .6348,
 * Receptions .6069 -> .6060, Rush + Rec .6384 -> .6372. Recent targets/
 * carries trends and team pass-rate trends were also tested and didn't help.
 */
export const SNAP_TREND_POWER = 0.25;

/** Standard normal CDF via the Abramowitz-Stegun approximation (max error ~1.5e-7) — no library dependency for one well-known formula. */
function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const a1 = 0.254829592,
    a2 = -0.284496736,
    a3 = 1.421413741,
    a4 = -1.453152027,
    a5 = 1.061405429,
    p = 0.3275911;
  const t = 1 / (1 + p * x);
  const erf = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

/**
 * The model's actual statistical win chance for a side of a line — not the
 * sportsbook's implied odds from the price (that's americanToImpliedProb
 * below, a different thing: what the BOOK thinks), but P(the player's real
 * result lands on this side), treating their recent games as roughly normal
 * around `mean` with spread `stdDev`. This is what every 70%-confidence
 * filter in this app (Props, Parlays, Dashboard) actually filters on.
 */
export function winProbability(mean: number, stdDev: number, line: number, side: "Over" | "Under"): number {
  if (stdDev <= 0) {
    if (side === "Over") return mean > line ? 1 : 0;
    return mean < line ? 1 : 0;
  }
  const pUnderOrEqual = normalCdf((line - mean) / stdDev);
  return side === "Over" ? 1 - pUnderOrEqual : pUnderOrEqual;
}

// Pick'em / DFS apps: their "prices" are entry multipliers or flat +100
// placeholders, not odds a single prop can be bet at (PrizePicks and
// DraftKings Pick6 list every line at +100 / +100). They made 70% picks
// look like 20-38 point edges, so they're never a pick's price and never
// part of the market consensus.
export const PICKEM_BOOKS = new Set([
  "PrizePicks",
  "DraftKings Pick6",
  "Underdog Fantasy",
  "Sleeper",
  "Dabble",
  "ParlayPlay",
  "Betr Picks",
  "Chalkboard",
  "Boom Fantasy",
  "OwnersBox",
]);

/** A book line that can't be used as a real price: pick'em apps, or both sides at even money. */
export function isPlaceholderLine(book: string, overPrice?: number, underPrice?: number): boolean {
  if (PICKEM_BOOKS.has(book) || book.startsWith("Seasonz model")) return true;
  return overPrice !== undefined && underPrice !== undefined && Math.abs(overPrice) === 100 && Math.abs(underPrice) === 100;
}

/**
 * The market's no-vig chance of the Over, per player|stat|line: the average
 * across real books that post both sides. What the trust score's "far from
 * the market" check compares against (one book's price, especially an alt
 * line or a pick'em app, isn't the market).
 */
/**
 * How much each book counts in the market's no-vig chance (1.19.0). On the
 * first graded week of the line archive (NBA and NHL props, the same props
 * compared book vs the rest of the board), prediction markets and exchanges
 * beat the board: Kalshi log loss .553 vs .593 (NBA) and .469 vs .483 (NHL),
 * Polymarket .529 vs .538, Novig .555 vs .561 (NHL); Pinnacle matched it.
 * Weighting them 3x / 2x cut the market's log loss 0.3-0.5% in both leagues
 * on both halves of the week. Everyone else counts once.
 */
export const BOOK_WEIGHT: Record<string, number> = { Kalshi: 3, Polymarket: 3, "Polymarket US": 3, Novig: 2, ProphetX: 2, Pinnacle: 2 };
export const bookWeight = (book: string) => BOOK_WEIGHT[book] ?? 1;

export function marketOverChances(
  groups: Iterable<{ player: string; statType: string; book: string; line: number; overPrice?: number; underPrice?: number }>
): Map<string, number> {
  const acc = new Map<string, { s: number; n: number }>();
  for (const g of groups) {
    if (g.overPrice === undefined || g.underPrice === undefined || isPlaceholderLine(g.book, g.overPrice, g.underPrice)) continue;
    const o = americanToImpliedProb(g.overPrice);
    const u = americanToImpliedProb(g.underPrice);
    if (o + u < 0.98 || o + u > 1.3) continue; // stale or one-sided board
    const k = `${g.player}|${g.statType}|${g.line}`;
    const a = acc.get(k) ?? { s: 0, n: 0 };
    const w = bookWeight(g.book);
    a.s += w * (o / (o + u));
    a.n += w;
    acc.set(k, a);
  }
  return new Map([...acc].map(([k, a]) => [k, a.s / a.n]));
}

/**
 * Starting model share for props: the model and the market count equally
 * (in log-odds). After the early-season fix, NFL 70%+ picks still sat ~23
 * points above the market's no-vig chance on average, and gaps that size
 * are mostly the model missing news. Every listed pick is logged
 * (prop_pick_log) and graded; once a sport has 300+ graded picks the share
 * is re-fit on them daily (lib/model-weights.ts).
 */
export const PROP_MODEL_WEIGHT_DEFAULT = 0.25;

/**
 * Model share per sport (1.13.0). The first 271 graded live picks (145
 * separate player-games once alternate lines of the same prop are counted
 * once) said the 50% share was far too high: picks rated 84% on average hit
 * 72%, because when the model and the books disagree by a lot, the books
 * usually know something (a role change, an injury) the box scores don't.
 * Best shares on that data: NFL ~0.25-0.3, NHL ~0.35, MLB ~0.1, college
 * football 0. Defaults below; lib/model-weights.ts keeps re-fitting them.
 */
export const PROP_MODEL_WEIGHT: Record<string, number> = {
  nfl: 0.25,
  nhl: 0.3,
  mlb: 0.15,
  ncaaf: 0.15,
  nba: 0.25,
  wnba: 0.25,
  ncaab: 0.2,
};
export const propModelWeightDefault = (sport: string) => PROP_MODEL_WEIGHT[sport] ?? PROP_MODEL_WEIGHT_DEFAULT;

/** Market's Over chance from a single posted price (no opposite side), less a typical 4.5% margin. */
export function oneSidedMarket(overPrice?: number, underPrice?: number): number | undefined {
  const c = (p: number) => Math.min(0.97, Math.max(0.03, p));
  if (overPrice !== undefined) return c(americanToImpliedProb(overPrice) / 1.045);
  if (underPrice !== undefined) return c(1 - americanToImpliedProb(underPrice) / 1.045);
  return undefined;
}

export function blendPropChance(model: number, market: number, modelWeight: number): number {
  const c = (p: number) => Math.min(0.995, Math.max(0.005, p));
  const lg = (p: number) => Math.log(c(p) / (1 - c(p)));
  return 1 / (1 + Math.exp(-(modelWeight * lg(model) + (1 - modelWeight) * lg(market))));
}

export interface PropPick {
  player: string;
  team: string;
  statType: string;
  line: number;
  side: "Over" | "Under";
  book: string;
  priceAmerican: number;
  projection: number;
  edgePct: number; // signed: (projection - line) / line — informational; see modelWinPct for what's actually filtered on
  // The model's real statistical win chance for `side` (see winProbability)
  // — this, not edgePct, is what every "70%+" filter in the app checks.
  modelWinPct: number;
  opponent: string | null;
  gameDate: string | null; // this player's team's game date for the upcoming week (YYYY-MM-DD), for "Parlay for Today"
  trust?: Trust;
  /** The model's own chance (before the market blend) and the market's no-vig chance for the side. */
  modelOnly?: number;
  /** Model-only chance with no adjustments (side-oriented). */
  modelBase?: number;
  market?: number | null;
}

/**
 * Compares this week's posted prop lines against the model's real
 * projection (recency-weighted, opponent-adjusted — see
 * computeSeasonAverages) and keeps only picks where the model's own
 * statistical win chance clears MIN_MODEL_WIN_PCT. A player marked OUT or
 * DOUBTFUL for this game (per `unavailable`) is dropped entirely — their
 * past stats say nothing about a game they're not playing in.
 */
export function buildPropPicks(
  props: PropOutcome[],
  averages: Map<string, PlayerSeasonAverage>,
  schedule: ScheduleGame[],
  upcomingWeek: number,
  unavailable: Set<string> = new Set(),
  /** Model share of the model/market blend (lib/model-weights.ts, "prop:nfl"), or one per stat. */
  modelWeight: number | ((statType: string) => number) = PROP_MODEL_WEIGHT_DEFAULT,
  /** Live trust correction (log-odds, lib/model-weights.ts "trust:nfl"). */
  trustShift = 0,
  /** Learned market bias and line-move continuation (lib/market-learn.ts). */
  marketLearn?: MarketLearn,
  /** Learned strength of the projection adjustments (1 = as coded). */
  adjStrength = 1
): PropPick[] {
  const weightOf = (stat: string) => (typeof modelWeight === "function" ? modelWeight(stat) : modelWeight);
  const opponentThisWeek = new Map<string, { opponent: string; gameDate: string | null }>();
  for (const g of schedule) {
    if (g.week !== upcomingWeek) continue;
    if (g.homeTeam) opponentThisWeek.set(g.homeTeam, { opponent: g.awayTeam, gameDate: g.gameDate });
    if (g.awayTeam) opponentThisWeek.set(g.awayTeam, { opponent: g.homeTeam, gameDate: g.gameDate });
  }

  // Pair up each market's Over/Under rows (same player+stat+book+line) so we
  // can read off whichever side's price we actually want.
  const grouped = new Map<
    string,
    { player: string; statType: string; book: string; line: number; overPrice?: number; underPrice?: number }
  >();
  for (const p of props) {
    const key = `${p.player}|${p.statType}|${p.book}|${p.line}`;
    const g = grouped.get(key) ?? { player: p.player, statType: p.statType, book: p.book, line: p.line };
    // "Yes" (e.g. anytime goal / home run) is the Over 0.5, "No" the Under.
    // Treating "Yes" as the Under listed +1000 longshots as 85% Unders.
    if (p.side === "Over" || p.side === "Yes") g.overPrice = p.priceAmerican;
    else if (p.side === "Under" || p.side === "No") g.underPrice = p.priceAmerican;
    grouped.set(key, g);
  }

  const market = adjustMarketMap(marketOverChances(grouped.values()), marketLearn);
  const picks: PropPick[] = [];
  for (const g of grouped.values()) {
    if (isPlaceholderLine(g.book, g.overPrice, g.underPrice)) continue;
    // Can't be graded from box scores (scoring order, NFL longest play): shown on Props, never picked.
    if (NFL_DISPLAY_ONLY_STATS.has(g.statType)) continue;
    const avg = averages.get(`${g.player}|${g.statType}`);
    if (!avg || avg.games < MIN_GAMES_FOR_PROJECTION) continue;
    if (g.line <= 0) continue;
    if (unavailable.has(`${avg.team}|${g.player}`)) continue;

    const projection = avg.average;
    const edgePct = (projection - g.line) / g.line;
    // With a count distribution the likelier side isn't always the side the
    // average is on (skew), so take whichever side the model rates higher.
    const pOverAdj =
      avg.proj && avg.cfg ? propChance(avg.proj, g.line, avg.cfg, "Over") : winProbability(avg.average, avg.stdDev, g.line, "Over");
    const pOverBase = avg.proj && avg.cfg && avg.baseMean !== undefined ? propChance({ ...avg.proj, mean: avg.baseMean }, g.line, avg.cfg, "Over") : pOverAdj;
    // How hard to lean on the adjustments: learned from graded picks (lib/model-weights.ts "adj:<sport>").
    const pOverModel = scaleAdjustments(pOverBase, pOverAdj, adjStrength);
    // The final chance blends the model with the market's no-vig chance for
    // this line (see blendPropChance); no market, model alone.
    // No book posts both sides of this line (often an alt line): estimate
    // the market from this book's one price, less a typical 4.5% margin.
    const mk = market.get(`${g.player}|${g.statType}|${g.line}`) ?? oneSidedChance(g.overPrice, g.underPrice, marketLearn?.oneSided);
    const pOver = mk === undefined ? pOverModel : blendPropChance(pOverModel, mk, weightOf(g.statType));
    const side: "Over" | "Under" = pOver >= 0.5 ? "Over" : "Under";
    const modelWinPct = side === "Over" ? pOver : 1 - pOver;
    const modelOnly = side === "Over" ? pOverModel : 1 - pOverModel;
    const modelBase = side === "Over" ? pOverBase : 1 - pOverBase;
    if (modelWinPct < MIN_MODEL_WIN_PCT) continue;

    const price = side === "Over" ? g.overPrice : g.underPrice;
    if (price == null) continue;
    // Only a pick when it beats the price (see MIN_PROP_EDGE).
    if (modelWinPct - americanToImpliedProb(price) < MIN_PROP_EDGE) continue;

    const matchup = opponentThisWeek.get(avg.team);
    const marketSide = mk === undefined ? null : side === "Over" ? mk : 1 - mk;
    const trust = avg.values
      ? calibrateTrust(propTrust("nfl", modelOnly, trustFeatures(avg.values, g.line, side), marketSide ?? americanToImpliedProb(price)), trustShift)
      : undefined;
    if (trust && avg.efficiency) trust.reasons.push(avg.efficiency.reason);
    if (trust && avg.streak) trust.reasons.push(streakReason(avg.streak));
    if (trust && avg.starOut) trust.reasons.push(`${avg.starOut.reason}: projection ${avg.starOut.factor > 1 ? "raised" : "trimmed"} ${Math.round(Math.abs(avg.starOut.factor - 1) * 100)}%`);
    if (trust && avg.windFactor !== undefined) {
      trust.reasons.push(`Windy game forecast: projection trimmed ${Math.round((1 - avg.windFactor) * 100)}%`);
    }
    if (trust && avg.returnAdj) {
      trust.reasons.push(
        avg.returnAdj.kind === "self"
          ? `First game back from injury: projection trimmed ${Math.round((1 - avg.returnAdj.factor) * 100)}% (players usually start slow)`
          : `${avg.returnAdj.who} is back from injury: projection trimmed ${Math.round((1 - avg.returnAdj.factor) * 100)}% for a smaller role`
      );
    }
    if (trust && avg.snapTrend !== undefined) {
      if (avg.snapTrend >= 1.15) trust.reasons.push(`Snap share up lately (${Math.round((avg.snapTrend - 1) * 100)}% over his recent norm): a bigger role`);
      else if (avg.snapTrend <= 0.85) trust.reasons.push(`Snap share down lately (${Math.round((1 - avg.snapTrend) * 100)}% under his recent norm): a smaller role`);
    }

    picks.push({
      player: g.player,
      team: avg.team,
      statType: g.statType,
      line: g.line,
      side,
      book: g.book,
      priceAmerican: price,
      projection,
      edgePct,
      modelWinPct,
      modelOnly,
      modelBase,
      market: marketSide,
      opponent: matchup?.opponent ?? null,
      gameDate: matchup?.gameDate ?? null,
      trust,
    });
  }

  return picks.sort((a, b) => b.modelWinPct - a.modelWinPct);
}

export interface TdProjection {
  player: string;
  team: string;
  games: number;
  tdsPerGame: number; // rushing + receiving TDs, per game this season
  anytimeTdPct: number; // Poisson P(at least 1 TD this game)
  multiTdPct: number; // Poisson P(2 or more TDs this game)
}

/**
 * Touchdowns are a rare, lumpy event — not a smooth per-game average like
 * yards — so unlike the other stat types this doesn't compare against a
 * sportsbook line (The Odds API's exact market key for anytime/multi-TD
 * props isn't verified against this app's live key yet, and bundling a
 * wrong key into the multi-market request above would risk breaking the
 * yardage props that already work). Instead this projects each player's own
 * chance of scoring at all, and scoring twice, using a standard Poisson
 * model from their season-to-date TD rate: P(0 TDs) = e^-rate, so
 * P(1+) = 1 - e^-rate and P(2+) = 1 - e^-rate - (rate * e^-rate).
 */
export function computeTdProjections(rows: PlayerWeekStats[]): TdProjection[] {
  const totals = new Map<string, { team: string; tds: number; games: number }>();
  for (const row of rows) {
    // Count every game this player suited up for (not just scoring games),
    // so a 1-TD-in-10-games player reads as a low rate rather than 100%.
    const key = row.player;
    const existing = totals.get(key) ?? { team: row.team, tds: 0, games: 0 };
    existing.tds += row.rushingTds + row.receivingTds;
    existing.games += 1;
    existing.team = row.team;
    totals.set(key, existing);
  }

  const out: TdProjection[] = [];
  for (const [player, { team, tds, games }] of totals) {
    if (games < MIN_GAMES_FOR_PROJECTION || tds <= 0) continue;
    const rate = tds / games;
    const pZero = Math.exp(-rate);
    const anytimeTdPct = 1 - pZero;
    const multiTdPct = 1 - pZero - rate * pZero;
    out.push({ player, team, games, tdsPerGame: rate, anytimeTdPct, multiTdPct });
  }
  return out.sort((a, b) => b.anytimeTdPct - a.anytimeTdPct);
}

export interface EventProjection {
  player: string;
  team: string;
  games: number;
  ratePerGame: number;
  anytimePct: number; // Poisson P(at least 1 this game)
}

/**
 * Shared Poisson "does this happen at least once this game" projection,
 * generalizing the Anytime TD math above to any rare counting event —
 * interceptions thrown, fumbles lost, sacks taken, sacks/picks recorded on
 * defense. Same reasoning as computeTdProjections: no sportsbook line to
 * compare against, so this reports the player's own season-to-date rate as
 * a straight-up probability instead.
 */
function aggregateEventRate<T extends { player: string; team: string }>(
  rows: T[],
  countFn: (row: T) => number
): EventProjection[] {
  const totals = new Map<string, { team: string; count: number; games: number }>();
  for (const row of rows) {
    const key = row.player;
    const existing = totals.get(key) ?? { team: row.team, count: 0, games: 0 };
    existing.count += countFn(row);
    existing.games += 1;
    existing.team = row.team;
    totals.set(key, existing);
  }

  const out: EventProjection[] = [];
  for (const [player, { team, count, games }] of totals) {
    if (games < MIN_GAMES_FOR_PROJECTION || count <= 0) continue;
    const rate = count / games;
    out.push({ player, team, games, ratePerGame: rate, anytimePct: 1 - Math.exp(-rate) });
  }
  return out.sort((a, b) => b.anytimePct - a.anytimePct);
}

export interface TurnoverProjections {
  interceptionsThrown: EventProjection[];
  fumblesLost: EventProjection[];
  sacksTaken: EventProjection[];
}

/** QB/skill-position negative-event props: INT Thrown, Fumble Lost, QB Sacked. */
export function computeTurnoverProjections(rows: PlayerWeekStats[]): TurnoverProjections {
  return {
    interceptionsThrown: aggregateEventRate(rows, (r) => r.interceptionsThrown),
    fumblesLost: aggregateEventRate(rows, (r) => r.fumblesLost),
    sacksTaken: aggregateEventRate(rows, (r) => r.sacksTaken),
  };
}

export interface DefensiveProjections {
  anytimeSack: EventProjection[];
  anytimeInt: EventProjection[];
}

/** Defensive-player props: Anytime Sack, Anytime INT. */
export function computeDefensiveProjections(rows: DefensivePlayerWeekStats[]): DefensiveProjections {
  return {
    anytimeSack: aggregateEventRate(rows, (r) => r.sacks),
    anytimeInt: aggregateEventRate(rows, (r) => r.interceptions),
  };
}

export function americanToImpliedProb(price: number): number {
  return price > 0 ? 100 / (price + 100) : -price / (-price + 100);
}

export interface ParlayLeg {
  player: string;
  team: string;
  statType: string;
  side: "Over" | "Under";
  line: number;
  book: string;
  priceAmerican: number;
  winPct: number;
}

export interface AutoParlay {
  kind: "auto";
  season: number;
  week: number;
  size: number;
  legs: ParlayLeg[];
  combinedWinPct: number;
  weakestLegWinPct: number;
  confidence: "High" | "Moderate" | "Low";
}

/**
 * Combines the highest-confidence single picks into 2/3/4-leg parlays, one
 * player per leg (no same-player same-week stacking). `picks` only ever
 * contains legs that already cleared MIN_MODEL_WIN_PCT individually (see
 * buildPropPicks) — combining several 70%+ legs still multiplies down to a
 * lower combined number, which is just how parlays work, not a bug; nothing
 * here re-filters the combined number against that same 70% bar.
 */
export function buildAutoParlays(picks: PropPick[], season: number, week: number): AutoParlay[] {
  const seenPlayers = new Set<string>();
  const onePerPlayer: PropPick[] = [];
  for (const pick of picks) {
    if (seenPlayers.has(pick.player)) continue;
    seenPlayers.add(pick.player);
    onePerPlayer.push(pick);
  }

  const parlays: AutoParlay[] = [];
  for (const size of [2, 3, 4]) {
    if (onePerPlayer.length < size) continue;
    const legs = onePerPlayer.slice(0, size).map((p) => ({
      player: p.player,
      team: p.team,
      statType: p.statType,
      side: p.side,
      line: p.line,
      book: p.book,
      priceAmerican: p.priceAmerican,
      winPct: p.modelWinPct,
    }));
    const combinedWinPct = legs.reduce((acc, l) => acc * l.winPct, 1);
    const weakestLegWinPct = Math.min(...legs.map((l) => l.winPct));
    const confidence: AutoParlay["confidence"] =
      combinedWinPct >= 0.35 ? "High" : combinedWinPct >= 0.2 ? "Moderate" : "Low";

    parlays.push({ kind: "auto", season, week, size, legs, combinedWinPct, weakestLegWinPct, confidence });
  }
  return parlays;
}
