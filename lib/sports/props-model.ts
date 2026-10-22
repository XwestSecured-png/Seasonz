// Real player-prop projections for every sport BESIDES NFL (NFL has its own
// lib/props-model.ts, which this deliberately mirrors) — recency-weighted
// projection, real opponent-allowed adjustment derived from already-synced
// box scores, and the model's real statistical win chance via the same
// normal-distribution math, gated at the same house-wide MIN_MODEL_WIN_PCT
// bar. The two math primitives that don't depend on any sport-specific
// field name (winProbability / americanToImpliedProb) are imported from
// lib/props-model.ts rather than duplicated.
import { adjustMarketMap, scaleAdjustments, type MarketLearn } from "../market-adjust";
import { gameDayFactor, type GameDayContext } from "./game-day";
import { propTrust, calibrateTrust, trustFeatures, type Trust } from "../prop-trust";
import type { PropOutcome } from "../odds";
import { winProbability, americanToImpliedProb, MIN_PROP_EDGE, NFL_PROP_MODEL, isPlaceholderLine, marketOverChances, blendPropChance, oneSidedMarket, PROP_MODEL_WEIGHT_DEFAULT } from "../props-model";
import { projectProp, propChance, LEGACY_PROP_MODEL, streakFactor, streakReason, type PropModelConfig, type Projection } from "../prop-dist";
import { MIN_MODEL_WIN_PCT } from "../confidence";
import { STAT_EXTRACTORS } from "./stat-extract";
import type { SportKey } from "./types";

// Just the schedule fields this module actually reads — not the full
// GenericGame (whose `sport` field is a plain DB `string`, not the
// narrower SportKey this module's functions take as a separate argument;
// keeping this minimal avoids that mismatch rather than casting it away).
export interface SportScheduleGame {
  week: number;
  homeTeam: string;
  awayTeam: string;
  gameDate: string | null;
}

const MIN_GAMES_FOR_PROJECTION = 3;
const RECENT_GAMES_WINDOW = 5;
const OPPONENT_FACTOR_CLAMP: [number, number] = [0.8, 1.25];
const MIN_DEFENSE_GAMES_FOR_FACTOR = 2;

// Per-sport, per-stat absolute std-dev floor — same role as NFL's
// STDDEV_FLOOR_ABS (lib/props-model.ts): keeps a tiny real sample (e.g. 3
// nearly-identical games) from reading as near-certain. These are
// reasonable-estimate floors sized to each stat's typical game-to-game
// scale (a basketball scorer's points vary by a few per game, a goalie's
// saves by a couple, etc.) — same "best estimate, not fabricated data"
// status as NFL's own floors, and erring toward a slightly larger floor
// is the safe direction here: it costs some borderline picks, never
// invents false confidence.
const BASKETBALL_FLOORS: Record<string, number> = {
  Points: 4,
  Rebounds: 2,
  Assists: 1.5,
  "3-Pointers Made": 1,
  Steals: 0.7,
  Blocks: 0.7,
  Turnovers: 0.8,
  "Pts+Reb+Ast": 6,
  "Pts+Reb": 5,
  "Reb+Ast": 2.5,
};
// Spread multipliers from the prop calibration check (lib/prop-calibration.ts,
// /api/health/insights?propcal=<sport>): replaying last and this season's
// box scores, the old model said ~80% on its 70%+ picks but hit 71-78%. With
// zero games counted and these wider spreads, predicted and actual match
// (e.g. NBA points 80.1% predicted / 80.2% actual). Stats too rare to fit
// use 1.5.
const BASKETBALL_SD_MULT: Record<string, number> = {
  Points: 1.2,
  Rebounds: 1.1,
  Assists: 1.1,
  "3-Pointers Made": 1.3,
  Steals: 1.5,
  Blocks: 1.5,
  Turnovers: 1.4,
  "Pts+Reb+Ast": 1.1,
  "Pts+Reb": 1.1,
  "Reb+Ast": 1.1,
};
export const PROP_SD_MULT: Record<SportKey, Record<string, number>> = {
  nba: BASKETBALL_SD_MULT,
  wnba: { ...BASKETBALL_SD_MULT, Rebounds: 1.0, "Pts+Reb+Ast": 1.0, Blocks: 1.4 },
  ncaab: BASKETBALL_SD_MULT,
  nhl: { Goals: 1.5, Assists: 1.5, Points: 1.3, "Shots on Goal": 1.1, Saves: 1.2 },
  mlb: {
    Hits: 1.4,
    "Home Runs": 1.5,
    RBIs: 1.5,
    "Runs Scored": 1.4,
    Walks: 1.7,
    "Strikeouts (Batter)": 1.5,
    "Strikeouts (Pitcher)": 0.9,
    "Hits Allowed": 0.9,
    "Walks Allowed": 1.2,
    "Earned Runs": 1.3,
  },
  ncaaf: { "Pass Yds": 1.3, "Rush Yds": 1.3, "Rec Yds": 1.4, Receptions: 1.3, "Rush + Rec Yds": 1.3 },
};

// Per-stat model (lib/prop-dist.ts), chosen on every NBA (2,627) and WNBA
// (656) game of 2025-26. Log loss old -> new (lower is better) and the
// 70%+ picks' predicted/actual hit rate:
//   Points    .596 -> .575  (80.8% / 80.5%)  negative binomial
//   Rebounds  .580 -> .552  (82.6% / 81.7%)  Poisson
//   Assists   .590 -> .562  (81.4% / 81.6%)  Poisson
//   Threes    .608 -> .575  (81.1% / 80.2%)  Poisson
//   Steals    .629 -> .596, Blocks .629 -> .595, Turnovers .613 -> .575
// All use per-minute rate x expected minutes and pull the last 5 games
// hard toward the 20-game average; "temper" pulls chances toward 50%
// where the count model ran a little overconfident. Combos (P+R+A etc.)
// weren't separately tested and use the Points model.
const BB_POINTS: PropModelConfig = { dist: "negbin", sdMult: 1.2, shrinkK: 40, useMinutes: true, temper: 0.8 };
const BASKETBALL_PROP_MODEL: Record<string, PropModelConfig> = {
  Points: BB_POINTS,
  Rebounds: { dist: "poisson", sdMult: 1.1, shrinkK: 40, useMinutes: true, temper: 0.8 },
  Assists: { dist: "poisson", sdMult: 1.1, shrinkK: 40, useMinutes: true, temper: 0.8 },
  "3-Pointers Made": { dist: "poisson", sdMult: 1.3, shrinkK: 40, useMinutes: true, temper: 0.88 },
  Steals: { dist: "poisson", sdMult: 1.5, shrinkK: 40, useMinutes: true, temper: 0.88 },
  Blocks: { dist: "poisson", sdMult: 1.5, shrinkK: 40, useMinutes: true, temper: 0.88 },
  Turnovers: { dist: "poisson", sdMult: 1.4, shrinkK: 40, useMinutes: true, temper: 0.88 },
  // Combos (1.15.1, live check on NBA and WNBA box scores, lines out to
  // 2 sd): per-game negative binomial with a light 20-game pull beat the
  // Points model in both leagues. NBA PRA .4326 -> .4304, P+R .4446 ->
  // .4433, R+A .4371 -> .4363; WNBA PRA .4264 -> .4251, P+R .443 -> .442.
  "Pts+Reb+Ast": { dist: "negbin", sdMult: 1.2, shrinkK: 5, useMinutes: false, temper: 0.8 },
  "Pts+Reb": { dist: "negbin", sdMult: 1.2, shrinkK: 5, useMinutes: false, temper: 0.8 },
  "Reb+Ast": { dist: "negbin", sdMult: 1.2, shrinkK: 5, useMinutes: false, temper: 0.88 },
};
/** The model per sport and stat; anything not listed keeps the original bell-curve model. */
export const PROP_MODEL: Record<SportKey, Record<string, PropModelConfig>> = {
  nba: BASKETBALL_PROP_MODEL,
  // WNBA points: a bell curve on per-minute scoring fit better (1.15.1: .4718 -> .4687).
  wnba: { ...BASKETBALL_PROP_MODEL, Points: { dist: "normal", sdMult: 1.2, shrinkK: 40, useMinutes: true } },
  ncaab: BASKETBALL_PROP_MODEL,
  // College football (live check, 2025-26 box scores): yardage and catches
  // prefer heavier shrinkage than the NFL. Rec Yds .612 -> .603, Rush
  // .619 -> .612, Receptions .583 -> .567.
  ncaaf: {
    ...NFL_PROP_MODEL,
    // The NFL's 20-game spread pull (1.13.0) didn't help in college (live
    // check, lines out to 2 sd: Rush .5302 -> .5353, Rec .5076 -> .5082,
    // Rush + Rec .5089 -> .5101), so passing keeps the pre-1.13 settings.
    "Pass Yds": { dist: "normal", sdMult: 1.3, shrinkK: 5, useMinutes: false, temper: 0.94 },
    "Rec Yds": { dist: "normal", sdMult: 1.4, shrinkK: 40, useMinutes: false },
    "Rush Yds": { dist: "normal", sdMult: 1.3, shrinkK: 40, useMinutes: false },
    Receptions: { dist: "poisson", sdMult: 1.3, shrinkK: 40, useMinutes: false },
    // NFL's combo settings with college's heavier shrinkage (as for its parts).
    "Rush + Rec Yds": { dist: "normal", sdMult: 1.3, shrinkK: 40, useMinutes: false, temper: 0.94 },
  },
  // Hockey (live check on 2025-27 box scores, /api/health/insights?propcal=nhl):
  // Points .621 -> .590, Assists .640 -> .609, Shots .595 -> .563, Saves .594 -> .554.
  // Goals: see below.
  nhl: {
    Points: { dist: "poisson", sdMult: 1.3, shrinkK: 40, useMinutes: false, temper: 0.88 },
    Assists: { dist: "poisson", sdMult: 1.5, shrinkK: 40, useMinutes: false, temper: 0.88 },
    "Shots on Goal": { dist: "poisson", sdMult: 1.1, shrinkK: 40, useMinutes: false, temper: 0.88 },
    Saves: { dist: "negbin", sdMult: 1.2, shrinkK: 40, useMinutes: false, temper: 0.88 },
    // Goals ran on the original bell curve (too few regular scorers to grade
    // before). Checked on every skater with 10+ games (1.14.1, ?all=1):
    // log loss .494 -> .396; 70%+ chances said 86%, hit 87% (was 84% / 92%).
    Goals: { dist: "negbin", sdMult: 1.5, shrinkK: 40, useMinutes: false },
  },
  // Baseball (live check on 2025-26 box scores): Hits .629 -> .596, Batter K
  // .629 -> .594, Pitcher K .572 -> .550, Hits Allowed .581 -> .563, Walks
  // .643 -> .605, Walks Allowed .599 -> .576, Runs .638 -> .607, Earned Runs
  // .609 -> .592. Home runs and RBIs: see below.
  mlb: {
    Hits: { dist: "poisson", sdMult: 1.4, shrinkK: 40, useMinutes: false },
    "Runs Scored": { dist: "poisson", sdMult: 1.4, shrinkK: 40, useMinutes: false, temper: 0.88 },
    Walks: { dist: "poisson", sdMult: 1.7, shrinkK: 40, useMinutes: false, temper: 0.88 },
    "Strikeouts (Batter)": { dist: "poisson", sdMult: 1.5, shrinkK: 40, useMinutes: false },
    "Strikeouts (Pitcher)": { dist: "negbin", sdMult: 0.9, shrinkK: 40, useMinutes: false },
    // 1.15.1 live check: Hits Allowed .4699 -> .4686 (Poisson, stronger pull to 50%).
    "Hits Allowed": { dist: "poisson", sdMult: 0.9, shrinkK: 40, useMinutes: false, temper: 0.8 },
    "Walks Allowed": { dist: "poisson", sdMult: 1.2, shrinkK: 40, useMinutes: false, temper: 0.88 },
    // 1.15.1 live check: Earned Runs .5194 -> .5162 (bell curve, light 20-game pull).
    "Earned Runs": { dist: "normal", sdMult: 1.3, shrinkK: 5, useMinutes: false },
    // Home runs and RBIs ran on the original bell curve, which badly overrated
    // "1+" on rare events. Checked on every batter with 10+ games (1.14.1,
    // ?all=1): Home Runs log loss .459 -> .328 (70%+ chances said 88%, hit
    // 90%; was 80% / 92%), RBIs .548 -> .473 (said 85%, hit 86%).
    "Home Runs": { dist: "negbin", sdMult: 1.5, shrinkK: 100, useMinutes: false },
    RBIs: { dist: "negbin", sdMult: 1.5, shrinkK: 40, useMinutes: false, temper: 0.88 },
  },
};
export function propModelFor(sport: SportKey, statType: string): PropModelConfig {
  return PROP_MODEL[sport][statType] ?? LEGACY_PROP_MODEL(PROP_SD_MULT[sport][statType] ?? 1.3);
}

/** Minutes played, where the box score has them (basketball "MIN", hockey "TOI" as mm:ss). */
export function minutesOf(stats: Record<string, string>): number | null {
  if (stats.MIN != null) {
    const n = Number(stats.MIN);
    return Number.isFinite(n) ? n : null;
  }
  if (stats.TOI != null) {
    const [m, sec] = String(stats.TOI).split(":").map(Number);
    return Number.isFinite(m) ? m + (sec || 0) / 60 : null;
  }
  return null;
}

export const STDDEV_FLOOR_ABS: Record<SportKey, Record<string, number>> = {
  nba: BASKETBALL_FLOORS,
  wnba: BASKETBALL_FLOORS,
  ncaab: BASKETBALL_FLOORS,
  nhl: {
    Goals: 0.5,
    Assists: 0.6,
    Points: 0.8,
    "Shots on Goal": 1.3,
    Saves: 2.5,
  },
  mlb: {
    Hits: 0.7,
    "Home Runs": 0.4,
    RBIs: 0.8,
    "Runs Scored": 0.6,
    Walks: 0.5,
    "Strikeouts (Batter)": 0.6,
    "Strikeouts (Pitcher)": 1.5,
    "Hits Allowed": 1.8,
    "Walks Allowed": 1.0,
    "Earned Runs": 1.5,
  },
  // Same stat shape as NFL's own nflverse-fed yardage props, so these reuse
  // NFL's exact floors (lib/props-model.ts) as a reasonable baseline.
  ncaaf: {
    "Pass Yds": 15,
    "Rush Yds": 8,
    "Rec Yds": 8,
    Receptions: 1,
    "Rush + Rec Yds": 10,
  },
};

export interface SportBoxScoreRow {
  player: string;
  team: string;
  position?: string | null;
  week: number;
  /** Kickoff time (ms), to order several games in one week. */
  t?: number;
  stats: Record<string, string>;
}

export interface SportPlayerSeasonAverage {
  player: string;
  team: string;
  statType: string;
  average: number; // recency-weighted, opponent-adjusted projection — see lib/props-model.ts's identical field for the full reasoning
  stdDev: number;
  games: number;
  proj?: Projection;
  /** Projected mean before the matchup/game-day/efficiency/streak multipliers. */
  baseMean?: number;
  cfg?: PropModelConfig;
  sport?: SportKey;
  /** Every game's value and minutes, oldest first (for the trust score). */
  values?: number[];
  minutes?: (number | null)[];
  /** Back-from-injury adjustment applied to the projection, when any. */
  returnAdj?: { kind: "self" | "teammate"; who: string; factor: number };
  /** Game-day adjustment (opposing pitcher, park, opponent strength), when it moved the number 5%+. */
  gameDayReason?: string;
  /** Streak correction applied (only when 3%+). */
  streak?: number;
}

/** A key player back from injury (lib/injury-returns.ts), with when he came off the Out list. */
export interface SportReturner {
  player: string;
  team: string;
  position: string | null;
  at: number;
}

/**
 * Back from injury, other sports (1.14.1). Live check on 2025-27 box scores
 * (/api/health/insights?returncal=<sport>), log loss at lines around the
 * projection, against ordinary games as the baseline:
 *  - basketball: a key player's first game back runs ~7% under his
 *    projection (NBA Points: x0.9 gains .009 where ordinary games lose
 *    .007; WNBA similar or stronger); same-position teammates lose ~10%
 *    (NBA Points/Rebounds/PRA x0.85-0.9 gain .013-.015).
 *  - hockey: a key skater's first game back, Points/Assists x0.88-0.9
 *    (gain .012-.013; ordinary games ~0).
 * Baseball (rest days look the same as injuries in box scores) and college
 * football (too few games) aren't adjusted.
 */
const RETURN_SELF_BY_SPORT: Partial<Record<SportKey, Record<string, number>>> = {
  nba: { Points: 0.94, Rebounds: 0.95, Assists: 0.95, "3-Pointers Made": 0.9, "Pts+Reb": 0.94, "Pts+Reb+Ast": 0.94, "Reb+Ast": 0.95, Steals: 0.9, Blocks: 0.92, Turnovers: 0.95 },
  nhl: { Points: 0.9, Assists: 0.9 },
};
RETURN_SELF_BY_SPORT.wnba = RETURN_SELF_BY_SPORT.nba;
RETURN_SELF_BY_SPORT.ncaab = RETURN_SELF_BY_SPORT.nba;
const RETURN_MATE_BY_SPORT: Partial<Record<SportKey, Record<string, number>>> = {
  nba: { Points: 0.9, Rebounds: 0.9, Assists: 0.9, "3-Pointers Made": 0.92, "Pts+Reb": 0.9, "Pts+Reb+Ast": 0.9, "Reb+Ast": 0.92, Steals: 0.94, Blocks: 0.94, Turnovers: 0.92 },
};
RETURN_MATE_BY_SPORT.wnba = RETURN_MATE_BY_SPORT.nba;
RETURN_MATE_BY_SPORT.ncaab = RETURN_MATE_BY_SPORT.nba;
const bbGroup = (p: string | null | undefined) => {
  const x = (p ?? "").toUpperCase();
  return x.startsWith("C") ? "C" : x.startsWith("G") || x === "PG" || x === "SG" ? "G" : "F";
};

/** Same reasoning as lib/props-model.ts's computeOpponentAllowedFactors, generalized over this sport's STAT_EXTRACTORS instead of a fixed NFL field list. */
function computeOpponentAllowedFactors(
  sport: SportKey,
  rows: SportBoxScoreRow[],
  schedule: SportScheduleGame[]
): Map<string, Map<string, number>> {
  const extractors = STAT_EXTRACTORS[sport];
  const opponentByTeamWeek = new Map<string, string>();
  for (const g of schedule) {
    opponentByTeamWeek.set(`${g.homeTeam}|${g.week}`, g.awayTeam);
    opponentByTeamWeek.set(`${g.awayTeam}|${g.week}`, g.homeTeam);
  }

  const allowedByDefense = new Map<string, Map<string, { sum: number; weeks: Set<number> }>>();
  const leagueTotals = new Map<string, { sum: number; defenseWeeks: Set<string> }>();

  for (const row of rows) {
    const opponent = opponentByTeamWeek.get(`${row.team}|${row.week}`);
    if (!opponent) continue;
    for (const { statType, extract } of extractors) {
      const value = extract(row.stats);
      if (value === null || value <= 0) continue;

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
      teamFactors.set(statType, Math.min(OPPONENT_FACTOR_CLAMP[1], Math.max(OPPONENT_FACTOR_CLAMP[0], raw)));
    }
    factors.set(team, teamFactors);
  }
  return factors;
}

/**
 * Hot and cold streaks even out (1.18.0, lib/prop-dist.ts streakFactor).
 * Fitted per stat on last season and this one in the app's box scores
 * (/api/health/insights?mentalcal=<sport>), kept only where both seasons
 * agreed: log loss -0.1 to -0.4% (NBA's current season agreed but is small).
 * College sports and stats with no agreement are left alone.
 */
export const STREAK_POW: Partial<Record<SportKey, Record<string, number>>> = {
  nhl: { Assists: 0.15, Goals: 0.2, Points: 0.1 },
  wnba: { Points: 0.1, Rebounds: 0.1, Turnovers: 0.1, "Pts+Reb": 0.15, "Pts+Reb+Ast": 0.15, "Reb+Ast": 0.15 },
  nba: { Points: 0.15, Rebounds: 0.15, Turnovers: 0.1, "Pts+Reb": 0.2, "Pts+Reb+Ast": 0.15, "Reb+Ast": 0.2 },
  mlb: { Hits: 0.1, "Strikeouts (Batter)": 0.15, "Earned Runs": 0.15 },
};

/** Same reasoning as lib/props-model.ts's computeSeasonAverages, generalized over this sport's STAT_EXTRACTORS. */
export function computeSportSeasonAverages(
  sport: SportKey,
  rows: SportBoxScoreRow[],
  schedule: SportScheduleGame[],
  upcomingWeek: number,
  /** Key players back from injury (recent injury_returns rows). */
  returners: SportReturner[] = [],
  /** Opposing pitcher, park and opponent strength this week (lib/sports/game-day.ts). */
  gameDay?: GameDayContext
): Map<string, SportPlayerSeasonAverage> {
  const extractors = STAT_EXTRACTORS[sport];
  const floors = STDDEV_FLOOR_ABS[sport];
  // Last game and position per player, to tell whether a returner has played since he came back.
  const lastGame = new Map<string, number>();
  const posOf = new Map<string, string | null>();
  for (const r of rows) {
    if ((r.t ?? 0) > (lastGame.get(r.player) ?? 0)) lastGame.set(r.player, r.t ?? 0);
    if (r.position) posOf.set(r.player, r.position);
  }
  const pending = returners.filter((r) => (lastGame.get(r.player) ?? 0) < r.at);
  const selfF = RETURN_SELF_BY_SPORT[sport] ?? {};
  const mateF = RETURN_MATE_BY_SPORT[sport] ?? {};

  const byKey = new Map<string, { team: string; week: number; t: number; value: number; min: number | null }[]>();
  for (const row of rows) {
    const min = minutesOf(row.stats);
    for (const { statType, extract } of extractors) {
      const value = extract(row.stats);
      if (value === null || value < 0) continue;
      // Goalie saves props are for starts: relief outings (under 40 minutes)
      // dragged the average down. Live check: log loss -1.3% / -2.9%.
      if (sport === "nhl" && statType === "Saves" && min !== null && min < 40) continue;
      const key = `${row.player}|${statType}`;
      const list = byKey.get(key) ?? [];
      list.push({ team: row.team, week: row.week, t: row.t ?? 0, value, min });
      byKey.set(key, list);
    }
  }

  const opponentFactors = computeOpponentAllowedFactors(sport, rows, schedule);
  const opponentThisWeek = new Map<string, string>();
  for (const g of schedule) {
    if (g.week !== upcomingWeek) continue;
    opponentThisWeek.set(g.homeTeam, g.awayTeam);
    opponentThisWeek.set(g.awayTeam, g.homeTeam);
  }

  const out = new Map<string, SportPlayerSeasonAverage>();
  for (const [key, list] of byKey) {
    const [player, statType] = key.split("|");
    const sorted = [...list].sort((a, b) => b.week - a.week || b.t - a.t);
    const cfg = propModelFor(sport, statType);
    const chrono = [...sorted].reverse();
    const proj = projectProp(
      chrono.map((g) => g.value),
      cfg,
      floors[statType] ?? 1,
      cfg.useMinutes && chrono.every((g) => g.min !== null) ? chrono.map((g) => g.min) : undefined
    );
    if (!proj) continue;
    const n = Math.min(proj.games, RECENT_GAMES_WINDOW);
    const stdDev = proj.sd;

    const team = sorted[0].team;
    const opponent = opponentThisWeek.get(team);
    const oppFactor = opponent ? (opponentFactors.get(opponent)?.get(statType) ?? 1) : 1;
    let returnAdj: SportPlayerSeasonAverage["returnAdj"];
    if (pending.some((r) => r.player === player) && selfF[statType]) returnAdj = { kind: "self", who: player, factor: selfF[statType] };
    else if (mateF[statType]) {
      const g = bbGroup(posOf.get(player));
      const mate = pending.find((r) => r.team === team && r.player !== player && bbGroup(r.position ?? posOf.get(r.player)) === g);
      if (mate) returnAdj = { kind: "teammate", who: mate.player, factor: mateF[statType] };
    }
    const gd = gameDayFactor(gameDay, team, statType, player, sport);
    const streak = streakFactor(chrono.map((g) => g.value), STREAK_POW[sport]?.[statType]);
    const projection = proj.mean * oppFactor * (returnAdj?.factor ?? 1) * gd.factor * streak;

    out.set(key, {
      player,
      team,
      statType,
      average: projection,
      stdDev,
      games: n,
      proj: { ...proj, mean: projection },
      baseMean: proj.mean,
      cfg,
      sport,
      values: chrono.map((g) => g.value),
      minutes: chrono.map((g) => g.min),
      returnAdj,
      gameDayReason: gd.reason ?? undefined,
      streak: Math.abs(streak - 1) >= 0.03 ? streak : undefined,
    });
  }
  return out;
}

export interface SportPropPick {
  player: string;
  team: string;
  statType: string;
  line: number;
  side: "Over" | "Under";
  book: string;
  priceAmerican: number;
  projection: number;
  edgePct: number;
  modelWinPct: number;
  opponent: string | null;
  gameDate: string | null;
  trust?: Trust;
  /** The model's own chance (before the market blend) and the market's no-vig chance for the side. */
  modelOnly?: number;
  /** Model-only chance with no adjustments (side-oriented). */
  modelBase?: number;
  market?: number | null;
}

/** Same reasoning as lib/props-model.ts's buildPropPicks. */
export function buildSportPropPicks(
  props: PropOutcome[],
  averages: Map<string, SportPlayerSeasonAverage>,
  schedule: SportScheduleGame[],
  upcomingWeek: number,
  unavailable: Set<string> = new Set(),
  /** Model share of the model/market blend (lib/model-weights.ts, "prop:<sport>"), or one per stat. */
  modelWeight: number | ((statType: string) => number) = PROP_MODEL_WEIGHT_DEFAULT,
  /** Live trust correction (log-odds, lib/model-weights.ts "trust:<sport>"). */
  trustShift = 0,
  /** Learned market bias and line-move continuation (lib/market-learn.ts). */
  marketLearn?: MarketLearn,
  /** Learned strength of the projection adjustments (1 = as coded). */
  adjStrength = 1
): SportPropPick[] {
  const weightOf = (stat: string) => (typeof modelWeight === "function" ? modelWeight(stat) : modelWeight);
  const opponentThisWeek = new Map<string, { opponent: string; gameDate: string | null }>();
  for (const g of schedule) {
    if (g.week !== upcomingWeek) continue;
    opponentThisWeek.set(g.homeTeam, { opponent: g.awayTeam, gameDate: g.gameDate });
    opponentThisWeek.set(g.awayTeam, { opponent: g.homeTeam, gameDate: g.gameDate });
  }

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
  const picks: SportPropPick[] = [];
  for (const g of grouped.values()) {
    if (isPlaceholderLine(g.book, g.overPrice, g.underPrice)) continue;
    const avg = averages.get(`${g.player}|${g.statType}`);
    if (!avg || avg.games < MIN_GAMES_FOR_PROJECTION) continue;
    if (g.line <= 0) continue;
    if (unavailable.has(`${avg.team}|${g.player}`)) continue;

    const projection = avg.average;
    const edgePct = (projection - g.line) / g.line;
    // Count distributions are skewed, so take whichever side the model rates higher.
    const pOverAdj =
      avg.proj && avg.cfg ? propChance(avg.proj, g.line, avg.cfg, "Over") : winProbability(avg.average, avg.stdDev, g.line, "Over");
    const pOverBase = avg.proj && avg.cfg && avg.baseMean !== undefined ? propChance({ ...avg.proj, mean: avg.baseMean }, g.line, avg.cfg, "Over") : pOverAdj;
    // How hard to lean on the adjustments: learned from graded picks (lib/model-weights.ts "adj:<sport>").
    const pOverModel = scaleAdjustments(pOverBase, pOverAdj, adjStrength);
    // The final chance blends the model with the market's no-vig chance for
    // this line (see blendPropChance); no market, model alone.
    // No book posts both sides of this line (often an alt line): estimate
    // the market from this book's one price, less a typical 4.5% margin.
    const mk = market.get(`${g.player}|${g.statType}|${g.line}`) ?? oneSidedMarket(g.overPrice, g.underPrice);
    const pOver = mk === undefined ? pOverModel : blendPropChance(pOverModel, mk, weightOf(g.statType));
    const side: "Over" | "Under" = pOver >= 0.5 ? "Over" : "Under";
    const modelWinPct = side === "Over" ? pOver : 1 - pOver;
    const modelOnly = side === "Over" ? pOverModel : 1 - pOverModel;
    const modelBase = side === "Over" ? pOverBase : 1 - pOverBase;
    if (modelWinPct < MIN_MODEL_WIN_PCT) continue;

    const price = side === "Over" ? g.overPrice : g.underPrice;
    if (price == null) continue;
    // Only a pick when it beats the price: a 75% chance at -500 (83%
    // implied) is a losing bet however likely it is.
    if (modelWinPct - americanToImpliedProb(price) < MIN_PROP_EDGE) continue;

    const matchup = opponentThisWeek.get(avg.team);
    const marketSide = mk === undefined ? null : side === "Over" ? mk : 1 - mk;
    // Same minutes filter as the projection: games he didn't play don't count.
    const played = avg.values?.map((v, i) => ({ v, m: avg.minutes?.[i] ?? null })).filter((x) => !avg.cfg?.useMinutes || x.m === null || x.m > 0);
    const trust =
      played && avg.sport
        ? calibrateTrust(
            propTrust(avg.sport, modelOnly, trustFeatures(played.map((x) => x.v), g.line, side, played.map((x) => x.m)), marketSide ?? americanToImpliedProb(price)),
            trustShift
          )
        : undefined;
    if (trust && avg.gameDayReason) trust.reasons.push(avg.gameDayReason);
    if (trust && avg.streak) trust.reasons.push(streakReason(avg.streak));
    if (trust && avg.returnAdj) {
      trust.reasons.push(
        avg.returnAdj.kind === "self"
          ? `First game back from injury: projection trimmed ${Math.round((1 - avg.returnAdj.factor) * 100)}% (players usually start slow)`
          : `${avg.returnAdj.who} is back from injury: projection trimmed ${Math.round((1 - avg.returnAdj.factor) * 100)}% for a smaller role`
      );
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
