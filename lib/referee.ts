import type { ScheduleGame } from "./nflverse";

// Research on referee effects on who wins (as opposed to penalty counts or
// total points, where the effect is better-documented) is weak — this
// exists because it was asked for, not because the signal is strong, so it
// stays deliberately small and heavily shrunk toward zero. See the "Referee
// weight" decision in the build notes: a conscious choice to include it
// anyway, kept conservative.
//
// Backtested against 10 completed seasons (2015-2024, point-in-time cutoffs
// — see scripts/backtest.ts): hit rate 50.4% over n=2339, a 95% CI of
// roughly 48.4-52.4% — statistically indistinguishable from a coin flip.
// The raw Brier-score sweep in that same script actually favored a BIGGER
// cap here, but that's almost certainly overfitting the backtest sample
// rather than a real signal, given the hit rate itself shows no edge at
// all — so the honest move is to shrink this factor, not grow it.
const MIN_REF_GAMES = 20; // below this many career games, don't trust this ref's split at all
const MAX_SWING_PCT = 0.01; // halved from 0.02 — backtested hit rate shows no real signal
const SHRINKAGE = 0.5; // regress the raw historical deviation halfway toward zero

export interface RefereeBias {
  gamesCount: number;
  refHomeWinPct: number | null;
  leagueHomeWinPct: number;
  adjPct: number; // signed, home-perspective win% shift
}

/**
 * This referee's career home-team win rate vs. the league-wide baseline,
 * computed from every final game nflverse has on record — shrunk hard and
 * capped small, since a conscientious crew doesn't actually decide many
 * games.
 */
export function computeRefereeBias(
  referee: string | null,
  historicalGames: ScheduleGame[]
): RefereeBias {
  const decided = historicalGames.filter(
    (g) => g.isFinal && g.homeScore !== null && g.awayScore !== null && g.homeScore !== g.awayScore
  );
  const leagueHomeWins = decided.filter((g) => g.homeScore! > g.awayScore!).length;
  const leagueHomeWinPct = decided.length > 0 ? leagueHomeWins / decided.length : 0.5;

  if (!referee) {
    return { gamesCount: 0, refHomeWinPct: null, leagueHomeWinPct, adjPct: 0 };
  }

  const refGames = decided.filter((g) => g.referee === referee);
  if (refGames.length < MIN_REF_GAMES) {
    return { gamesCount: refGames.length, refHomeWinPct: null, leagueHomeWinPct, adjPct: 0 };
  }

  const refHomeWins = refGames.filter((g) => g.homeScore! > g.awayScore!).length;
  const refHomeWinPct = refHomeWins / refGames.length;
  const rawDeviation = refHomeWinPct - leagueHomeWinPct;
  const adjPct = Math.max(-MAX_SWING_PCT, Math.min(MAX_SWING_PCT, rawDeviation * SHRINKAGE));

  return { gamesCount: refGames.length, refHomeWinPct, leagueHomeWinPct, adjPct };
}
