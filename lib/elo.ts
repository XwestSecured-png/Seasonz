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
