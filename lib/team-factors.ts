import type { TeamWeekStats } from "./nflverse";

// Below this many games, a season average is too small a sample to trust —
// same reasoning as MIN_GAMES_FOR_PROJECTION in lib/props-model.ts.
export const MIN_GAMES_FOR_FACTORS = 3;

export interface TeamSeasonFactors {
  team: string;
  gamesPlayed: number;
  offEpaPerGame: number; // offensive scheme proxy — this team's own output
  defEpaAllowedPerGame: number; // defensive scheme proxy — what their defense allows
  turnoverMarginPerGame: number;
  penaltiesPerGame: number;
  sacksAllowedPerGame: number; // O-line proxy, higher = worse pass protection
  pressuresPerGame: number; // D-line proxy, higher = better pass rush
  twoPtPerGame: number; // aggressiveness proxy (conversions made, not attempted)
}

/**
 * Season-to-date per-game team factors from nflverse's team-week file.
 * defEpaAllowedPerGame needs a join nflverse doesn't hand you directly: a
 * team's own row only has its OWN offensive output, so "what did this
 * defense allow" comes from the opponent's row that same week.
 */
export function computeTeamSeasonFactors(rows: TeamWeekStats[]): Map<string, TeamSeasonFactors> {
  const offEpaByTeamWeek = new Map<string, number>(); // key: season|week|team -> that team's own offEpa
  for (const r of rows) {
    offEpaByTeamWeek.set(`${r.season}|${r.week}|${r.team}`, r.offEpa);
  }

  const totals = new Map<
    string,
    {
      games: number;
      offEpa: number;
      defEpaAllowed: number;
      turnoverMargin: number;
      penalties: number;
      sacksAllowed: number;
      pressures: number;
      twoPt: number;
    }
  >();

  for (const r of rows) {
    const existing = totals.get(r.team) ?? {
      games: 0,
      offEpa: 0,
      defEpaAllowed: 0,
      turnoverMargin: 0,
      penalties: 0,
      sacksAllowed: 0,
      pressures: 0,
      twoPt: 0,
    };
    const opponentOffEpa = offEpaByTeamWeek.get(`${r.season}|${r.week}|${r.opponentTeam}`) ?? 0;

    existing.games += 1;
    existing.offEpa += r.offEpa;
    existing.defEpaAllowed += opponentOffEpa;
    existing.turnoverMargin += r.takeaways - r.giveaways;
    existing.penalties += r.penalties;
    existing.sacksAllowed += r.sacksAllowed;
    existing.pressures += r.pressuresGenerated;
    existing.twoPt += r.twoPtConversions;
    totals.set(r.team, existing);
  }

  const out = new Map<string, TeamSeasonFactors>();
  for (const [team, t] of totals) {
    out.set(team, {
      team,
      gamesPlayed: t.games,
      offEpaPerGame: t.offEpa / t.games,
      defEpaAllowedPerGame: t.defEpaAllowed / t.games,
      turnoverMarginPerGame: t.turnoverMargin / t.games,
      penaltiesPerGame: t.penalties / t.games,
      sacksAllowedPerGame: t.sacksAllowed / t.games,
      pressuresPerGame: t.pressures / t.games,
      twoPtPerGame: t.twoPt / t.games,
    });
  }
  return out;
}
