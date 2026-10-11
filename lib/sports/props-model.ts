// Real player-prop projections for every sport BESIDES NFL (NFL has its own
// lib/props-model.ts, which this deliberately mirrors) — recency-weighted
// projection, real opponent-allowed adjustment derived from already-synced
// box scores, and the model's real statistical win chance via the same
// normal-distribution math, gated at the same house-wide MIN_MODEL_WIN_PCT
// bar. The two math primitives that don't depend on any sport-specific
// field name (winProbability / americanToImpliedProb) are imported from
// lib/props-model.ts rather than duplicated.
import type { PropOutcome } from "../odds";
import { winProbability } from "../props-model";
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
const STDDEV_FLOOR_PCT = 0.12;
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
const STDDEV_FLOOR_ABS: Record<SportKey, Record<string, number>> = {
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
  },
};

export interface SportBoxScoreRow {
  player: string;
  team: string;
  week: number;
  stats: Record<string, string>;
}

export interface SportPlayerSeasonAverage {
  player: string;
  team: string;
  statType: string;
  average: number; // recency-weighted, opponent-adjusted projection — see lib/props-model.ts's identical field for the full reasoning
  stdDev: number;
  games: number;
}

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

/** Same reasoning as lib/props-model.ts's computeSeasonAverages, generalized over this sport's STAT_EXTRACTORS. */
export function computeSportSeasonAverages(
  sport: SportKey,
  rows: SportBoxScoreRow[],
  schedule: SportScheduleGame[],
  upcomingWeek: number
): Map<string, SportPlayerSeasonAverage> {
  const extractors = STAT_EXTRACTORS[sport];
  const floors = STDDEV_FLOOR_ABS[sport];

  const byKey = new Map<string, { team: string; week: number; value: number }[]>();
  for (const row of rows) {
    for (const { statType, extract } of extractors) {
      const value = extract(row.stats);
      if (value === null || value <= 0) continue;
      const key = `${row.player}|${statType}`;
      const list = byKey.get(key) ?? [];
      list.push({ team: row.team, week: row.week, value });
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
    const sorted = [...list].sort((a, b) => b.week - a.week);
    const windowed = sorted.slice(0, RECENT_GAMES_WINDOW);
    const n = windowed.length;

    const weights = windowed.map((_, i) => n - i);
    const weightSum = weights.reduce((a, b) => a + b, 0);
    const weightedMean = windowed.reduce((acc, g, i) => acc + g.value * weights[i], 0) / weightSum;

    const rawMean = windowed.reduce((a, g) => a + g.value, 0) / n;
    const variance = n > 1 ? windowed.reduce((a, g) => a + (g.value - rawMean) ** 2, 0) / (n - 1) : 0;
    const floor = Math.max(weightedMean * STDDEV_FLOOR_PCT, floors[statType] ?? 1);
    const stdDev = Math.max(Math.sqrt(variance), floor);

    const team = sorted[0].team;
    const opponent = opponentThisWeek.get(team);
    const oppFactor = opponent ? (opponentFactors.get(opponent)?.get(statType) ?? 1) : 1;
    const projection = weightedMean * oppFactor;

    out.set(key, { player, team, statType, average: projection, stdDev, games: n });
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
}

/** Same reasoning as lib/props-model.ts's buildPropPicks. */
export function buildSportPropPicks(
  props: PropOutcome[],
  averages: Map<string, SportPlayerSeasonAverage>,
  schedule: SportScheduleGame[],
  upcomingWeek: number,
  unavailable: Set<string> = new Set()
): SportPropPick[] {
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
    if (p.side === "Over") g.overPrice = p.priceAmerican;
    else g.underPrice = p.priceAmerican;
    grouped.set(key, g);
  }

  const picks: SportPropPick[] = [];
  for (const g of grouped.values()) {
    const avg = averages.get(`${g.player}|${g.statType}`);
    if (!avg || avg.games < MIN_GAMES_FOR_PROJECTION) continue;
    if (g.line <= 0) continue;
    if (unavailable.has(`${avg.team}|${g.player}`)) continue;

    const projection = avg.average;
    const edgePct = (projection - g.line) / g.line;
    const side: "Over" | "Under" = edgePct >= 0 ? "Over" : "Under";
    const modelWinPct = winProbability(avg.average, avg.stdDev, g.line, side);
    if (modelWinPct < MIN_MODEL_WIN_PCT) continue;

    const price = side === "Over" ? g.overPrice : g.underPrice;
    if (price == null) continue;

    const matchup = opponentThisWeek.get(avg.team);

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
      opponent: matchup?.opponent ?? null,
      gameDate: matchup?.gameDate ?? null,
    });
  }

  return picks.sort((a, b) => b.modelWinPct - a.modelWinPct);
}
