import type { PlayerWeekStats, DefensivePlayerWeekStats, ScheduleGame } from "./nflverse";
import type { PropOutcome } from "./odds";
import { MIN_MODEL_WIN_PCT } from "./confidence";

// A one- or two-game season average is too small a sample to trust over a
// book's own (much larger) model — require a few games first.
const MIN_GAMES_FOR_PROJECTION = 3;
// Only the player's most recent games feed the projection, weighted toward
// the most recent of those — recent form, not a flat season-long average.
const RECENT_GAMES_WINDOW = 5;
// A player's own game-to-game std dev floor, so a tiny real sample (e.g. 3
// nearly-identical games) never reads as near-certain. Absolute floor per
// stat type (yards are a bigger number than receptions) plus a
// percent-of-mean floor, whichever is larger.
const STDDEV_FLOOR_PCT = 0.12;
const STDDEV_FLOOR_ABS: Record<string, number> = {
  "Pass Yds": 15,
  "Rush Yds": 8,
  "Rec Yds": 8,
  Receptions: 1,
};
// Opponent-allowed adjustment is clamped to a modest range — a defense that
// has only faced a couple of real offenses this season shouldn't be able to
// swing a projection wildly on a small sample.
const OPPONENT_FACTOR_CLAMP: [number, number] = [0.8, 1.25];
const MIN_DEFENSE_GAMES_FOR_FACTOR = 2;

const STAT_FIELDS: { statType: string; field: keyof PlayerWeekStats }[] = [
  { statType: "Pass Yds", field: "passYds" },
  { statType: "Rush Yds", field: "rushYds" },
  { statType: "Rec Yds", field: "recYds" },
  { statType: "Receptions", field: "receptions" },
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
      teamFactors.set(statType, Math.min(OPPONENT_FACTOR_CLAMP[1], Math.max(OPPONENT_FACTOR_CLAMP[0], raw)));
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
  upcomingWeek: number
): Map<string, PlayerSeasonAverage> {
  const byKey = new Map<string, { team: string; week: number; value: number }[]>();
  for (const row of rows) {
    for (const { statType, field } of STAT_FIELDS) {
      const value = Number(row[field]) || 0;
      // Only count games where the player actually touched the stat, so a
      // bye-week/zero-target row doesn't drag their average down to look
      // like a game they were meaningfully on the field for.
      if (value <= 0) continue;
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
    const windowed = sorted.slice(0, RECENT_GAMES_WINDOW);
    const n = windowed.length;

    // Linear recency weights: the most recent game in the window counts n
    // times as much as the oldest, the next-most-recent n-1 times, etc.
    const weights = windowed.map((_, i) => n - i);
    const weightSum = weights.reduce((a, b) => a + b, 0);
    const weightedMean = windowed.reduce((acc, g, i) => acc + g.value * weights[i], 0) / weightSum;

    const rawMean = windowed.reduce((a, g) => a + g.value, 0) / n;
    const variance =
      n > 1 ? windowed.reduce((a, g) => a + (g.value - rawMean) ** 2, 0) / (n - 1) : 0;
    const floor = Math.max(weightedMean * STDDEV_FLOOR_PCT, STDDEV_FLOOR_ABS[statType] ?? 5);
    const stdDev = Math.max(Math.sqrt(variance), floor);

    const team = sorted[0].team;
    const opponent = opponentThisWeek.get(team);
    const oppFactor = opponent ? (opponentFactors.get(opponent)?.get(statType) ?? 1) : 1;
    const projection = weightedMean * oppFactor;

    out.set(key, { player, team, statType, average: projection, stdDev, games: n });
  }
  return out;
}

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
  unavailable: Set<string> = new Set()
): PropPick[] {
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
    if (p.side === "Over") g.overPrice = p.priceAmerican;
    else g.underPrice = p.priceAmerican;
    grouped.set(key, g);
  }

  const picks: PropPick[] = [];
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
