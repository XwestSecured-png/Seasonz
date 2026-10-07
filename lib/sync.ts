import { db } from "@/db";
import {
  games,
  teamEloRatings,
  teamMetrics,
  injuryReports,
  syncRuns,
  oddsLines,
  propLinesRaw,
  parlayPicks,
  factorSnapshots,
  lineHistory,
  userBets,
} from "@/db/schema";
import {
  fetchSchedule,
  fetchInjuries,
  fetchPlayerWeekStats,
  fetchDefPlayerWeekStats,
  fetchAllRegSeasonGames,
  fetchTeamWeekStats,
} from "./nflverse";
import { replayElo, type EloGameResult } from "./elo";
import type { ScheduleGame } from "./nflverse";
import { computeInjuryImpact, type InjuryImpactRow } from "./injury-impact";
import { sumTeamInjuryImpact, computeInjuryAdjustment } from "./injury-adjustment";
import {
  fetchUpcomingEvents,
  fetchEventPlayerProps,
  fetchGameOdds,
  hasOddsApiKey,
  hasAnyOddsProvider,
  oddsApiKeyStatus,
} from "./odds";
import { resetOddsProviderTracking, didUseSportsGameOddsFallback } from "./sportsgameodds";
import { computeGameEdge } from "./game-picks";
import { computeTeamScoring, predictedTotalPoints } from "./scoring-model";
import { computeSpreadEdge, computeTotalEdge, pickBestMarket } from "./spread-total-picks";
import { computeTeamPassShare } from "./pass-reliance";
import { computeWeatherAdjustment } from "./weather";
import { fetchWeatherForecast } from "./weather-forecast";
import { STADIUM_COORDS } from "./stadium-coords";
import { computeRestTravelAdjustments } from "./rest-travel";
import { computeRefereeBias } from "./referee";
import { computeTeamSeasonFactors } from "./team-factors";
import { computeTeamFactorAdjustments } from "./team-matchup";
import { fetchTeamFpi, fetchTeamQbr } from "./espn";
import { computeEspnFactorAdjustments } from "./espn-factors";
import {
  computeSeasonAverages,
  buildPropPicks,
  buildAutoParlays,
  americanToImpliedProb,
  computeTdProjections,
  computeTurnoverProjections,
  computeDefensiveProjections,
} from "./props-model";
import { getTeamByFullName } from "./team-colors";
import { gradeBet } from "./bet-grading";
import { MIN_MODEL_WIN_PCT } from "./confidence";
import { sql, eq, and, desc } from "drizzle-orm";

export interface SyncStageResult {
  stage: string;
  status: "ok" | "error" | "skipped";
  detail: string;
}

/**
 * Appends a line_history row for (gameId, market) only when the line or
 * either side's price actually changed since the last snapshot — so routine
 * re-syncs that see the same number don't flood the table. See
 * db/schema.ts's lineHistory.
 */
async function recordLineMovement(
  gameId: number,
  market: "ML" | "SPREAD" | "TOTAL",
  line: number | null,
  homePriceAmerican: number | null,
  awayPriceAmerican: number | null
): Promise<void> {
  const [last] = await db
    .select()
    .from(lineHistory)
    .where(and(eq(lineHistory.gameId, gameId), eq(lineHistory.market, market)))
    .orderBy(desc(lineHistory.recordedAt))
    .limit(1);

  const changed =
    !last ||
    last.line !== line ||
    last.homePriceAmerican !== homePriceAmerican ||
    last.awayPriceAmerican !== awayPriceAmerican;
  if (!changed) return;

  await db.insert(lineHistory).values({ gameId, market, line, homePriceAmerican, awayPriceAmerican });
}

async function logStage(
  stage: string,
  fn: () => Promise<string>
): Promise<SyncStageResult> {
  const startedAt = new Date();
  try {
    const detail = await fn();
    await db.insert(syncRuns).values({
      startedAt,
      finishedAt: new Date(),
      stage,
      status: "ok",
      detail,
    });
    return { stage, status: "ok", detail };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await db.insert(syncRuns).values({
      startedAt,
      finishedAt: new Date(),
      stage,
      status: "error",
      detail,
    });
    return { stage, status: "error", detail };
  }
}

// A short suffix for a stage's log line saying which odds provider/key
// actually served this run's data — e.g. " (using key 2 of 3)" when The
// Odds API rotated keys, or " (via SportsGameOdds fallback)" when The Odds
// API was unconfigured/exhausted and the fallback provider stepped in.
function oddsProviderNote(): string {
  if (didUseSportsGameOddsFallback()) return " (via SportsGameOdds fallback)";
  const keyStatus = oddsApiKeyStatus();
  return keyStatus.label ? ` (using ${keyStatus.label}, key ${keyStatus.active} of ${keyStatus.total})` : "";
}

async function logSkip(stage: string, detail: string): Promise<SyncStageResult> {
  const now = new Date();
  await db.insert(syncRuns).values({
    startedAt: now,
    finishedAt: now,
    stage,
    status: "skipped",
    detail,
  });
  return { stage, status: "skipped", detail };
}

/**
 * Full data refresh for one season: schedule -> Elo -> team metrics ->
 * injuries. Mirrors runFullModelUpdate_() from the Google Sheet version,
 * but runs as a normal server-side job (triggered by Vercel Cron or on
 * demand) rather than needing an Apps Script trigger.
 */
export async function runFullSync(season: number): Promise<SyncStageResult[]> {
  const results: SyncStageResult[] = [];

  let schedule: Awaited<ReturnType<typeof fetchSchedule>> = [];
  let eloResults: EloGameResult<ScheduleGame>[] = [];
  // The model's final, fully-adjusted pre-game home win% per game (Elo plus
  // the weather/referee nudges computed in the "elo" stage below) — the
  // gameOdds stage reads from this, not raw Elo, so a value pick is judged
  // against the same number that actually gets graded.
  const finalHomeWinPctByGame = new Map<string, number>();
  // Database id per (season, week, home, away) — the odds/line-history
  // writes below match games by those four fields (like every other sync
  // stage), but line_history and user_bets need the actual numeric id as a
  // foreign key, so this is populated once right after the schedule upsert.
  const gameIdByKey = new Map<string, number>();
  // Computed once in the "elo" stage, reused by "injuryImpact" below so that
  // stage doesn't need to refetch injuries/player-stats it already has.
  let impactRows: InjuryImpactRow[] = [];

  results.push(
    await logStage("schedule", async () => {
      schedule = await fetchSchedule(season);
      let forecastCount = 0;
      for (const g of schedule) {
        // nflverse's tempF/windMph are the game's ACTUAL conditions, only
        // ever published once it's been played — so for an upcoming game
        // they're null, and the weather adjustment (lib/weather.ts) would
        // silently do nothing. Fill that gap with a free Open-Meteo
        // forecast for the hour nearest kickoff, for any outdoor stadium
        // within its ~16-day forecast window. Once nflverse publishes the
        // real reading after the game, g.tempF/g.windMph above are no
        // longer null and simply win out below — no special-casing needed.
        let tempF = g.tempF;
        let windMph = g.windMph;
        let precipPct: number | null = null;
        let weatherIsForecast = false;
        if (
          tempF === null &&
          windMph === null &&
          !g.isFinal &&
          g.kickoffAt &&
          !(g.roof === "dome" || g.roof === "closed") &&
          !STADIUM_COORDS[g.homeTeam]?.indoor
        ) {
          const coord = STADIUM_COORDS[g.homeTeam];
          if (coord) {
            const forecast = await fetchWeatherForecast(coord.lat, coord.lon, g.kickoffAt);
            if (forecast) {
              tempF = forecast.tempF;
              windMph = forecast.windMph;
              precipPct = forecast.precipPct;
              weatherIsForecast = true;
              forecastCount++;
            }
          }
        }

        // Mutate the in-memory schedule entry itself (not just the DB write
        // below) — replayElo (called later in this same sync run, in the
        // "elo" stage) reads tempF/windMph/precipPct straight off this same
        // `schedule` array to compute weatherAdjPct, so without this the
        // forecast would only ever reach the database/display and never
        // the actual win-probability calculation.
        g.tempF = tempF;
        g.windMph = windMph;
        g.precipPct = precipPct;

        await db
          .insert(games)
          .values({
            season: g.season,
            week: g.week,
            gameDate: g.gameDate,
            kickoffAt: g.kickoffAt,
            homeTeam: g.homeTeam,
            awayTeam: g.awayTeam,
            homeScore: g.homeScore,
            awayScore: g.awayScore,
            isFinal: g.isFinal,
            roof: g.roof,
            surface: g.surface,
            tempF,
            windMph,
            weatherIsForecast,
            precipPct,
            referee: g.referee,
          })
          .onConflictDoUpdate({
            target: [games.season, games.week, games.homeTeam, games.awayTeam],
            set: {
              gameDate: g.gameDate,
              kickoffAt: g.kickoffAt,
              homeScore: g.homeScore,
              awayScore: g.awayScore,
              isFinal: g.isFinal,
              roof: g.roof,
              surface: g.surface,
              tempF,
              windMph,
              weatherIsForecast,
              precipPct,
              referee: g.referee,
              updatedAt: new Date(),
            },
          });
      }
      const idRows = await db
        .select({ id: games.id, season: games.season, week: games.week, homeTeam: games.homeTeam, awayTeam: games.awayTeam })
        .from(games)
        .where(sql`${games.season} = ${season}`);
      for (const r of idRows) {
        gameIdByKey.set(`${r.season}|${r.week}|${r.homeTeam}|${r.awayTeam}`, r.id);
      }

      return `${schedule.length} game(s) synced for ${season}${
        forecastCount > 0 ? ` (${forecastCount} with a pre-game weather forecast)` : ""
      }.`;
    })
  );

  results.push(
    await logStage("gradeBets", async () => {
      const finalByKey = new Map(
        schedule
          .filter((g) => g.isFinal && g.homeScore !== null && g.awayScore !== null)
          .map((g) => [`${g.season}|${g.week}|${g.homeTeam}|${g.awayTeam}`, g])
      );
      if (finalByKey.size === 0) return "No final games to grade bets against.";

      const pending = await db.select().from(userBets).where(eq(userBets.result, "PENDING"));
      if (pending.length === 0) return "No pending bets to grade.";

      let graded = 0;
      for (const bet of pending) {
        const [game] = await db.select().from(games).where(eq(games.id, bet.gameId));
        if (!game) continue;
        const finalGame = finalByKey.get(`${game.season}|${game.week}|${game.homeTeam}|${game.awayTeam}`);
        if (!finalGame || finalGame.homeScore === null || finalGame.awayScore === null) continue;

        const { result, payoutUsd } = gradeBet(
          { market: bet.market, selection: bet.selection, line: bet.line, priceAmerican: bet.priceAmerican, stakeUsd: bet.stakeUsd },
          { homeTeam: game.homeTeam, awayTeam: game.awayTeam, homeScore: finalGame.homeScore, awayScore: finalGame.awayScore }
        );
        await db
          .update(userBets)
          .set({ result, payoutUsd, gradedAt: new Date() })
          .where(eq(userBets.id, bet.id));
        graded++;
      }
      return `${graded} pending bet(s) graded against final scores.`;
    })
  );

  results.push(
    await logStage("elo", async () => {
      const { results, finalRatings } = replayElo(schedule);
      eloResults = results;

      // Weather needs each team's season-to-date pass reliance; referee bias
      // needs the full historical record, not just this season; the six
      // team-factor adjustments need the team-week stats file; injuries need
      // this week's report — all free nflverse data, no odds key required.
      const [playerStats, historicalGames, teamWeekStats, injuries] = await Promise.all([
        fetchPlayerWeekStats(season),
        fetchAllRegSeasonGames(),
        fetchTeamWeekStats(season),
        fetchInjuries(season),
      ]);
      const passShareByTeam = computeTeamPassShare(playerStats);
      const teamFactors = computeTeamSeasonFactors(teamWeekStats);

      // Computed here (not in the old standalone "injuryImpact" stage) so the
      // same impact numbers can both feed the win% adjustment below AND get
      // written to injuryReports later, without fetching injuries twice.
      impactRows = computeInjuryImpact(injuries, schedule, playerStats);
      const injuryImpactByTeam = sumTeamInjuryImpact(impactRows);
      // The injury report is only ever "this week's" — never apply it to an
      // already-final game (no history) or to a future game beyond the very
      // next one for each team.
      const injuryReportWeek =
        injuries.length > 0 ? Math.max(...injuries.map((i) => i.week)) : null;

      // ESPN's FPI (season-level) and Total QBR (per-week) — both best-effort:
      // an undocumented API that this sandbox can't reach to pre-validate
      // (see lib/espn.ts), so any failure here degrades to "no ESPN
      // adjustment this run" rather than failing the whole elo stage.
      let espnFpiMap = new Map<string, import("./espn").TeamFpi>();
      let espnError: string | null = null;
      try {
        espnFpiMap = await fetchTeamFpi(season);
      } catch (err) {
        espnError = err instanceof Error ? err.message : String(err);
      }

      const weeksNeeded = Array.from(new Set(eloResults.map((r) => r.game.week)));
      const espnQbrByWeek = new Map<number, Map<string, number>>();
      let qbrFailures = 0;
      await Promise.all(
        weeksNeeded.map(async (wk) => {
          try {
            espnQbrByWeek.set(wk, await fetchTeamQbr(season, wk));
          } catch {
            qbrFailures++;
            espnQbrByWeek.set(wk, new Map());
          }
        })
      );
      if (espnFpiMap.size === 0 && espnError === null) {
        espnError = "ESPN FPI response had no usable team entries";
      }

      const restTravelByGame = computeRestTravelAdjustments(schedule);

      let weatherAdjusted = 0;
      let restTravelAdjusted = 0;
      let refAdjusted = 0;
      let factorsAdjusted = 0;
      let espnAdjusted = 0;
      let injuryAdjusted = 0;
      let snapshotsWritten = 0;
      for (const r of eloResults) {
        const passShareHome = passShareByTeam.get(r.game.homeTeam) ?? 0.6;
        const passShareAway = passShareByTeam.get(r.game.awayTeam) ?? 0.6;
        const weather = computeWeatherAdjustment(
          r.game.roof,
          r.game.tempF,
          r.game.windMph,
          passShareHome,
          passShareAway,
          r.game.precipPct
        );
        const ref = computeRefereeBias(r.game.referee, historicalGames);
        const restTravel =
          restTravelByGame.get(`${r.game.season}|${r.game.week}|${r.game.homeTeam}|${r.game.awayTeam}`) ??
          null;
        const restTravelAdjPct = restTravel?.adjPct ?? 0;
        const factors = computeTeamFactorAdjustments(
          teamFactors.get(r.game.homeTeam),
          teamFactors.get(r.game.awayTeam)
        );
        const homeFpi = espnFpiMap.get(r.game.homeTeam);
        const awayFpi = espnFpiMap.get(r.game.awayTeam);
        const qbrThisWeek = espnQbrByWeek.get(r.game.week);
        const homeQbr = qbrThisWeek?.get(r.game.homeTeam);
        const awayQbr = qbrThisWeek?.get(r.game.awayTeam);
        const espn = computeEspnFactorAdjustments(homeFpi, awayFpi, homeQbr, awayQbr);

        const homeInjuryImpact = injuryImpactByTeam.get(r.game.homeTeam) ?? 0;
        const awayInjuryImpact = injuryImpactByTeam.get(r.game.awayTeam) ?? 0;
        const injuryApplies = !r.game.isFinal && r.game.week === injuryReportWeek;
        const injuryAdjPct = injuryApplies
          ? computeInjuryAdjustment(homeInjuryImpact, awayInjuryImpact)
          : 0;

        if (weather.severity > 0) weatherAdjusted++;
        if (restTravelAdjPct !== 0) restTravelAdjusted++;
        if (ref.adjPct !== 0) refAdjusted++;
        if (factors.totalAdjPct !== 0) factorsAdjusted++;
        if (espn.totalAdjPct !== 0) espnAdjusted++;
        if (injuryAdjPct !== 0) injuryAdjusted++;

        const finalHomeWinPct = Math.max(
          0.02,
          Math.min(
            0.98,
            r.homeWinProbPre +
              weather.adjPct +
              restTravelAdjPct +
              ref.adjPct +
              factors.totalAdjPct +
              espn.totalAdjPct +
              injuryAdjPct
          )
        );
        finalHomeWinPctByGame.set(
          `${r.game.season}|${r.game.week}|${r.game.homeTeam}|${r.game.awayTeam}`,
          finalHomeWinPct
        );

        const [updated] = await db
          .update(games)
          .set({
            eloHomePre: r.homeRatingPre,
            eloAwayPre: r.awayRatingPre,
            homeWinPctPre: finalHomeWinPct,
            weatherAdjPct: weather.adjPct,
            restTravelAdjPct,
            refAdjPct: ref.adjPct,
            schemeOffAdjPct: factors.schemeOffAdjPct,
            schemeDefAdjPct: factors.schemeDefAdjPct,
            turnoverAdjPct: factors.turnoverAdjPct,
            penaltyAdjPct: factors.penaltyAdjPct,
            trenchesAdjPct: factors.trenchesAdjPct,
            aggressionAdjPct: factors.aggressionAdjPct,
            fpiHome: homeFpi?.fpi ?? null,
            fpiAway: awayFpi?.fpi ?? null,
            sosHome: homeFpi?.sos ?? null,
            sosAway: awayFpi?.sos ?? null,
            qbrHome: homeQbr ?? null,
            qbrAway: awayQbr ?? null,
            fpiAdjPct: espn.fpiAdjPct,
            qbrAdjPct: espn.qbrAdjPct,
            homeInjuryImpactPct: injuryApplies ? homeInjuryImpact : null,
            awayInjuryImpactPct: injuryApplies ? awayInjuryImpact : null,
            injuryAdjPct,
          })
          .where(
            sql`${games.season} = ${r.game.season} AND ${games.week} = ${r.game.week} AND ${games.homeTeam} = ${r.game.homeTeam} AND ${games.awayTeam} = ${r.game.awayTeam}`
          )
          .returning({ id: games.id });

        // Calibration tracker ("AI learning sheet"): one row per factor that
        // actually moved the needle this game, so Factor Performance can
        // grade — once the game goes final — whether each factor's favored
        // side really did win more often than not. See the "factorGrading"
        // stage below for how these get resolved.
        if (updated) {
          const namedFactors: { factor: string; adjPct: number }[] = [
            { factor: "WEATHER", adjPct: weather.adjPct },
            { factor: "REST_TRAVEL", adjPct: restTravelAdjPct },
            { factor: "REFEREE", adjPct: ref.adjPct },
            { factor: "SCHEME_OFF", adjPct: factors.schemeOffAdjPct },
            { factor: "SCHEME_DEF", adjPct: factors.schemeDefAdjPct },
            { factor: "TURNOVER", adjPct: factors.turnoverAdjPct },
            { factor: "PENALTY", adjPct: factors.penaltyAdjPct },
            { factor: "TRENCHES", adjPct: factors.trenchesAdjPct },
            { factor: "AGGRESSION", adjPct: factors.aggressionAdjPct },
            { factor: "FPI", adjPct: espn.fpiAdjPct },
            { factor: "QBR", adjPct: espn.qbrAdjPct },
            { factor: "INJURY", adjPct: injuryAdjPct },
          ];
          for (const nf of namedFactors) {
            if (nf.adjPct === 0) continue;
            const favoredTeam = nf.adjPct > 0 ? r.game.homeTeam : r.game.awayTeam;
            await db
              .insert(factorSnapshots)
              .values({
                season: r.game.season,
                week: r.game.week,
                gameId: updated.id,
                factor: nf.factor,
                favoredTeam,
              })
              .onConflictDoUpdate({
                target: [
                  factorSnapshots.season,
                  factorSnapshots.week,
                  factorSnapshots.gameId,
                  factorSnapshots.factor,
                ],
                set: { favoredTeam },
                // Never let a re-sync quietly rewrite history on a snapshot
                // that's already been graded against a final score.
                setWhere: sql`${factorSnapshots.resolved} = false`,
              });
            snapshotsWritten++;
          }
        }
      }

      const maxWeek = Math.max(0, ...schedule.map((g) => g.week));
      for (const [team, state] of finalRatings) {
        await db
          .insert(teamEloRatings)
          .values({
            team,
            season,
            week: maxWeek,
            rating: state.rating,
            gamesPlayed: state.gamesPlayed,
          })
          .onConflictDoUpdate({
            target: [teamEloRatings.team, teamEloRatings.season, teamEloRatings.week],
            set: {
              rating: state.rating,
              gamesPlayed: state.gamesPlayed,
            },
          });
      }

      const espnDetail =
        espnError !== null
          ? `ESPN unavailable this run (${espnError}).`
          : `${espnAdjusted} ESPN-adjusted (FPI for ${espnFpiMap.size} team(s)${qbrFailures > 0 ? `, QBR fetch failed for ${qbrFailures} week(s)` : ""}).`;

      return `Elo replayed: ${eloResults.length} game(s), ${finalRatings.size} team(s) rated (${weatherAdjusted} weather-adjusted, ${restTravelAdjusted} rest/travel-adjusted, ${refAdjusted} referee-adjusted, ${factorsAdjusted} team-factor-adjusted, ${injuryAdjusted} injury-adjusted). ${espnDetail} ${snapshotsWritten} factor snapshot(s) recorded for calibration tracking.`;
    })
  );

  results.push(
    await logStage("factorGrading", async () => {
      // Resolve every not-yet-graded factor snapshot whose game has since
      // gone final — this is what turns raw snapshots into the Factor
      // Performance hit-rate table. Ties (home_score = away_score) are left
      // unresolved since there's no "favored team won" answer for them.
      const result = await db.execute(sql`
        UPDATE factor_snapshots fs
        SET resolved = true,
            correct = (
              fs.favored_team = CASE
                WHEN g.home_score > g.away_score THEN g.home_team
                WHEN g.away_score > g.home_score THEN g.away_team
                ELSE NULL
              END
            )
        FROM games g
        WHERE fs.game_id = g.id
          AND fs.resolved = false
          AND g.is_final = true
          AND g.home_score IS NOT NULL
          AND g.away_score IS NOT NULL
          AND g.home_score <> g.away_score
      `);
      const count = (result as unknown as { count?: number }).count ?? 0;
      return `${count} factor snapshot(s) graded against final scores.`;
    })
  );

  results.push(
    await logStage("teamMetrics", async () => {
      const finalGames = schedule.filter((g) => g.isFinal);
      const perTeam = new Map<
        string,
        { wins: number; losses: number; ties: number; homeWins: number; homeGames: number; roadWins: number; roadGames: number }
      >();
      const ensure = (team: string) => {
        const existing = perTeam.get(team);
        if (existing) return existing;
        const fresh = { wins: 0, losses: 0, ties: 0, homeWins: 0, homeGames: 0, roadWins: 0, roadGames: 0 };
        perTeam.set(team, fresh);
        return fresh;
      };

      for (const g of finalGames) {
        const home = ensure(g.homeTeam);
        const away = ensure(g.awayTeam);
        home.homeGames += 1;
        away.roadGames += 1;
        if (g.homeScore! > g.awayScore!) {
          home.wins += 1;
          home.homeWins += 1;
          away.losses += 1;
        } else if (g.homeScore! < g.awayScore!) {
          away.wins += 1;
          away.roadWins += 1;
          home.losses += 1;
        } else {
          home.ties += 1;
          away.ties += 1;
        }
      }

      const maxWeek = Math.max(0, ...schedule.map((g) => g.week));
      for (const [team, rec] of perTeam) {
        const homeWinPct = rec.homeGames > 0 ? rec.homeWins / rec.homeGames : null;
        const roadWinPct = rec.roadGames > 0 ? rec.roadWins / rec.roadGames : null;
        await db
          .insert(teamMetrics)
          .values({
            team,
            season,
            week: maxWeek,
            homeWinPct,
            roadWinPct,
            wins: rec.wins,
            losses: rec.losses,
            ties: rec.ties,
          })
          .onConflictDoUpdate({
            target: [teamMetrics.team, teamMetrics.season, teamMetrics.week],
            set: {
              homeWinPct,
              roadWinPct,
              wins: rec.wins,
              losses: rec.losses,
              ties: rec.ties,
            },
          });
      }

      return `Team metrics computed for ${perTeam.size} team(s).`;
    })
  );

  results.push(
    await logStage("injuryImpact", async () => {
      // impactRows was already computed in the "elo" stage (same injury
      // report, reused here so it isn't fetched twice) and also drives the
      // injuryAdjPct nudge on games — this stage just persists it for the
      // Injury Impact page.
      await db.delete(injuryReports).where(sql`${injuryReports.season} = ${season}`);
      for (const row of impactRows) {
        await db.insert(injuryReports).values(row);
      }

      const counts = { OUT: 0, DOUBTFUL: 0, QUESTIONABLE: 0 };
      for (const r of impactRows) counts[r.status]++;
      return `Injury impact: OUT:${counts.OUT} DOUBTFUL:${counts.DOUBTFUL} QUESTIONABLE:${counts.QUESTIONABLE}.`;
    })
  );

  results.push(
    await logStage("modelProps", async () => {
      // Every stat type written in this stage is a model-only probability
      // with no sportsbook line to compare against (see computeTdProjections
      // in props-model.ts for why), so — unlike the yardage "props" stage
      // below — none of this gates on ODDS_API_KEY; it only needs free
      // nflverse data.
      const upcoming = schedule.filter((g) => !g.isFinal);
      const week =
        upcoming.length > 0
          ? Math.min(...upcoming.map((g) => g.week))
          : Math.max(0, ...schedule.map((g) => g.week)) + 1;

      const [playerStats, defPlayerStats] = await Promise.all([
        fetchPlayerWeekStats(season),
        fetchDefPlayerWeekStats(season),
      ]);

      const tdProjections = computeTdProjections(playerStats);
      const turnovers = computeTurnoverProjections(playerStats);
      const defense = computeDefensiveProjections(defPlayerStats);

      type ModelRow = {
        player: string;
        team: string;
        statType: string;
        line: number;
        probability: number;
        rate: number;
      };
      const rows: ModelRow[] = [];
      for (const p of tdProjections) {
        rows.push({ player: p.player, team: p.team, statType: "Anytime TD", line: 0.5, probability: p.anytimeTdPct, rate: p.tdsPerGame });
        rows.push({ player: p.player, team: p.team, statType: "2+ TDs", line: 1.5, probability: p.multiTdPct, rate: p.tdsPerGame });
      }
      for (const p of turnovers.interceptionsThrown) {
        rows.push({ player: p.player, team: p.team, statType: "INT Thrown", line: 0.5, probability: p.anytimePct, rate: p.ratePerGame });
      }
      for (const p of turnovers.fumblesLost) {
        rows.push({ player: p.player, team: p.team, statType: "Fumble Lost", line: 0.5, probability: p.anytimePct, rate: p.ratePerGame });
      }
      for (const p of turnovers.sacksTaken) {
        rows.push({ player: p.player, team: p.team, statType: "QB Sacked", line: 0.5, probability: p.anytimePct, rate: p.ratePerGame });
      }
      for (const p of defense.anytimeSack) {
        rows.push({ player: p.player, team: p.team, statType: "Anytime Sack", line: 0.5, probability: p.anytimePct, rate: p.ratePerGame });
      }
      for (const p of defense.anytimeInt) {
        rows.push({ player: p.player, team: p.team, statType: "Anytime INT", line: 0.5, probability: p.anytimePct, rate: p.ratePerGame });
      }

      await db
        .delete(oddsLines)
        .where(
          sql`${oddsLines.season} = ${season} AND ${oddsLines.week} = ${week} AND ${oddsLines.book} = 'Model (no book line)'`
        );

      let written = 0;
      for (const row of rows) {
        // Same house-wide "only show real confidence" bar as the yardage
        // props below (see lib/confidence.ts) — these rows already carry a
        // real Poisson probability, so this is a straight comparison, not
        // an approximation.
        if (row.probability < MIN_MODEL_WIN_PCT) continue;
        await db
          .insert(oddsLines)
          .values({
            season,
            week,
            player: row.player,
            team: row.team,
            statType: row.statType,
            line: row.line,
            side: "Over",
            book: "Model (no book line)",
            priceAmerican: null,
            impliedProbPct: null,
            projection: row.rate,
            edgePct: row.probability,
            source: "MODEL",
          })
          .onConflictDoUpdate({
            target: [
              oddsLines.season,
              oddsLines.week,
              oddsLines.player,
              oddsLines.statType,
              oddsLines.book,
            ],
            set: {
              team: row.team,
              line: row.line,
              side: "Over",
              projection: row.rate,
              edgePct: row.probability,
              source: "MODEL",
              fetchedAt: new Date(),
            },
          });
        written++;
      }

      return `Model props: ${written} line(s) written for week ${week} (TD/turnover/defensive categories, ${defPlayerStats.length} defensive-player rows scanned).`;
    })
  );

  if (!hasAnyOddsProvider()) {
    results.push(
      await logSkip(
        "gameOdds",
        "No odds provider configured (ODDS_API_KEY/ODDS_API_KEYS or SPORTSGAMEODDS_API_KEY) — skipping moneyline sync."
      )
    );
  } else {
    resetOddsProviderTracking();
    results.push(
      await logStage("gameOdds", async () => {
        const { moneylines, spreads, totals } = await fetchGameOdds();
        const teamScoring = computeTeamScoring(schedule);

        const keyOf = (home: string, away: string) => `${home}|${away}`;
        const spreadByTeams = new Map<string, (typeof spreads)[number]>();
        for (const s of spreads) {
          const home = getTeamByFullName(s.homeTeam)?.code;
          const away = getTeamByFullName(s.awayTeam)?.code;
          if (home && away) spreadByTeams.set(keyOf(home, away), s);
        }
        const totalByTeams = new Map<string, (typeof totals)[number]>();
        for (const t of totals) {
          const home = getTeamByFullName(t.homeTeam)?.code;
          const away = getTeamByFullName(t.awayTeam)?.code;
          if (home && away) totalByTeams.set(keyOf(home, away), t);
        }

        let matched = 0;
        let picked = 0;
        let bestPicked = 0;
        for (const line of moneylines) {
          const home = getTeamByFullName(line.homeTeam)?.code;
          const away = getTeamByFullName(line.awayTeam)?.code;
          if (!home || !away) continue;
          const game = schedule.find(
            (g) => !g.isFinal && g.homeTeam === home && g.awayTeam === away
          );
          if (!game) continue;

          const modelHomeWinPct = finalHomeWinPctByGame.get(
            `${game.season}|${game.week}|${game.homeTeam}|${game.awayTeam}`
          );
          if (modelHomeWinPct === undefined) continue;

          const { edgePct: mlEdgePct, pickTeam: mlPickTeam, modelProb: mlModelProb } = computeGameEdge(
            modelHomeWinPct,
            line.homePriceAmerican
          );
          const aiPickTeam = mlPickTeam === "HOME" ? home : mlPickTeam === "AWAY" ? away : null;
          if (aiPickTeam) picked++;
          matched++;

          // Spread (ATS) — only computable once a line is posted for this game.
          const spreadLine = spreadByTeams.get(keyOf(home, away));
          const spreadResult = spreadLine
            ? computeSpreadEdge(
                modelHomeWinPct,
                spreadLine.spreadHomeLine,
                spreadLine.homePriceAmerican,
                spreadLine.awayPriceAmerican
              )
            : null;

          // Game total (O/U) — needs both teams' season-to-date scoring AND
          // a posted total line.
          const totalLine = totalByTeams.get(keyOf(home, away));
          const predictedTotal = predictedTotalPoints(
            teamScoring.get(home),
            teamScoring.get(away)
          );
          const totalResult =
            totalLine && predictedTotal !== null
              ? computeTotalEdge(
                  predictedTotal,
                  totalLine.totalLine,
                  totalLine.overPriceAmerican,
                  totalLine.underPriceAmerican
                )
              : null;

          const best = pickBestMarket({
            moneyline: {
              pickTeam: aiPickTeam,
              edgePct: mlEdgePct,
              homeTeam: home,
              awayTeam: away,
              modelProb: mlModelProb,
            },
            spread: spreadResult
              ? { ...spreadResult, homeTeam: home, awayTeam: away, spreadHomeLine: spreadLine!.spreadHomeLine }
              : undefined,
            total: totalResult ? { ...totalResult, totalLine: totalLine!.totalLine } : undefined,
          });
          if (best) bestPicked++;

          // Line history — one row per market, but only when the line (or,
          // for ML, the price) actually moved since the last snapshot, so a
          // week of hourly syncs with no market movement doesn't flood the
          // table. See db/schema.ts's lineHistory for what this feeds.
          const dbGameId = gameIdByKey.get(`${game.season}|${game.week}|${game.homeTeam}|${game.awayTeam}`);
          if (dbGameId !== undefined) {
            await recordLineMovement(dbGameId, "ML", null, line.homePriceAmerican, line.awayPriceAmerican);
            if (spreadLine) {
              await recordLineMovement(
                dbGameId,
                "SPREAD",
                spreadLine.spreadHomeLine,
                spreadLine.homePriceAmerican,
                spreadLine.awayPriceAmerican
              );
            }
            if (totalLine) {
              await recordLineMovement(
                dbGameId,
                "TOTAL",
                totalLine.totalLine,
                totalLine.overPriceAmerican,
                totalLine.underPriceAmerican
              );
            }
          }

          await db
            .update(games)
            .set({
              moneylineHomeOdds: line.homePriceAmerican,
              moneylineAwayOdds: line.awayPriceAmerican,
              moneylineBook: line.book,
              aiEdgePct: mlEdgePct,
              aiPickTeam,
              // Set once, on whichever sync run first sees a line for this
              // game — every later run's COALESCE leaves it untouched, so
              // this stays the TRUE opening number for closing-line-value
              // tracking (see closingLineValuePct in Model Tracker).
              openingMoneylineHomeOdds: sql`COALESCE(${games.openingMoneylineHomeOdds}, ${line.homePriceAmerican})`,
              openingMoneylineAwayOdds: sql`COALESCE(${games.openingMoneylineAwayOdds}, ${line.awayPriceAmerican})`,
              openingMoneylineBook: sql`COALESCE(${games.openingMoneylineBook}, ${line.book})`,

              ...(spreadLine
                ? {
                    spreadHomeLine: spreadLine.spreadHomeLine,
                    spreadHomePriceAmerican: spreadLine.homePriceAmerican,
                    spreadAwayPriceAmerican: spreadLine.awayPriceAmerican,
                    spreadBook: spreadLine.book,
                    openingSpreadHomeLine: sql`COALESCE(${games.openingSpreadHomeLine}, ${spreadLine.spreadHomeLine})`,
                    openingSpreadHomePriceAmerican: sql`COALESCE(${games.openingSpreadHomePriceAmerican}, ${spreadLine.homePriceAmerican})`,
                    openingSpreadAwayPriceAmerican: sql`COALESCE(${games.openingSpreadAwayPriceAmerican}, ${spreadLine.awayPriceAmerican})`,
                    openingSpreadBook: sql`COALESCE(${games.openingSpreadBook}, ${spreadLine.book})`,
                    spreadAiEdgePct: spreadResult?.edgePct ?? null,
                    spreadAiPickTeam: spreadResult?.pickTeam
                      ? spreadResult.pickTeam === "HOME"
                        ? home
                        : away
                      : null,
                  }
                : {}),

              ...(totalLine
                ? {
                    totalLine: totalLine.totalLine,
                    totalOverPriceAmerican: totalLine.overPriceAmerican,
                    totalUnderPriceAmerican: totalLine.underPriceAmerican,
                    totalBook: totalLine.book,
                    openingTotalLine: sql`COALESCE(${games.openingTotalLine}, ${totalLine.totalLine})`,
                    openingTotalOverPriceAmerican: sql`COALESCE(${games.openingTotalOverPriceAmerican}, ${totalLine.overPriceAmerican})`,
                    openingTotalUnderPriceAmerican: sql`COALESCE(${games.openingTotalUnderPriceAmerican}, ${totalLine.underPriceAmerican})`,
                    openingTotalBook: sql`COALESCE(${games.openingTotalBook}, ${totalLine.book})`,
                    totalAiEdgePct: totalResult?.edgePct ?? null,
                    totalAiPick: totalResult?.pick ?? null,
                  }
                : {}),

              bestMarket: best?.market ?? null,
              bestMarketLabel: best?.label ?? null,
              bestMarketEdgePct: best?.edgePct ?? null,
              bestMarketConfidencePct: best?.modelProb ?? null,
            })
            .where(
              sql`${games.season} = ${game.season} AND ${games.week} = ${game.week} AND ${games.homeTeam} = ${game.homeTeam} AND ${games.awayTeam} = ${game.awayTeam}`
            );
        }

        const keyNote = oddsProviderNote();
        return `Game odds matched for ${matched} game(s): ${picked} moneyline edge(s), ${bestPicked} with a best-market recommendation (ML/spread/total).${keyNote}`;
      })
    );
  }

  if (!hasAnyOddsProvider()) {
    results.push(
      await logSkip(
        "props",
        "No odds provider configured (ODDS_API_KEY/ODDS_API_KEYS or SPORTSGAMEODDS_API_KEY) — skipping player prop sync."
      )
    );
  } else {
    resetOddsProviderTracking();
    results.push(
      await logStage("props", async () => {
        const upcoming = schedule.filter((g) => !g.isFinal);
        const week =
          upcoming.length > 0
            ? Math.min(...upcoming.map((g) => g.week))
            : Math.max(0, ...schedule.map((g) => g.week)) + 1;
        const thisWeekGames = upcoming.filter((g) => g.week === week);

        const events = await fetchUpcomingEvents();
        const thisWeekEvents = events.filter((e) => {
          const home = getTeamByFullName(e.home_team)?.code;
          const away = getTeamByFullName(e.away_team)?.code;
          if (!home || !away) return false;
          return thisWeekGames.some(
            (g) =>
              (g.homeTeam === home && g.awayTeam === away) ||
              (g.homeTeam === away && g.awayTeam === home)
          );
        });

        const propsByEvent = await Promise.all(
          thisWeekEvents.map((e) => fetchEventPlayerProps(e.id))
        );
        const allProps = propsByEvent.flat();

        const playerStats = await fetchPlayerWeekStats(season);
        const averages = computeSeasonAverages(playerStats, schedule, week);

        // A player marked OUT or DOUBTFUL for this game shouldn't get a prop
        // pick at all — their season stats say nothing about a game they
        // aren't (or probably aren't) playing in. impactRows is this week's
        // real injury-impact list, already computed in the "elo" stage above.
        // QUESTIONABLE stays in — uncertain, not excluded — same line this
        // app's injury-impact modeling already draws elsewhere.
        const unavailable = new Set(
          impactRows
            .filter((r) => r.status === "OUT" || r.status === "DOUBTFUL")
            .map((r) => `${r.team}|${r.player}`)
        );
        const picks = buildPropPicks(allProps, averages, schedule, week, unavailable);

        await db
          .delete(oddsLines)
          .where(sql`${oddsLines.season} = ${season} AND ${oddsLines.week} = ${week}`);
        for (const p of picks) {
          const impliedProbPct = americanToImpliedProb(p.priceAmerican) * 100;
          await db
            .insert(oddsLines)
            .values({
              season,
              week,
              player: p.player,
              team: p.team,
              statType: p.statType,
              line: p.line,
              side: p.side,
              book: p.book,
              priceAmerican: p.priceAmerican,
              impliedProbPct,
              projection: p.projection,
              edgePct: p.edgePct,
              modelWinPct: p.modelWinPct,
              source: "LIVE",
            })
            .onConflictDoUpdate({
              target: [
                oddsLines.season,
                oddsLines.week,
                oddsLines.player,
                oddsLines.statType,
                oddsLines.book,
              ],
              set: {
                team: p.team,
                line: p.line,
                side: p.side,
                priceAmerican: p.priceAmerican,
                impliedProbPct,
                projection: p.projection,
                edgePct: p.edgePct,
                modelWinPct: p.modelWinPct,
                source: "LIVE",
                fetchedAt: new Date(),
              },
            });
        }

        // Every raw book line, win or lose on edge — not just the picks
        // above that cleared the edge threshold — so the Props page can
        // show a side-by-side "which book pays best" comparison for any
        // prop, not only the ones flagged as a model edge.
        await db
          .delete(propLinesRaw)
          .where(sql`${propLinesRaw.season} = ${season} AND ${propLinesRaw.week} = ${week}`);
        for (const raw of allProps) {
          const team = averages.get(`${raw.player}|${raw.statType}`)?.team ?? null;
          await db
            .insert(propLinesRaw)
            .values({
              season,
              week,
              player: raw.player,
              team,
              statType: raw.statType,
              line: raw.line,
              side: raw.side,
              book: raw.book,
              priceAmerican: raw.priceAmerican,
            })
            .onConflictDoUpdate({
              target: [
                propLinesRaw.season,
                propLinesRaw.week,
                propLinesRaw.player,
                propLinesRaw.statType,
                propLinesRaw.line,
                propLinesRaw.side,
                propLinesRaw.book,
              ],
              set: { team, priceAmerican: raw.priceAmerican, fetchedAt: new Date() },
            });
        }

        const parlays = buildAutoParlays(picks, season, week);
        await db
          .delete(parlayPicks)
          .where(
            sql`${parlayPicks.season} = ${season} AND ${parlayPicks.week} = ${week} AND ${parlayPicks.kind} = 'auto'`
          );
        for (const parlay of parlays) {
          await db.insert(parlayPicks).values({
            kind: parlay.kind,
            season: parlay.season,
            week: parlay.week,
            size: parlay.size,
            legs: parlay.legs,
            combinedWinPct: parlay.combinedWinPct,
            weakestLegWinPct: parlay.weakestLegWinPct,
            confidence: parlay.confidence,
          });
        }

        // "Parlay for Today" (Dashboard) — the same auto-parlay builder,
        // just restricted to picks whose player's game is literally today,
        // so it reads as "what's live today" next to "Parlay of the Week"'s
        // whole-week view. A day with no games for any pick's team (the
        // normal case most days of an NFL week) just has no auto_daily rows,
        // same honest "nothing to show yet" as every other empty state.
        const todayStr = new Date().toISOString().slice(0, 10);
        const todaysPicks = picks.filter((p) => p.gameDate === todayStr);
        const dailyParlays = buildAutoParlays(todaysPicks, season, week);
        await db
          .delete(parlayPicks)
          .where(
            sql`${parlayPicks.season} = ${season} AND ${parlayPicks.week} = ${week} AND ${parlayPicks.kind} = 'auto_daily'`
          );
        for (const parlay of dailyParlays) {
          await db.insert(parlayPicks).values({
            kind: "auto_daily",
            season: parlay.season,
            week: parlay.week,
            size: parlay.size,
            legs: parlay.legs,
            combinedWinPct: parlay.combinedWinPct,
            weakestLegWinPct: parlay.weakestLegWinPct,
            confidence: parlay.confidence,
          });
        }

        const keyNote = oddsProviderNote();
        return `Props: ${thisWeekEvents.length} event(s), ${allProps.length} raw line(s) (saved for book comparison), ${picks.length} pick(s) at ${Math.round(MIN_MODEL_WIN_PCT * 100)}%+ model confidence, ${parlays.length} weekly auto-parlay(s) + ${dailyParlays.length} for today, for week ${week}.${keyNote}`;
      })
    );
  }

  return results;
}
