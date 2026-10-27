// Win streaks (1.34.0): the current streak, the longest winning streak and
// the history of streaks, for any ordered list of wins and losses. Used for
// teams (matchup pages) and for our own picks (Results).
//
// Teams' streaks are shown, not fed into the game model: on 2025-26 games
// (about 2,500 MLB and 2,500 college football, fewer NBA/NHL/WNBA), teams on
// long winning or losing streaks won no more or less often than their Elo
// rating already said (within +/-2-4 points, in both directions); Elo already
// moves after every result, so the streak adds nothing it hasn't counted.
// Client-safe: no server imports.

export interface StreakRun {
  win: boolean;
  length: number;
  /** First and last item's label (e.g. a date), when given. */
  from?: string;
  to?: string;
}

export interface StreakSummary {
  /** Current run: positive = wins, negative = losses, 0 = nothing yet. */
  current: number;
  longestWin: number;
  longestLoss: number;
  /** Runs, most recent first. */
  history: StreakRun[];
}

/** Results in time order (oldest first). */
export function streaks(results: { win: boolean; label?: string }[], keepRuns = 12): StreakSummary {
  const runs: StreakRun[] = [];
  for (const r of results) {
    const last = runs[runs.length - 1];
    if (last && last.win === r.win) {
      last.length++;
      last.to = r.label ?? last.to;
    } else runs.push({ win: r.win, length: 1, from: r.label, to: r.label });
  }
  const last = runs[runs.length - 1];
  return {
    current: last ? (last.win ? last.length : -last.length) : 0,
    longestWin: Math.max(0, ...runs.filter((r) => r.win).map((r) => r.length)),
    longestLoss: Math.max(0, ...runs.filter((r) => !r.win).map((r) => r.length)),
    history: runs.slice(-keepRuns).reverse(),
  };
}

export const streakLabel = (n: number) => (n > 0 ? `W${n}` : n < 0 ? `L${-n}` : "—");
