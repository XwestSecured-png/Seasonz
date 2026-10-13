import type { ScheduleGame } from "./nflverse";

// Generic enough to replay Elo for ANY sport's schedule, not just NFL's
// ScheduleGame (which already satisfies this shape structurally — season,
// week, homeTeam/awayTeam, scores, isFinal — so passing a ScheduleGame[]
// here needs no change). lib/sports/sync.ts reuses this same function for
// NBA/NHL/MLB/NCAAF/NCAAB instead of re-deriving 538-style Elo per sport.
export interface EloInputGame {
  season: number;
  week: number;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  isFinal: boolean;
}

// Standard NFL Elo model (538-style): K-factor controls how fast ratings
// move, HOME_ADVANTAGE gives the home team a rating bump for win-probability
// purposes only, and the margin-of-victory multiplier makes blowouts move
// ratings more than narrow wins. These are well-known public defaults, not
// a re-derivation of the original Sheet's exact constants (that project's
// precise tuning lives only in its own code) — tune K_FACTOR / HOME_ADVANTAGE
// here if you want to match a different calibration.
const K_FACTOR = 20;
const HOME_ADVANTAGE = 65; // Elo points
const BASE_RATING = 1500;

export interface TeamRatingState {
  rating: number;
  gamesPlayed: number;
}

function winProbability(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

function movMultiplier(pointDiff: number, eloDiff: number): number {
  // 538's margin-of-victory multiplier, dampened so a huge rating mismatch
  // doesn't get further amplified by a blowout.
  return Math.log(Math.abs(pointDiff) + 1) * (2.2 / (eloDiff * 0.001 + 2.2));
}

export interface EloGameResult<G extends EloInputGame = ScheduleGame> {
  game: G;
  homeRatingPre: number;
  awayRatingPre: number;
  homeWinProbPre: number;
  homeRatingPost: number;
  awayRatingPost: number;
}

/**
 * Replays every final game in chronological order, updating each team's
 * rating after the result. Returns per-game pre-game ratings/win-prob
 * (for Model Tracker grading) plus the final rating map for every team.
 * Generic over the game shape so NFL's ScheduleGame and the generic
 * multi-sport GenericGame (lib/sports/types.ts) both work unchanged.
 */
export function replayElo<G extends EloInputGame>(
  games: G[]
): { results: EloGameResult<G>[]; finalRatings: Map<string, TeamRatingState> } {
  const ratings = new Map<string, TeamRatingState>();
  const getState = (team: string): TeamRatingState => {
    const existing = ratings.get(team);
    if (existing) return existing;
    const fresh = { rating: BASE_RATING, gamesPlayed: 0 };
    ratings.set(team, fresh);
    return fresh;
  };

  const sorted = [...games].sort((a, b) => {
    if (a.season !== b.season) return a.season - b.season;
    if (a.week !== b.week) return a.week - b.week;
    return 0;
  });

  const results: EloGameResult<G>[] = [];

  for (const game of sorted) {
    const home = getState(game.homeTeam);
    const away = getState(game.awayTeam);

    const homeRatingPre = home.rating;
    const awayRatingPre = away.rating;
    const homeWinProbPre = winProbability(
      homeRatingPre + HOME_ADVANTAGE,
      awayRatingPre
    );

    let homeRatingPost = homeRatingPre;
    let awayRatingPost = awayRatingPre;

    if (game.isFinal && game.homeScore !== null && game.awayScore !== null) {
      const homeActual =
        game.homeScore > game.awayScore ? 1 : game.homeScore < game.awayScore ? 0 : 0.5;
      const pointDiff = game.homeScore - game.awayScore;
      const mult = movMultiplier(pointDiff, homeRatingPre - awayRatingPre);
      const delta = K_FACTOR * mult * (homeActual - homeWinProbPre);

      homeRatingPost = homeRatingPre + delta;
      awayRatingPost = awayRatingPre - delta;

      home.rating = homeRatingPost;
      away.rating = awayRatingPost;
      home.gamesPlayed += 1;
      away.gamesPlayed += 1;
    }

    results.push({
      game,
      homeRatingPre,
      awayRatingPre,
      homeWinProbPre,
      homeRatingPost,
      awayRatingPost,
    });
  }

  return { results, finalRatings: ratings };
}

// ---------------------------------------------------------------------------
// NFL Elo v2 — tuned on 2012-2022 and checked on 2023-2025 (held out, 854
// games; scripts/backtest-nfl):
//                       log loss  Brier   picked winner
//   old (reset yearly)   .6477    .2287   60.7%   weeks 1-4: 50.3%
//   v2 (carryover)       .6339    .2219   63.9%   weeks 1-4: 60.2%
// Ratings carry over from the previous three seasons, pulled halfway back
// to average each offseason, so week 1 isn't a coin flip. Home edge 48 Elo
// points (it has shrunk since the 2010s); K 20; margin-of-victory scaled.
export const NFL_ELO = { k: 20, hfa: 48, regress: 0.5, seasonsBack: 3 };

// Relocated franchises use their current code all the way back.
const NFL_CODE: Record<string, string> = { OAK: "LV", SD: "LAC", STL: "LA" };

export function replayNflElo<G extends EloInputGame>(
  history: EloInputGame[],
  schedule: G[]
): { results: EloGameResult<G>[]; finalRatings: Map<string, TeamRatingState> } {
  const p = NFL_ELO;
  const season = schedule[0]?.season ?? 0;
  const code = (t: string) => NFL_CODE[t] ?? t;
  const ratings = new Map<string, TeamRatingState>();
  const getState = (team: string): TeamRatingState => {
    let s = ratings.get(team);
    if (!s) {
      s = { rating: BASE_RATING, gamesPlayed: 0 };
      ratings.set(team, s);
    }
    return s;
  };
  type Row = { g: EloInputGame; own: G | null };
  const past: Row[] = history
    .filter((g) => g.season < season && g.season >= season - p.seasonsBack && g.isFinal)
    .map((g) => ({ g, own: null }));
  const rows: Row[] = [...past, ...schedule.map((g) => ({ g: g as EloInputGame, own: g }))].sort(
    (a, b) => a.g.season - b.g.season || a.g.week - b.g.week
  );

  const results: EloGameResult<G>[] = [];
  let current: number | null = null;
  for (const { g, own } of rows) {
    if (g.season !== current) {
      if (current !== null) {
        for (const s of ratings.values()) {
          s.rating = BASE_RATING + (1 - p.regress) * (s.rating - BASE_RATING);
          s.gamesPlayed = 0;
        }
      }
      current = g.season;
    }
    const home = getState(code(g.homeTeam));
    const away = getState(code(g.awayTeam));
    const homeRatingPre = home.rating;
    const awayRatingPre = away.rating;
    const homeWinProbPre = winProbability(homeRatingPre + p.hfa, awayRatingPre);
    let homeRatingPost = homeRatingPre;
    let awayRatingPost = awayRatingPre;
    if (g.isFinal && g.homeScore !== null && g.awayScore !== null) {
      const actual = g.homeScore > g.awayScore ? 1 : g.homeScore < g.awayScore ? 0 : 0.5;
      const winnerEdge = actual === 1 ? homeRatingPre + p.hfa - awayRatingPre : awayRatingPre - homeRatingPre - p.hfa;
      const mult = Math.log(Math.abs(g.homeScore - g.awayScore) + 1) * (2.2 / (winnerEdge * 0.001 + 2.2));
      const delta = p.k * mult * (actual - homeWinProbPre);
      homeRatingPost = homeRatingPre + delta;
      awayRatingPost = awayRatingPre - delta;
      home.rating = homeRatingPost;
      away.rating = awayRatingPost;
      home.gamesPlayed += 1;
      away.gamesPlayed += 1;
    }
    if (own) results.push({ game: own, homeRatingPre, awayRatingPre, homeWinProbPre, homeRatingPost, awayRatingPost });
  }
  return { results, finalRatings: ratings };
}

/**
 * The NFL's final number blends the model with the sportsbook line (vig
 * removed). On 2023-2025 the line alone (67.9% of winners, log loss .6077)
 * beat every model mix, so the line gets all the weight when one is posted;
 * the model's own number still drives value picks and is shown alongside.
 */
export const NFL_MODEL_WEIGHT = 0;
