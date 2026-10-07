import type { ScheduleGame } from "./nflverse";

// Below this many games, a season average is too small a sample to trust —
// same bar used for every other season-to-date factor in this app (see
// MIN_GAMES_FOR_FACTORS in lib/team-factors.ts).
export const MIN_GAMES_FOR_TOTAL = 3;

export interface TeamScoringState {
  gamesPlayed: number;
  pointsScoredPerGame: number;
  pointsAllowedPerGame: number;
}

/**
 * Season-to-date points scored/allowed per team, straight from this app's
 * own finished-game history (games.homeScore/awayScore) — no new data
 * source needed, since every final score is already stored for Elo replay.
 */
export function computeTeamScoring(games: ScheduleGame[]): Map<string, TeamScoringState> {
  const totals = new Map<string, { games: number; scored: number; allowed: number }>();

  const add = (team: string, scored: number, allowed: number) => {
    const existing = totals.get(team) ?? { games: 0, scored: 0, allowed: 0 };
    existing.games += 1;
    existing.scored += scored;
    existing.allowed += allowed;
    totals.set(team, existing);
  };

  for (const g of games) {
    if (!g.isFinal || g.homeScore === null || g.awayScore === null) continue;
    add(g.homeTeam, g.homeScore, g.awayScore);
    add(g.awayTeam, g.awayScore, g.homeScore);
  }

  const out = new Map<string, TeamScoringState>();
  for (const [team, t] of totals) {
    out.set(team, {
      gamesPlayed: t.games,
      pointsScoredPerGame: t.scored / t.games,
      pointsAllowedPerGame: t.allowed / t.games,
    });
  }
  return out;
}

/**
 * Predicted combined score for one game: each team's expected points is the
 * average of their own scoring rate and the opponent's allowed rate (a
 * standard, simple blend — not a full scoring-drive simulation). Returns
 * null until both teams have MIN_GAMES_FOR_TOTAL games of season history.
 */
export function predictedTotalPoints(
  home: TeamScoringState | undefined,
  away: TeamScoringState | undefined
): number | null {
  if (!home || !away) return null;
  if (home.gamesPlayed < MIN_GAMES_FOR_TOTAL || away.gamesPlayed < MIN_GAMES_FOR_TOTAL) return null;
  const homeExpected = (home.pointsScoredPerGame + away.pointsAllowedPerGame) / 2;
  const awayExpected = (away.pointsScoredPerGame + home.pointsAllowedPerGame) / 2;
  return homeExpected + awayExpected;
}
