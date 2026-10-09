// Per-sport Elo for NBA / WNBA / NHL / MLB / college — tuned separately for
// each sport by backtesting on past seasons (see scripts/backtest-sport-elo/ and the
// numbers in SPORT_ELO below).
//
// What this does that the old one-size-fits-all replay (lib/elo.ts, which
// NFL still uses) didn't:
//  - Each sport gets its own K (how fast ratings move), home edge, and
//    margin-of-victory handling. A baseball game says far less about team
//    strength than a basketball game, so MLB moves slowly and NBA quickly.
//  - Ratings CARRY OVER from last season, pulled part-way back to average.
//    Before, every team restarted at 1500 each season, so the first weeks
//    of every season were close to coin flips.
//  - Neutral-site games get no home edge.
//  - Rest: a team on a back-to-back (or with less rest than its opponent)
//    gets a small, backtested penalty.
//  - Games are replayed in true start-time order, not just by week bucket.
//  - College: teams the model hasn't seen (lower-division opponents) start
//    below average instead of at 1500.
import type { SportKey } from "./types";

export interface SportEloParams {
  k: number;
  hfa: number; // Elo points for playing at home
  regress: number; // share pulled back to 1500 between seasons (1 = full reset)
  mov: boolean; // scale updates by margin of victory
  restPerDay: number; // Elo points per day of rest advantage (capped at 3 days)
  newTeam: number; // starting rating for a team with no history
}

// Tuned on prior seasons and checked on the most recent full season
// (held out). See the 1.2.0 patch notes for before/after accuracy.
export const SPORT_ELO: Record<SportKey, SportEloParams> = {
  // Held-out season, old model -> tuned model (accuracy / Brier, lower Brier is better):
  nba: { k: 12, hfa: 35, regress: 0.33, mov: true, restPerDay: 25, newTeam: 1500 }, // 66.6% -> 67.9% / .209 -> .207
  wnba: { k: 16, hfa: 45, regress: 0.5, mov: true, restPerDay: 5, newTeam: 1500 }, // 67.0% -> 67.8% / .207 -> .204
  nhl: { k: 6, hfa: 35, regress: 0.2, mov: true, restPerDay: 25, newTeam: 1500 }, // Brier .253 -> .250 (hockey is close to a coin flip)
  mlb: { k: 4, hfa: 25, regress: 0.2, mov: true, restPerDay: 0, newTeam: 1500 }, // 53.9% -> 55.8% / .257 -> .246
  ncaaf: { k: 30, hfa: 65, regress: 0.2, mov: true, restPerDay: 0, newTeam: 1500 }, // 67.8% -> 72.9% / .207 -> .180
  ncaab: { k: 30, hfa: 100, regress: 0.33, mov: true, restPerDay: 5, newTeam: 900 }, // 72.2% -> 72.9% / .196 -> .180
};

export interface SportEloGame {
  season: number;
  week: number;
  kickoffAt: Date | null;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  isFinal: boolean;
  neutralSite: boolean;
}

export interface SportEloResult<G extends SportEloGame> {
  game: G;
  homeRatingPre: number;
  awayRatingPre: number;
  homeWinProbPre: number;
  restDaysHome: number | null;
  restDaysAway: number | null;
}

const DAY = 86_400_000;
const MAX_REST = 3;

export function replaySportElo<G extends SportEloGame>(
  sport: SportKey,
  games: G[]
): { results: SportEloResult<G>[]; finalRatings: Map<string, { rating: number; gamesPlayed: number }> } {
  const p = SPORT_ELO[sport];
  const ratings = new Map<string, { rating: number; gamesPlayed: number }>();
  const lastPlayed = new Map<string, number>();
  const get = (t: string) => {
    let s = ratings.get(t);
    if (!s) {
      s = { rating: p.newTeam, gamesPlayed: 0 };
      ratings.set(t, s);
    }
    return s;
  };

  const sorted = [...games].sort(
    (a, b) =>
      a.season - b.season ||
      (a.kickoffAt?.getTime() ?? 0) - (b.kickoffAt?.getTime() ?? 0) ||
      a.week - b.week
  );

  const results: SportEloResult<G>[] = [];
  let season: number | null = null;
  for (const g of sorted) {
    if (g.season !== season) {
      if (season !== null) {
        for (const s of ratings.values()) {
          s.rating = 1500 + (1 - p.regress) * (s.rating - 1500);
          s.gamesPlayed = 0;
        }
      }
      season = g.season;
      lastPlayed.clear();
    }
    const home = get(g.homeTeam);
    const away = get(g.awayTeam);
    const t = g.kickoffAt?.getTime() ?? null;
    const rest = (team: string) => {
      const last = lastPlayed.get(team);
      return t === null || last === undefined ? null : Math.min(MAX_REST, Math.floor((t - last) / DAY));
    };
    const restDaysHome = rest(g.homeTeam);
    const restDaysAway = rest(g.awayTeam);

    let adj = g.neutralSite ? 0 : p.hfa;
    if (p.restPerDay) adj += p.restPerDay * ((restDaysHome ?? MAX_REST) - (restDaysAway ?? MAX_REST));
    const homeRatingPre = home.rating;
    const awayRatingPre = away.rating;
    const homeWinProbPre = 1 / (1 + 10 ** (-(homeRatingPre - awayRatingPre + adj) / 400));
    results.push({ game: g, homeRatingPre, awayRatingPre, homeWinProbPre, restDaysHome, restDaysAway });

    if (g.isFinal && g.homeScore !== null && g.awayScore !== null) {
      const actual = g.homeScore > g.awayScore ? 1 : g.homeScore < g.awayScore ? 0 : 0.5;
      const winnerEdge = actual === 1 ? homeRatingPre - awayRatingPre + adj : awayRatingPre - homeRatingPre - adj;
      const mult = p.mov ? Math.log(Math.abs(g.homeScore - g.awayScore) + 1) * (2.2 / (winnerEdge * 0.001 + 2.2)) : 1;
      const delta = p.k * mult * (actual - homeWinProbPre);
      home.rating += delta;
      away.rating -= delta;
      home.gamesPlayed += 1;
      away.gamesPlayed += 1;
      if (t !== null) {
        lastPlayed.set(g.homeTeam, t);
        lastPlayed.set(g.awayTeam, t);
      }
    }
  }
  return { results, finalRatings: ratings };
}
