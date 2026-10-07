// Standalone historical backtest — run with:
//   npx tsx scripts/backtest.ts
//
// Every cap/reference-gap constant in weather.ts, referee.ts, and
// team-matchup.ts is a documented, honest DEFAULT, not something fit to
// data (the comments in those files say so directly). This script is the
// first real check: replay several already-completed seasons week by week,
// using only data that would have been available BEFORE each game kicked
// off (see the cutoff filtering below — this is not the same as just
// pointing the normal sync at an old season, which would let each factor
// see the whole season's final numbers, including games that hadn't been
// played yet relative to the game being "predicted").
//
// Scope, stated plainly: this backtests Elo + weather + referee + the six
// team factors. ESPN FPI/Total QBR and the injury-report adjustment are
// NOT included — both are inherently "current snapshot" data (today's FPI,
// this week's injury report) that nflverse doesn't let you reconstruct
// point-in-time for a past season without real lookahead bias, so
// backtesting them honestly isn't possible with what's reachable here.
import {
  fetchAllRegSeasonGames,
  fetchPlayerWeekStats,
  fetchTeamWeekStats,
  type ScheduleGame,
  type PlayerWeekStats,
  type TeamWeekStats,
} from "../lib/nflverse";
import { replayElo } from "../lib/elo";
import { computeTeamPassShare } from "../lib/pass-reliance";
import { computeWeatherAdjustment } from "../lib/weather";
import { computeRefereeBias } from "../lib/referee";
import { computeTeamSeasonFactors } from "../lib/team-factors";
import { computeTeamFactorAdjustments } from "../lib/team-matchup";

const SEASONS = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024];

interface GamePrediction {
  season: number;
  week: number;
  actualHomeWin: boolean | null; // null for ties — excluded from grading
  eloOnly: number;
  withWeather: number;
  withReferee: number;
  withTeamFactors: number;
  factorAdj: {
    WEATHER: number;
    REFEREE: number;
    SCHEME_OFF: number;
    SCHEME_DEF: number;
    TURNOVER: number;
    PENALTY: number;
    TRENCHES: number;
    AGGRESSION: number;
  };
}

function accuracyAndBrier(
  rows: GamePrediction[],
  pick: (r: GamePrediction) => number
): { n: number; accuracy: number; brier: number } {
  let correct = 0;
  let sqErr = 0;
  let n = 0;
  for (const r of rows) {
    if (r.actualHomeWin === null) continue;
    const p = Math.max(0.001, Math.min(0.999, pick(r)));
    const predictedHome = p > 0.5;
    if (predictedHome === r.actualHomeWin) correct++;
    const actual = r.actualHomeWin ? 1 : 0;
    sqErr += (p - actual) ** 2;
    n++;
  }
  return { n, accuracy: n > 0 ? correct / n : 0, brier: n > 0 ? sqErr / n : 0 };
}

function hitRate(
  rows: GamePrediction[],
  factor: keyof GamePrediction["factorAdj"]
): { n: number; correct: number; rate: number | null } {
  let n = 0;
  let correct = 0;
  for (const r of rows) {
    const adj = r.factorAdj[factor];
    if (adj === 0 || r.actualHomeWin === null) continue;
    n++;
    const favoredHome = adj > 0;
    if (favoredHome === r.actualHomeWin) correct++;
  }
  return { n, correct, rate: n > 0 ? correct / n : null };
}

async function main() {
  console.log(`Backtesting ${SEASONS.length} seasons: ${SEASONS.join(", ")}\n`);

  // One fetch covers every season's full schedule + every game's final
  // referee/score — reused both for the per-season schedule filter and for
  // the referee module's "every game nflverse has on record" input.
  console.log("Fetching full historical schedule (one file, all seasons)...");
  const allGames = await fetchAllRegSeasonGames();

  const allPredictions: GamePrediction[] = [];

  for (const season of SEASONS) {
    process.stdout.write(`Season ${season}: fetching team/player week stats... `);
    const [teamWeekRows, playerWeekRows]: [TeamWeekStats[], PlayerWeekStats[]] =
      await Promise.all([fetchTeamWeekStats(season), fetchPlayerWeekStats(season)]);
    console.log(`${teamWeekRows.length} team-week rows, ${playerWeekRows.length} player-week rows.`);

    const seasonSchedule: ScheduleGame[] = allGames.filter((g) => g.season === season);
    const { results: eloResults } = replayElo(seasonSchedule);

    for (const r of eloResults) {
      const week = r.game.week;

      // Point-in-time cutoffs: only data from STRICTLY EARLIER weeks (this
      // season) or earlier seasons entirely — never the game being
      // predicted or anything after it. This is the whole point of a
      // backtest; skipping it would just be re-measuring lookahead bias.
      const teamStatsCutoff = teamWeekRows.filter((row) => row.week < week);
      const playerStatsCutoff = playerWeekRows.filter((row) => row.week < week);
      const historicalGamesCutoff = allGames.filter(
        (g) => g.season < season || (g.season === season && g.week < week)
      );

      const teamFactors = computeTeamSeasonFactors(teamStatsCutoff);
      const passShareByTeam = computeTeamPassShare(playerStatsCutoff);

      const passShareHome = passShareByTeam.get(r.game.homeTeam) ?? 0.6;
      const passShareAway = passShareByTeam.get(r.game.awayTeam) ?? 0.6;
      const weather = computeWeatherAdjustment(
        r.game.roof,
        r.game.tempF,
        r.game.windMph,
        passShareHome,
        passShareAway
      );
      const ref = computeRefereeBias(r.game.referee, historicalGamesCutoff);
      const factors = computeTeamFactorAdjustments(
        teamFactors.get(r.game.homeTeam),
        teamFactors.get(r.game.awayTeam)
      );

      const actualHomeWin =
        r.game.homeScore !== null && r.game.awayScore !== null && r.game.homeScore !== r.game.awayScore
          ? r.game.homeScore > r.game.awayScore
          : null;

      const eloOnly = r.homeWinProbPre;
      const withWeather = eloOnly + weather.adjPct;
      const withReferee = withWeather + ref.adjPct;
      const withTeamFactors = withReferee + factors.totalAdjPct;

      allPredictions.push({
        season,
        week,
        actualHomeWin,
        eloOnly,
        withWeather,
        withReferee,
        withTeamFactors,
        factorAdj: {
          WEATHER: weather.adjPct,
          REFEREE: ref.adjPct,
          SCHEME_OFF: factors.schemeOffAdjPct,
          SCHEME_DEF: factors.schemeDefAdjPct,
          TURNOVER: factors.turnoverAdjPct,
          PENALTY: factors.penaltyAdjPct,
          TRENCHES: factors.trenchesAdjPct,
          AGGRESSION: factors.aggressionAdjPct,
        },
      });
    }
  }

  console.log(`\n${allPredictions.length} total games backtested.\n`);

  console.log("=== Ablation (cumulative — each stage adds one more factor group) ===");
  const stages: { name: string; pick: (r: GamePrediction) => number }[] = [
    { name: "Elo only", pick: (r) => r.eloOnly },
    { name: "+ Weather", pick: (r) => r.withWeather },
    { name: "+ Referee", pick: (r) => r.withReferee },
    { name: "+ Team factors (6)", pick: (r) => r.withTeamFactors },
  ];
  for (const stage of stages) {
    const { n, accuracy, brier } = accuracyAndBrier(allPredictions, stage.pick);
    console.log(
      `  ${stage.name.padEnd(20)} n=${n}  accuracy=${(accuracy * 100).toFixed(2)}%  brier=${brier.toFixed(4)}  (lower brier = better calibrated)`
    );
  }

  console.log("\n=== Per-factor hit rate (only counted when that factor was actually nonzero) ===");
  const factorKeys: (keyof GamePrediction["factorAdj"])[] = [
    "WEATHER",
    "REFEREE",
    "SCHEME_OFF",
    "SCHEME_DEF",
    "TURNOVER",
    "PENALTY",
    "TRENCHES",
    "AGGRESSION",
  ];
  for (const factor of factorKeys) {
    const { n, correct, rate } = hitRate(allPredictions, factor);
    console.log(
      `  ${factor.padEnd(12)} n=${n}  correct=${correct}  hit rate=${rate !== null ? (rate * 100).toFixed(1) + "%" : "—"}`
    );
  }

  console.log(
    "\n=== Cap sensitivity sweep (APPROXIMATE — rescales each already-computed, already-capped\n" +
      "    adjPct by a multiplier rather than fully re-deriving from the raw deviation at a new\n" +
      "    cap; exact for an unsaturated or already-saturated game, approximate only for a game\n" +
      "    that would newly saturate at the smaller cap. Good enough to tell direction and rough\n" +
      "    magnitude, not precise enough to hand-tune the last decimal.) ==="
  );
  const multipliers = [0, 0.5, 1, 1.5, 2];
  const sweepGroups: { name: string; get: (r: GamePrediction) => number }[] = [
    { name: "WEATHER (current cap 0.03)", get: (r) => r.factorAdj.WEATHER },
    { name: "REFEREE (current cap 0.02)", get: (r) => r.factorAdj.REFEREE },
    {
      name: "TEAM FACTORS, combined (current cap 0.06)",
      get: (r) =>
        r.factorAdj.SCHEME_OFF +
        r.factorAdj.SCHEME_DEF +
        r.factorAdj.TURNOVER +
        r.factorAdj.PENALTY +
        r.factorAdj.TRENCHES +
        r.factorAdj.AGGRESSION,
    },
  ];
  for (const group of sweepGroups) {
    console.log(`\n  ${group.name}`);
    let best: { m: number; brier: number } | null = null;
    for (const m of multipliers) {
      const { accuracy, brier } = accuracyAndBrier(
        allPredictions,
        (r) => r.withTeamFactors - group.get(r) + group.get(r) * m
      );
      const marker = m === 1 ? "  <- current" : "";
      console.log(
        `    x${m.toFixed(1)}: accuracy=${(accuracy * 100).toFixed(2)}%  brier=${brier.toFixed(4)}${marker}`
      );
      if (best === null || brier < best.brier) best = { m, brier };
    }
    console.log(`    best by Brier score: x${best!.m.toFixed(1)}`);
  }
}

main().catch((err) => {
  console.error("Backtest failed:", err);
  process.exit(1);
});
