import type { InjuryRow, PlayerWeekStats, ScheduleGame } from "./nflverse";

export interface InjuryImpactRow {
  season: number;
  week: number;
  status: "OUT" | "DOUBTFUL" | "QUESTIONABLE";
  isEstimate: boolean;
  team: string;
  player: string;
  position: string;
  nextOpponent: string | null;
  gameMissedLabel: string | null;
  anticipatedReturn: string | null;
  method: string;
  seasonEpaShare: number | null;
  winPctWithPlayer: number | null;
  winPctWithoutPlayer: number | null;
  winPctImpact: number | null;
}

const STATUS_MAP: Record<InjuryRow["status"], InjuryImpactRow["status"]> = {
  Out: "OUT",
  Doubtful: "DOUBTFUL",
  Questionable: "QUESTIONABLE",
};

// A backtested QB-change effect isn't re-derivable outside the original
// Sheet's own historical grading — this constant is a documented, honest
// placeholder (a backup QB a team expects to be meaningfully worse than
// their starter) until you backtest your own number from this app's own
// Model Tracker history.
const QB_OUT_WIN_PCT_IMPACT = -0.12;

// Skill-position players below this many tracked EPA snaps this season
// don't have enough signal for a real share estimate — matches the honest
// "not enough tracked production yet" fallback from the original Sheet.
const MIN_EPA_SAMPLE = 0;

function findNextGameAfter(
  team: string,
  afterDate: string | null,
  schedule: ScheduleGame[]
): ScheduleGame | null {
  const upcoming = schedule
    .filter(
      (g) =>
        (g.homeTeam === team || g.awayTeam === team) &&
        (!afterDate || (g.gameDate ?? "") > afterDate)
    )
    .sort((a, b) => (a.gameDate ?? "").localeCompare(b.gameDate ?? ""));
  return upcoming[0] ?? null;
}

export function computeInjuryImpact(
  injuries: InjuryRow[],
  schedule: ScheduleGame[],
  playerStats: PlayerWeekStats[]
): InjuryImpactRow[] {
  // Team's total positive-EPA pool this season — the denominator for a
  // player's "share" of the offense. Using only positive-EPA plays avoids
  // a team with a negative season-EPA total silently zeroing out every
  // player's share (the same bug fixed in the original Sheet project).
  const teamPositiveEpa = new Map<string, number>();
  const playerSeasonEpa = new Map<string, number>(); // key: team|player
  const playerSampleCount = new Map<string, number>();

  for (const row of playerStats) {
    if (row.epa > 0) {
      teamPositiveEpa.set(row.team, (teamPositiveEpa.get(row.team) ?? 0) + row.epa);
    }
    const key = `${row.team}|${row.player}`;
    playerSeasonEpa.set(key, (playerSeasonEpa.get(key) ?? 0) + row.epa);
    playerSampleCount.set(key, (playerSampleCount.get(key) ?? 0) + 1);
  }

  const out: InjuryImpactRow[] = [];

  for (const injury of injuries) {
    const game = findNextGameAfter(injury.team, null, schedule);
    const nextOpponent = game
      ? game.homeTeam === injury.team
        ? game.awayTeam
        : game.homeTeam
      : null;
    const gameMissedLabel = game ? `Wk ${game.week} — ${game.gameDate ?? "TBD"}` : null;
    const nextNextGame = game ? findNextGameAfter(injury.team, game.gameDate, schedule) : null;
    const anticipatedReturn = nextNextGame
      ? `Wk ${nextNextGame.week} — ${nextNextGame.gameDate ?? "TBD"}`
      : "No further game scheduled yet";

    const base: Omit<
      InjuryImpactRow,
      "method" | "seasonEpaShare" | "winPctWithPlayer" | "winPctWithoutPlayer" | "winPctImpact"
    > = {
      season: injury.season,
      week: injury.week,
      status: STATUS_MAP[injury.status],
      isEstimate: injury.isEstimate,
      team: injury.team,
      player: injury.player,
      position: injury.position,
      nextOpponent,
      gameMissedLabel,
      anticipatedReturn,
    };

    if (injury.position === "QB") {
      out.push({
        ...base,
        method: "QB change (documented placeholder — backtest your own from Model Tracker)",
        seasonEpaShare: null,
        winPctWithPlayer: null,
        winPctWithoutPlayer: null,
        winPctImpact: QB_OUT_WIN_PCT_IMPACT,
      });
      continue;
    }

    if (["RB", "WR", "TE"].includes(injury.position)) {
      const key = `${injury.team}|${injury.player}`;
      const playerEpa = playerSeasonEpa.get(key) ?? 0;
      const samples = playerSampleCount.get(key) ?? 0;
      const teamEpa = teamPositiveEpa.get(injury.team) ?? 0;

      if (samples <= MIN_EPA_SAMPLE || playerEpa <= 0 || teamEpa <= 0) {
        out.push({
          ...base,
          method: "Not enough tracked production yet this season to estimate",
          seasonEpaShare: null,
          winPctWithPlayer: null,
          winPctWithoutPlayer: null,
          winPctImpact: null,
        });
        continue;
      }

      const share = playerEpa / teamEpa;
      // A missing skill player isn't replaced by a league-average starter —
      // assume a replacement-level backup recovers roughly half the lost
      // production share. Same documented assumption as the Sheet version.
      const winPctImpact = -(share * 0.5);

      out.push({
        ...base,
        method: "Season EPA share estimate (not backtested)",
        seasonEpaShare: share,
        winPctWithPlayer: null,
        winPctWithoutPlayer: null,
        winPctImpact,
      });
      continue;
    }

    out.push({
      ...base,
      method: "Out of scope — no reliable per-player win % attribution for this position yet",
      seasonEpaShare: null,
      winPctWithPlayer: null,
      winPctWithoutPlayer: null,
      winPctImpact: null,
    });
  }

  return out;
}
