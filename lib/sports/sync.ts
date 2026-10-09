// Generic sync pipeline for every non-NFL sport — the multi-sport
// counterpart to lib/sync.ts's runFullSync. Deliberately smaller than the
// NFL pipeline today: teams -> schedule -> Elo -> team metrics. NFL's extra
// stages (weather, referee, the six team factors, ESPN FPI/QBR, injury
// impact, player props, odds/edges) don't have a sport-general equivalent
// yet — each one lands per-sport in lib/sports/<sport>/factors.ts as its
// own follow-up, not invented generically here. See db/schema.ts's
// "Multi-sport tables" comment and lib/sports/espn.ts's caveat about this
// being unverified against live ESPN data until the first real Vercel sync.
import { db } from "@/db";
import {
  sportTeams,
  sportGames,
  sportFactorSnapshots,
  sportUserPicks,
  userPropPicks,
  sportEloRatings,
  sportTeamMetrics,
  sportPlayerGameStats,
  sportTeamGameStats,
  sportInjuryReports,
  sportOddsLines,
  sportPropLinesRaw,
  syncRuns,
} from "@/db/schema";
import { replaySportElo, type SportEloGame } from "./sport-elo";
import { formBefore, nbaWinProb, lostScoring, applyInjuries, type FormRow } from "./nba-model";
import { fetchGameOddsForSport } from "./game-odds";
import { makeTeamResolver } from "./team-match";
import { SPORTS, type SportKey } from "./types";
import {
  fetchTeams,
  fetchFullSeasonSchedule,
  fetchBoxscorePlayers,
  fetchInjuries,
  fetchGameSummaryTeams,
  currentSeasonYear,
} from "./espn";
import { gradePendingPropPicks } from "./prop-grading";
import { fetchUpcomingEventsForSport, fetchEventPlayerPropsForSport } from "./odds";
import { computeSportSeasonAverages, buildSportPropPicks, type SportScheduleGame } from "./props-model";
import { americanToImpliedProb } from "../props-model";
import { hasOddsApiKey } from "../odds-provider";
import { eq, and, inArray, notInArray, sql } from "drizzle-orm";

// SportEloGame plus the DB row id, so each Elo result maps straight back to
// its row for the write-back.
interface EloInputGameWithId extends SportEloGame {
  __id: number;
}

/** Upserts a season's games; returns the ESPN event ids that were written. */
async function upsertSportGames(games: Awaited<ReturnType<typeof fetchFullSeasonSchedule>>) {
  for (const g of games) {
    await db
      .insert(sportGames)
      .values({
        sport: g.sport,
        espnEventId: g.espnEventId,
        season: g.season,
        week: g.week,
        gameDate: g.gameDate,
        kickoffAt: g.kickoffAt,
        homeTeam: g.homeTeam,
        awayTeam: g.awayTeam,
        homeScore: g.homeScore,
        awayScore: g.awayScore,
        isFinal: g.isFinal,
        neutralSite: g.neutralSite,
      })
      .onConflictDoUpdate({
        target: [sportGames.sport, sportGames.espnEventId],
        set: {
          week: g.week,
          gameDate: g.gameDate,
          kickoffAt: g.kickoffAt,
          homeScore: g.homeScore,
          awayScore: g.awayScore,
          isFinal: g.isFinal,
          neutralSite: g.neutralSite,
        },
      });
  }
}

export interface SportSyncStageResult {
  stage: string; // "<sport>:<stage>", e.g. "nba:schedule"
  status: "ok" | "error" | "skipped";
  detail: string;
}

async function logStage(
  stage: string,
  fn: () => Promise<string>
): Promise<SportSyncStageResult> {
  const startedAt = new Date();
  try {
    const detail = await fn();
    await db.insert(syncRuns).values({ startedAt, finishedAt: new Date(), stage, status: "ok", detail });
    return { stage, status: "ok", detail };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await db.insert(syncRuns).values({ startedAt, finishedAt: new Date(), stage, status: "error", detail });
    return { stage, status: "error", detail };
  }
}

/**
 * Runs the full pipeline for one sport/season. Each sport is fully
 * independent — an NBA sync error never touches NFL's tables or an NHL
 * sync running alongside it.
 */
export async function runSportSync(sport: SportKey, season?: number): Promise<SportSyncStageResult[]> {
  const def = SPORTS[sport];
  const year = season ?? currentSeasonYear(sport);
  const results: SportSyncStageResult[] = [];

  let teamCount = 0;

  results.push(
    await logStage(`${sport}:teams`, async () => {
      const teams = await fetchTeams(def);
      if (teams.length === 0) throw new Error("ESPN returned 0 teams — check the response shape.");
      for (const t of teams) {
        await db
          .insert(sportTeams)
          .values(t)
          .onConflictDoUpdate({
            target: [sportTeams.sport, sportTeams.abbr],
            set: {
              name: t.name,
              conference: t.conference,
              division: t.division,
              primaryColor: t.primaryColor,
              secondaryColor: t.secondaryColor,
              espnTeamId: t.espnTeamId,
            },
          });
      }
      teamCount = teams.length;
      return `${teams.length} ${def.label} team(s) synced.`;
    })
  );

  if (teamCount === 0) return results; // teams stage failed — nothing downstream can run

  let gameCount = 0;

  results.push(
    await logStage(`${sport}:schedule`, async () => {
      const teamRows = await db.select().from(sportTeams).where(eq(sportTeams.sport, sport));
      // The DB column is a plain `text`, so Drizzle types it as `string` —
      // narrow it back to SportKey here, which is safe since the row was
      // just filtered to this exact sport by the WHERE clause above.
      const games = await fetchFullSeasonSchedule(
        def,
        teamRows
          .filter((t) => t.espnTeamId !== null)
          .map((t) => ({ ...t, sport, espnTeamId: t.espnTeamId as string })),
        year
      );
      if (games.length === 0) return `0 games found for ${def.label} ${year} — nothing to sync yet.`;

      await upsertSportGames(games);

      // Drop rows ESPN no longer lists for this season (preseason games the
      // old fetch picked up, or games removed from the schedule). Rows a
      // user has picked are kept; derived rows are cleared first.
      let removed = 0;
      if (games.length >= 20) {
        const keep = games.map((g) => g.espnEventId);
        const stale = await db
          .select({ id: sportGames.id })
          .from(sportGames)
          .where(
            and(
              eq(sportGames.sport, sport),
              eq(sportGames.season, year),
              notInArray(sportGames.espnEventId, keep),
              sql`not exists (select 1 from ${sportUserPicks} where ${sportUserPicks.gameId} = ${sportGames.id})`,
              sql`not exists (select 1 from ${userPropPicks} where ${userPropPicks.gameId} = ${sportGames.id})`
            )
          );
        const ids = stale.map((r) => r.id);
        if (ids.length > 0) {
          await db.delete(sportFactorSnapshots).where(inArray(sportFactorSnapshots.gameId, ids));
          await db.delete(sportPlayerGameStats).where(inArray(sportPlayerGameStats.gameId, ids));
          await db.delete(sportTeamGameStats).where(inArray(sportTeamGameStats.gameId, ids));
          await db.delete(sportGames).where(inArray(sportGames.id, ids));
          removed = ids.length;
        }
      }

      // Last season's results, once, so ratings carry over into this season
      // instead of every team restarting at average.
      let priorNote = "";
      const [prior] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(sportGames)
        .where(and(eq(sportGames.sport, sport), eq(sportGames.season, year - 1), eq(sportGames.isFinal, true)));
      if ((prior?.n ?? 0) < 20) {
        const priorGames = (
          await fetchFullSeasonSchedule(
            def,
            teamRows
              .filter((t) => t.espnTeamId !== null)
              .map((t) => ({ ...t, sport, espnTeamId: t.espnTeamId as string })),
            year - 1
          )
        ).filter((g) => g.isFinal);
        await upsertSportGames(priorGames);
        priorNote = ` Loaded ${priorGames.length} game(s) from ${year - 1} for rating carryover.`;
      }

      gameCount = games.length;
      return `${games.length} game(s) synced for ${def.label} ${year}.${removed ? ` Removed ${removed} stale row(s).` : ""}${priorNote}`;
    })
  );

  if (gameCount === 0) return results;

  results.push(
    await logStage(`${sport}:elo`, async () => {
      // Last season + this season, so ratings carry over (regressed toward
      // average) instead of resetting. Only this season's rows are written.
      const allRows = await db
        .select()
        .from(sportGames)
        .where(and(eq(sportGames.sport, sport), inArray(sportGames.season, [year - 1, year])));
      const gameRows = allRows.filter((g) => g.season === year);

      const { results: allResults, finalRatings } = replaySportElo<EloInputGameWithId>(
        sport,
        allRows.map((g) => ({
          season: g.season,
          week: g.week,
          kickoffAt: g.kickoffAt,
          homeTeam: g.homeTeam,
          awayTeam: g.awayTeam,
          homeScore: g.homeScore,
          awayScore: g.awayScore,
          isFinal: g.isFinal,
          neutralSite: g.neutralSite,
          __id: g.id,
        }))
      );
      const eloResults = allResults.filter((r) => r.game.season === year);

      // Batched write-back (one statement per 500 games instead of one each).
      for (let i = 0; i < eloResults.length; i += 500) {
        const chunk = eloResults.slice(i, i + 500);
        const values = sql.join(
          chunk.map(
            (r) =>
              sql`(${r.game.__id}::int, ${r.homeRatingPre}::float8, ${r.awayRatingPre}::float8, ${r.homeWinProbPre}::float8, ${r.restDaysHome}::int, ${r.restDaysAway}::int)`
          ),
          sql`, `
        );
        await db.execute(sql`
          update ${sportGames} as g set
            elo_home_pre = v.eh, elo_away_pre = v.ea, home_win_pct_pre = v.p,
            rest_days_home = v.rh, rest_days_away = v.ra
          from (values ${values}) as v(id, eh, ea, p, rh, ra)
          where g.id = v.id`);
      }

      for (const [team, state] of finalRatings) {
        // Snapshot at the CURRENT (latest reached) week bucket — same
        // "overwrite within a week, keep history across weeks" shape as
        // NFL's teamEloRatings, just coarser-grained since these sports'
        // "weeks" are 7-day UI buckets rather than real schedule weeks.
        const latestWeek = Math.max(
          1,
          ...gameRows.filter((g) => g.homeTeam === team || g.awayTeam === team).map((g) => g.week)
        );
        await db
          .insert(sportEloRatings)
          .values({ sport, team, season: year, week: latestWeek, rating: state.rating, gamesPlayed: state.gamesPlayed })
          .onConflictDoUpdate({
            target: [sportEloRatings.sport, sportEloRatings.team, sportEloRatings.season, sportEloRatings.week],
            set: { rating: state.rating, gamesPlayed: state.gamesPlayed },
          });
      }

      return `Elo replayed for ${finalRatings.size} team(s), ${eloResults.length} game(s).`;
    })
  );

  results.push(
    await logStage(`${sport}:teamMetrics`, async () => {
      const gameRows = await db
        .select()
        .from(sportGames)
        .where(and(eq(sportGames.sport, sport), eq(sportGames.season, year), eq(sportGames.isFinal, true)));

      // Chronological, not insertion order — both the streak calculation
      // below and "most recent week" need games processed oldest-first.
      gameRows.sort((a, b) => {
        const at = a.kickoffAt?.getTime() ?? 0;
        const bt = b.kickoffAt?.getTime() ?? 0;
        return at - bt || a.week - b.week;
      });

      interface TeamAccum {
        wins: number;
        losses: number;
        homeW: number;
        homeG: number;
        roadW: number;
        roadG: number;
        lastWeek: number;
        pointsFor: number;
        pointsAgainst: number;
        gamesPlayed: number;
        // Result log in chronological order ("W"/"L") — only the tail of
        // this is used (current streak), but keeping the whole thing is
        // cheap and makes the streak math trivial and obviously correct.
        log: ("W" | "L")[];
      }
      const byTeam = new Map<string, TeamAccum>();
      const get = (team: string) =>
        byTeam.get(team) ??
        byTeam
          .set(team, {
            wins: 0,
            losses: 0,
            homeW: 0,
            homeG: 0,
            roadW: 0,
            roadG: 0,
            lastWeek: 1,
            pointsFor: 0,
            pointsAgainst: 0,
            gamesPlayed: 0,
            log: [],
          })
          .get(team)!;

      for (const g of gameRows) {
        if (g.homeScore === null || g.awayScore === null) continue;
        const homeWon = g.homeScore > g.awayScore;
        const home = get(g.homeTeam);
        const away = get(g.awayTeam);
        home.lastWeek = Math.max(home.lastWeek, g.week);
        away.lastWeek = Math.max(away.lastWeek, g.week);
        home.homeG++;
        away.roadG++;
        home.gamesPlayed++;
        away.gamesPlayed++;
        home.pointsFor += g.homeScore;
        home.pointsAgainst += g.awayScore;
        away.pointsFor += g.awayScore;
        away.pointsAgainst += g.homeScore;
        if (homeWon) {
          home.wins++;
          away.losses++;
          home.homeW++;
          home.log.push("W");
          away.log.push("L");
        } else if (g.homeScore < g.awayScore) {
          away.wins++;
          home.losses++;
          away.roadW++;
          home.log.push("L");
          away.log.push("W");
        }
        // Ties: equal final scores don't occur in these sports' box scores
        // (NHL/NBA/NCAAB/NCAAF all resolve in OT; MLB plays extra innings),
        // so there's no tie branch to handle here.
      }

      // Real, directly-measurable scoring metrics — points for/against,
      // margin, and current streak — computed straight from the schedule
      // data already synced above. Deliberately NOT a second ESPN
      // endpoint: every number here is already fully verified by the
      // schedule sync succeeding, with no extra unverified-shape risk.
      for (const [team, m] of byTeam) {
        let streak = 0;
        if (m.log.length > 0) {
          const last = m.log[m.log.length - 1];
          for (let i = m.log.length - 1; i >= 0 && m.log[i] === last; i--) streak++;
          streak = last === "L" ? -streak : streak;
        }
        const factors = {
          pointsFor: m.pointsFor,
          pointsAgainst: m.pointsAgainst,
          avgPointsFor: m.gamesPlayed > 0 ? m.pointsFor / m.gamesPlayed : null,
          avgPointsAgainst: m.gamesPlayed > 0 ? m.pointsAgainst / m.gamesPlayed : null,
          differential: m.pointsFor - m.pointsAgainst,
          avgDifferential: m.gamesPlayed > 0 ? (m.pointsFor - m.pointsAgainst) / m.gamesPlayed : null,
          // Positive = current win streak, negative = current losing streak.
          streak,
        };

        await db
          .insert(sportTeamMetrics)
          .values({
            sport,
            team,
            season: year,
            week: m.lastWeek,
            wins: m.wins,
            losses: m.losses,
            homeWinPct: m.homeG > 0 ? m.homeW / m.homeG : null,
            roadWinPct: m.roadG > 0 ? m.roadW / m.roadG : null,
            factors,
          })
          .onConflictDoUpdate({
            target: [sportTeamMetrics.sport, sportTeamMetrics.team, sportTeamMetrics.season, sportTeamMetrics.week],
            set: {
              wins: m.wins,
              losses: m.losses,
              homeWinPct: m.homeG > 0 ? m.homeW / m.homeG : null,
              roadWinPct: m.roadG > 0 ? m.roadW / m.roadG : null,
              factors,
            },
          });
      }

      return `Team metrics (incl. scoring differential & streak) updated for ${byTeam.size} team(s).`;
    })
  );

  // Per-player box scores — the data foundation for a real other-sport
  // Player Props model (see db/schema.ts's sportPlayerGameStats comment).
  // Only final games that don't already have a stats row are fetched, so a
  // daily sync's cost stays proportional to that day's new final games, not
  // the whole season replayed every time. Capped per run as a sane ceiling
  // for a cron-driven sync inside one serverless invocation's time budget.
  results.push(
    await logStage(`${sport}:playerStats`, async () => {
      const finalGames = await db
        .select({ id: sportGames.id, espnEventId: sportGames.espnEventId, week: sportGames.week })
        .from(sportGames)
        .where(and(eq(sportGames.sport, sport), eq(sportGames.season, year), eq(sportGames.isFinal, true)));

      if (finalGames.length === 0) return "No final games yet — nothing to fetch box scores for.";

      const alreadyHave = new Set(
        (
          await db
            .select({ gameId: sportPlayerGameStats.gameId })
            .from(sportPlayerGameStats)
            .where(
              and(
                eq(sportPlayerGameStats.sport, sport),
                inArray(sportPlayerGameStats.gameId, finalGames.map((g) => g.id))
              )
            )
        ).map((r) => r.gameId)
      );

      // Newest games first: props are projected from each player's most
      // recent games, so those matter most. Older games fill in over later runs.
      const PER_RUN_CAP = 300;
      const kickoffById = new Map(
        (
          await db
            .select({ id: sportGames.id, kickoffAt: sportGames.kickoffAt })
            .from(sportGames)
            .where(and(eq(sportGames.sport, sport), eq(sportGames.season, year), eq(sportGames.isFinal, true)))
        ).map((r) => [r.id, r.kickoffAt?.getTime() ?? 0])
      );
      const toFetch = finalGames
        .filter((g) => !alreadyHave.has(g.id))
        .sort((a, b) => (kickoffById.get(b.id) ?? 0) - (kickoffById.get(a.id) ?? 0))
        .slice(0, PER_RUN_CAP);
      if (toFetch.length === 0) return "Every final game already has box scores on file.";

      let gamesWithStats = 0;
      let playerRows = 0;
      let nextIdx = 0;
      await Promise.all(Array.from({ length: 8 }, async () => {
      while (nextIdx < toFetch.length) {
        const g = toFetch[nextIdx++];
        try {
          const lines = await fetchBoxscorePlayers(def, g.espnEventId);
          if (lines.length === 0) continue;
          gamesWithStats++;
          for (const line of lines) {
            await db
              .insert(sportPlayerGameStats)
              .values({
                sport,
                gameId: g.id,
                season: year,
                week: g.week,
                team: line.team,
                player: line.player,
                position: line.position,
                stats: line.stats,
              })
              .onConflictDoUpdate({
                target: [sportPlayerGameStats.sport, sportPlayerGameStats.gameId, sportPlayerGameStats.player],
                set: { position: line.position, stats: line.stats, updatedAt: new Date() },
              });
            playerRows++;
          }
        } catch {
          // One game's box score failing (not posted yet, malformed
          // response) shouldn't take down the rest of this stage.
          continue;
        }
      }
      }));

      const remaining = finalGames.length - alreadyHave.size - toFetch.length;
      return (
        `Box scores fetched for ${gamesWithStats}/${toFetch.length} game(s) (${playerRows} player row(s))` +
        (remaining > 0 ? `; ${remaining} more final game(s) queued for next run.` : ".")
      );
    })
  );

  // Team box scores (points in the paint, rebounds, turnovers, fouls incl.
  // offensive fouls, threes, mid-range makes) + officiating crews, for the
  // basketball leagues. Backfills this season and last season a batch at a
  // time, and picks up the crew for games starting in the next 36 hours as
  // soon as ESPN posts it (usually the morning of the game).
  if (sport === "nba" || sport === "wnba") {
    results.push(
      await logStage(`${sport}:teamGameStats`, async () => {
        const rows = await db
          .select({
            id: sportGames.id,
            espnEventId: sportGames.espnEventId,
            season: sportGames.season,
            homeTeam: sportGames.homeTeam,
            awayTeam: sportGames.awayTeam,
            homeScore: sportGames.homeScore,
            awayScore: sportGames.awayScore,
            isFinal: sportGames.isFinal,
            kickoffAt: sportGames.kickoffAt,
            extra: sportGames.extra,
          })
          .from(sportGames)
          .where(and(eq(sportGames.sport, sport), inArray(sportGames.season, [year - 1, year])));
        const have = new Set(
          (
            await db
              .select({ gameId: sportTeamGameStats.gameId })
              .from(sportTeamGameStats)
              .where(eq(sportTeamGameStats.sport, sport))
          ).map((r) => r.gameId)
        );
        const havePlayers = new Set(
          (
            await db
              .selectDistinct({ gameId: sportPlayerGameStats.gameId })
              .from(sportPlayerGameStats)
              .where(and(eq(sportPlayerGameStats.sport, sport), eq(sportPlayerGameStats.season, year - 1)))
          ).map((r) => r.gameId)
        );
        const soon = Date.now() + 36 * 3600_000;
        const needCrew = rows.filter(
          (g) =>
            !g.isFinal &&
            g.kickoffAt &&
            g.kickoffAt.getTime() < soon &&
            g.kickoffAt.getTime() > Date.now() - 6 * 3600_000 &&
            !((g.extra as { officials?: string[] } | null)?.officials?.length)
        );
        // Newest first, so the current season fills in before last season.
        const needStats = rows
          .filter(
            (g) =>
              g.isFinal &&
              g.homeScore !== null &&
              g.awayScore !== null &&
              (!have.has(g.id) || (g.season === year - 1 && !havePlayers.has(g.id)))
          )
          .sort((a, b) => (b.kickoffAt?.getTime() ?? 0) - (a.kickoffAt?.getTime() ?? 0));
        const PER_RUN_CAP = 450;
        const jobs = [...needCrew, ...needStats.slice(0, PER_RUN_CAP)];
        let statGames = 0;
        let crews = 0;
        let next = 0;
        await Promise.all(
          Array.from({ length: 8 }, async () => {
            while (next < jobs.length) {
              const g = jobs[next++];
              try {
                const { teams, officials } = await fetchGameSummaryTeams(def, g.espnEventId);
                if (officials.length) {
                  await db
                    .update(sportGames)
                    .set({ extra: { ...((g.extra as object) ?? {}), officials } })
                    .where(eq(sportGames.id, g.id));
                  crews++;
                }
                if (!g.isFinal || teams.length !== 2) continue;
                for (const t of teams) {
                  const isHome = t.team === g.homeTeam;
                  if (!isHome && t.team !== g.awayTeam) continue;
                  const v = {
                    sport,
                    gameId: g.id,
                    season: g.season,
                    team: t.team,
                    opponent: isHome ? g.awayTeam : g.homeTeam,
                    isHome,
                    pts: (isHome ? g.homeScore : g.awayScore) ?? 0,
                    oppPts: (isHome ? g.awayScore : g.homeScore) ?? 0,
                    fgm: t.fgm,
                    fga: t.fga,
                    fg3m: t.fg3m,
                    fg3a: t.fg3a,
                    ftm: t.ftm,
                    fta: t.fta,
                    oreb: t.oreb,
                    dreb: t.dreb,
                    tov: t.tov,
                    fouls: t.fouls,
                    offFouls: t.offFouls,
                    paintPts: t.paintPts,
                    midMade: t.midMade,
                    fastBreakPts: t.fastBreakPts,
                  };
                  await db
                    .insert(sportTeamGameStats)
                    .values(v)
                    .onConflictDoUpdate({
                      target: [sportTeamGameStats.sport, sportTeamGameStats.gameId, sportTeamGameStats.team],
                      set: { ...v, updatedAt: new Date() },
                    });
                }
                // Last season's player lines too (this season's come from the
                // playerStats stage), so an injured star's scoring is known
                // before he has played a game this season.
                if (g.season === year - 1) {
                  const lines = await fetchBoxscorePlayers(def, g.espnEventId);
                  for (const line of lines) {
                    await db
                      .insert(sportPlayerGameStats)
                      .values({ sport, gameId: g.id, season: g.season, week: 0, team: line.team, player: line.player, position: line.position, stats: line.stats })
                      .onConflictDoNothing();
                  }
                }
                statGames++;
              } catch {
                // A summary not posted yet or malformed: try again next run.
              }
            }
          })
        );
        const remaining = Math.max(0, needStats.length - PER_RUN_CAP);
        return (
          `Team box scores for ${statGames} game(s), officiating crews for ${crews} game(s)` +
          (remaining > 0 ? `; ${remaining} older game(s) queued for later runs.` : ".")
        );
      })
    );
  }

  // League-wide injury report for this sport (lib/sports/espn.ts's
  // fetchInjuries) — feeds sportInjuryReports, which the props stage right
  // below reads to gate "unavailable" players out of its picks. Runs every
  // sync (not just once) since status changes week to week; the whole
  // table for this sport+season is replaced each run rather than upserted,
  // since there's no natural unique key finer than (sport, season, team,
  // player) and a stale "OUT" from two weeks ago is worse than a gap.
  results.push(
    await logStage(`${sport}:injuries`, async () => {
      const injuries = await fetchInjuries(def);
      if (injuries.length === 0) {
        return "0 injuries returned — either genuinely none reported, or the response shape needs adjusting (see lib/sports/espn.ts's fetchInjuries caveat); check back after the first games of the season.";
      }

      const teamRows = await db.select().from(sportTeams).where(eq(sportTeams.sport, sport));
      const validAbbrs = new Set(teamRows.map((t) => t.abbr));
      const nameToAbbr = new Map(teamRows.map((t) => [t.name.trim().toLowerCase(), t.abbr]));

      // Same "this week" bucket the props stage below computes — not
      // shared across stages on purpose, so an injuries-stage failure
      // never blocks the props stage's own copy of this from running.
      const allGameRows = await db
        .select({ week: sportGames.week, isFinal: sportGames.isFinal })
        .from(sportGames)
        .where(and(eq(sportGames.sport, sport), eq(sportGames.season, year)));
      const upcomingForWeek = allGameRows.filter((g) => !g.isFinal);
      const week =
        upcomingForWeek.length > 0
          ? Math.min(...upcomingForWeek.map((g) => g.week))
          : Math.max(0, ...allGameRows.map((g) => g.week)) + 1;

      await db
        .delete(sportInjuryReports)
        .where(and(eq(sportInjuryReports.sport, sport), eq(sportInjuryReports.season, year)));

      let inserted = 0;
      let unmatched = 0;
      for (const inj of injuries) {
        const abbr =
          inj.teamAbbr && validAbbrs.has(inj.teamAbbr)
            ? inj.teamAbbr
            : inj.teamName
              ? (nameToAbbr.get(inj.teamName.trim().toLowerCase()) ?? null)
              : null;
        if (!abbr) {
          unmatched++;
          continue;
        }
        await db.insert(sportInjuryReports).values({
          sport,
          season: year,
          week,
          team: abbr,
          player: inj.player,
          position: inj.position,
          // ESPN lists suspensions as "Out" with the reason in the detail.
          status: /suspen/i.test(inj.detail ?? "") ? "SUSPENDED" : inj.status,
          winPctImpact: null,
        });
        inserted++;
      }

      return (
        `${inserted} injury report row(s) synced for ${def.label}` +
        (unmatched > 0 ? ` (${unmatched} couldn't be matched to a synced team).` : ".")
      );
    })
  );

  // Real, model-driven player props for this sport — recency-weighted,
  // opponent-adjusted projections (lib/sports/props-model.ts) compared
  // against real sportsbook lines (lib/sports/odds.ts), gated at the same
  // 70%-model-confidence bar every other sport/market uses. Mirrors NFL's
  // own "props" stage in lib/sync.ts; see that file's stage for the
  // original, more heavily-commented version this one follows.
  if (!hasOddsApiKey()) {
    results.push(
      await logStage(
        `${sport}:props`,
        async () => "No Odds API key configured (ODDS_API_KEYS_FREE/PROPLINE_API_KEYS_FREE/PROPLINE_API_KEY) — skipping player prop sync."
      )
    );
  } else {
    results.push(
      await logStage(`${sport}:props`, async () => {
        const allGameRows = await db
          .select()
          .from(sportGames)
          .where(and(eq(sportGames.sport, sport), eq(sportGames.season, year)));

        const schedule: SportScheduleGame[] = allGameRows.map((g) => ({
          week: g.week,
          homeTeam: g.homeTeam,
          awayTeam: g.awayTeam,
          gameDate: g.gameDate,
        }));

        // Ignore games that started 12h+ ago but never went final
        // (postponed/canceled) so they can't pin "this week" to an old week.
        const liveCutoff = Date.now() - 12 * 3600_000;
        const upcoming = allGameRows.filter((g) => !g.isFinal && (!g.kickoffAt || g.kickoffAt.getTime() > liveCutoff));
        const week =
          upcoming.length > 0
            ? Math.min(...upcoming.map((g) => g.week))
            : Math.max(0, ...allGameRows.map((g) => g.week)) + 1;
        const thisWeekGames = upcoming.filter((g) => g.week === week);

        if (thisWeekGames.length === 0) {
          return "No upcoming games this week — nothing to fetch player props for.";
        }

        // Odds API events carry full franchise names ("Los Angeles
        // Lakers"), while our own schedule uses ESPN's abbreviations — this
        // name map (built from the same sportTeams ESPN sync populates) is
        // how an event gets matched back to one of this week's games.
        // Exact/case-insensitive match only (same precedent as NFL's own
        // getTeamByFullName) — an unmatched name just drops that event
        // rather than risk a wrong match.
        const teamRows = await db.select().from(sportTeams).where(eq(sportTeams.sport, sport));
        const resolve = makeTeamResolver(teamRows);
        const playingThisWeek = new Set(thisWeekGames.flatMap((g) => [g.homeTeam, g.awayTeam]));
        const nameToAbbr = { get: (n: string) => resolve(n, playingThisWeek) };

        const events = await fetchUpcomingEventsForSport(sport);
        const thisWeekEvents = events.filter((e) => {
          const home = nameToAbbr.get(e.home_team.trim().toLowerCase());
          const away = nameToAbbr.get(e.away_team.trim().toLowerCase());
          if (!home || !away) return false;
          return thisWeekGames.some(
            (g) =>
              (g.homeTeam === home && g.awayTeam === away) ||
              (g.homeTeam === away && g.awayTeam === home)
          );
        });

        if (thisWeekEvents.length === 0) {
          return `0 of ${events.length} board event(s) matched this week's ${def.label} games — no props to fetch (book may not have this week's board up yet, or team names didn't match).`;
        }

        const propsByEvent = await Promise.all(
          thisWeekEvents.map((e) => fetchEventPlayerPropsForSport(sport, e.id))
        );
        const allProps = propsByEvent.flat();

        // This season's games, plus last season's for any player with fewer
        // than 3 games so far (start of a season), so opening-week props
        // still get a real projection. Last season's games sort before this
        // season's (negative week numbers) and never count toward opponent
        // adjustments.
        const rawStatRows = await db
          .select({
            player: sportPlayerGameStats.player,
            team: sportPlayerGameStats.team,
            week: sportPlayerGameStats.week,
            season: sportPlayerGameStats.season,
            stats: sportPlayerGameStats.stats,
            kickoffAt: sportGames.kickoffAt,
          })
          .from(sportPlayerGameStats)
          .innerJoin(sportGames, eq(sportGames.id, sportPlayerGameStats.gameId))
          .where(and(eq(sportPlayerGameStats.sport, sport), inArray(sportPlayerGameStats.season, [year - 1, year])));
        const currentCount = new Map<string, number>();
        for (const r of rawStatRows) if (r.season === year) currentCount.set(r.player, (currentCount.get(r.player) ?? 0) + 1);
        const prior = rawStatRows
          .filter((r) => r.season === year - 1 && (currentCount.get(r.player) ?? 0) < 3)
          .sort((a, b) => (a.kickoffAt?.getTime() ?? 0) - (b.kickoffAt?.getTime() ?? 0));
        const statRows = [
          ...prior.map((r, i) => ({ player: r.player, team: r.team, week: i - prior.length - 1000, stats: r.stats as Record<string, string> })),
          ...rawStatRows
            .filter((r) => r.season === year)
            .map((r) => ({ player: r.player, team: r.team, week: r.week, stats: r.stats as Record<string, string> })),
        ];

        const averages = computeSportSeasonAverages(sport, statRows, schedule, week);
        // A player whose last team (from box scores) isn't in the game his
        // line was posted for has changed teams; drop him rather than show
        // him on the wrong team.
        const eventTeamsByPlayer = new Map<string, Set<string>>();
        thisWeekEvents.forEach((e, i) => {
          const teams = new Set(
            [nameToAbbr.get(e.home_team.trim().toLowerCase()), nameToAbbr.get(e.away_team.trim().toLowerCase())].filter(
              (x): x is string => !!x
            )
          );
          for (const pr of propsByEvent[i]) eventTeamsByPlayer.set(pr.player, teams);
        });
        for (const [key, avg] of averages) {
          const teams = eventTeamsByPlayer.get(avg.player);
          if (teams && !teams.has(avg.team)) averages.delete(key);
        }

        // Same OUT/DOUBTFUL-style availability gate as NFL (lib/sync.ts),
        // against whatever this sport's injury reports actually say — see
        // db/schema.ts's sportInjuryReports comment on why status is kept
        // as ESPN's own free-text vocabulary rather than forced into NFL's
        // fixed set. An empty table here (no injury data synced yet for
        // this sport) makes this an honest no-op, not a fabricated gate.
        const injuryRows = await db
          .select()
          .from(sportInjuryReports)
          .where(and(eq(sportInjuryReports.sport, sport), eq(sportInjuryReports.season, year)));
        const OUT_STATUSES = new Set(["OUT", "IR", "INJURED RESERVE", "DOUBTFUL"]);
        const unavailable = new Set(
          injuryRows
            .filter((r) => OUT_STATUSES.has(r.status.trim().toUpperCase()))
            .map((r) => `${r.team}|${r.player}`)
        );

        const picks = buildSportPropPicks(allProps, averages, schedule, week, unavailable);

        await db
          .delete(sportOddsLines)
          .where(
            sql`${sportOddsLines.sport} = ${sport} AND ${sportOddsLines.season} = ${year} AND ${sportOddsLines.week} = ${week}`
          );
        for (const p of picks) {
          const impliedProbPct = americanToImpliedProb(p.priceAmerican) * 100;
          await db
            .insert(sportOddsLines)
            .values({
              sport,
              season: year,
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
                sportOddsLines.sport,
                sportOddsLines.season,
                sportOddsLines.week,
                sportOddsLines.player,
                sportOddsLines.statType,
                sportOddsLines.book,
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

        await db
          .delete(sportPropLinesRaw)
          .where(
            sql`${sportPropLinesRaw.sport} = ${sport} AND ${sportPropLinesRaw.season} = ${year} AND ${sportPropLinesRaw.week} = ${week}`
          );
        for (const raw of allProps) {
          const team = averages.get(`${raw.player}|${raw.statType}`)?.team ?? null;
          await db
            .insert(sportPropLinesRaw)
            .values({
              sport,
              season: year,
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
                sportPropLinesRaw.sport,
                sportPropLinesRaw.season,
                sportPropLinesRaw.week,
                sportPropLinesRaw.player,
                sportPropLinesRaw.statType,
                sportPropLinesRaw.line,
                sportPropLinesRaw.side,
                sportPropLinesRaw.book,
              ],
              set: { team, priceAmerican: raw.priceAmerican, fetchedAt: new Date() },
            });
        }

        return `Props: ${thisWeekEvents.length} event(s), ${allProps.length} raw line(s), ${picks.length} pick(s) at 70%+ model confidence, for week ${week}.`;
      })
    );
  }

  // Grades any "make your own pick" other-sport player props (Props page)
  // whose game just went final this run — see lib/sports/prop-grading.ts.
  if (sport === "nba") {
    // FanDuel + BetMGM moneyline, spread and total for upcoming games.
    results.push(
      await logStage(`${sport}:gameOdds`, async () => {
        const teamRows = await db.select().from(sportTeams).where(eq(sportTeams.sport, sport));
        const nameToAbbr = new Map(teamRows.map((t) => [t.name.trim().toLowerCase(), t.abbr]));
        const board = await fetchGameOddsForSport(sport);
        if (board.length === 0) return "No FanDuel/BetMGM board posted (or no odds key).";
        const upcoming = await db
          .select()
          .from(sportGames)
          .where(and(eq(sportGames.sport, sport), eq(sportGames.season, year), eq(sportGames.isFinal, false)));
        let matched = 0;
        for (const ev of board) {
          const home = nameToAbbr.get(ev.homeTeam.trim().toLowerCase());
          const away = nameToAbbr.get(ev.awayTeam.trim().toLowerCase());
          const g = upcoming.find(
            (x) =>
              x.homeTeam === home &&
              x.awayTeam === away &&
              x.kickoffAt &&
              Math.abs(x.kickoffAt.getTime() - Date.parse(ev.commenceTime)) < 18 * 3600_000
          );
          if (!g) continue;
          const main = ev.books.fanduel ?? ev.books.betmgm;
          await db
            .update(sportGames)
            .set({
              extra: { ...((g.extra as object) ?? {}), odds: ev.books, oddsUpdatedAt: new Date().toISOString() },
              moneylineHomeOdds: main?.mlHome ?? null,
              moneylineAwayOdds: main?.mlAway ?? null,
              moneylineBook: main ? (ev.books.fanduel ? "FanDuel" : "BetMGM") : null,
              spreadHomeLine: main?.spreadHome ?? null,
              spreadHomePriceAmerican: main?.spreadHomePrice ?? null,
              spreadAwayPriceAmerican: main?.spreadAwayPrice ?? null,
              spreadBook: main ? (ev.books.fanduel ? "FanDuel" : "BetMGM") : null,
              totalLine: main?.total ?? null,
              totalOverPriceAmerican: main?.overPrice ?? null,
              totalUnderPriceAmerican: main?.underPrice ?? null,
              totalBook: main ? (ev.books.fanduel ? "FanDuel" : "BetMGM") : null,
            })
            .where(eq(sportGames.id, g.id));
          matched++;
        }
        return `FanDuel/BetMGM odds matched to ${matched} of ${board.length} board game(s).`;
      })
    );

    // Elo + recent paint/margin form + injuries -> final win chance.
    results.push(
      await logStage(`${sport}:model`, async () => {
        const games = await db
          .select()
          .from(sportGames)
          .where(and(eq(sportGames.sport, sport), eq(sportGames.season, year)));
        const statRows = await db
          .select()
          .from(sportTeamGameStats)
          .where(and(eq(sportTeamGameStats.sport, sport), eq(sportTeamGameStats.season, year)));
        const gameMs = new Map(games.map((g) => [g.id, g.kickoffAt?.getTime() ?? 0]));
        // Paint margin needs the opponent's paint points from the same game.
        const byGame = new Map<number, typeof statRows>();
        for (const r of statRows) byGame.set(r.gameId, [...(byGame.get(r.gameId) ?? []), r]);
        const formRows = new Map<string, FormRow[]>();
        for (const [gid, pair] of byGame) {
          if (pair.length !== 2) continue;
          for (const r of pair) {
            const o = pair.find((x) => x !== r)!;
            const list = formRows.get(r.team) ?? [];
            list.push({ ms: gameMs.get(gid) ?? 0, mov: r.pts - r.oppPts, paint: r.paintPts - o.paintPts });
            formRows.set(r.team, list);
          }
        }
        for (const list of formRows.values()) list.sort((a, b) => a.ms - b.ms);

        // Injuries: OUT / suspended players' scoring this season (or last).
        const injuries = await db
          .select()
          .from(sportInjuryReports)
          .where(and(eq(sportInjuryReports.sport, sport), eq(sportInjuryReports.season, year)));
        const outRows = injuries.filter((r) => /^(OUT|SUSPENDED|INJURED RESERVE|IR)$/i.test(r.status.trim()));
        const ppgRows = await db
          .select({ player: sportPlayerGameStats.player, team: sportPlayerGameStats.team, stats: sportPlayerGameStats.stats })
          .from(sportPlayerGameStats)
          .where(and(eq(sportPlayerGameStats.sport, sport), inArray(sportPlayerGameStats.season, [year - 1, year])));
        const ppgAcc = new Map<string, { pts: number; n: number }>();
        for (const r of ppgRows) {
          const pts = Number((r.stats as Record<string, string>)?.PTS);
          if (!Number.isFinite(pts)) continue;
          const a = ppgAcc.get(r.player) ?? { pts: 0, n: 0 };
          a.pts += pts;
          a.n += 1;
          ppgAcc.set(r.player, a);
        }
        const ppg = (player: string) => {
          const a = ppgAcc.get(player);
          return a && a.n >= 3 ? a.pts / a.n : 0;
        };
        const outByTeam = new Map<string, { player: string; status: string; ppg: number }[]>();
        for (const r of outRows) {
          const list = outByTeam.get(r.team) ?? [];
          list.push({ player: r.player, status: r.status.toUpperCase(), ppg: ppg(r.player) });
          outByTeam.set(r.team, list);
        }

        const now = Date.now();
        const updates: { id: number; pct: number; extra: object }[] = [];
        for (const g of games) {
          if (g.homeWinPctPre === null) continue;
          const ms = g.kickoffAt?.getTime() ?? 0;
          const eloPct = g.homeWinPctPre;
          const hf = formBefore(formRows.get(g.homeTeam) ?? [], ms);
          const af = formBefore(formRows.get(g.awayTeam) ?? [], ms);
          let pct = nbaWinProb(eloPct, hf, af);
          const formShift = pct - eloPct;
          let injuryShift = 0;
          const upcoming = !g.isFinal && ms > now - 6 * 3600_000;
          const homeOut = upcoming ? (outByTeam.get(g.homeTeam) ?? []) : [];
          const awayOut = upcoming ? (outByTeam.get(g.awayTeam) ?? []) : [];
          if (upcoming) {
            const r = applyInjuries(pct, lostScoring(homeOut), lostScoring(awayOut));
            pct = r.pct;
            injuryShift = r.shift;
          }
          updates.push({
            id: g.id,
            pct,
            extra: {
              ...((g.extra as object) ?? {}),
              model: { eloPct, formShift, injuryShift, homeForm: hf, awayForm: af, homeOut, awayOut },
            },
          });
        }
        for (let i = 0; i < updates.length; i += 300) {
          const chunk = updates.slice(i, i + 300);
          const values = sql.join(
            chunk.map((u) => sql`(${u.id}::int, ${u.pct}::float8, ${JSON.stringify(u.extra)}::jsonb)`),
            sql`, `
          );
          await db.execute(sql`
            update ${sportGames} as g set home_win_pct_pre = v.p, extra = v.x
            from (values ${values}) as v(id, p, x)
            where g.id = v.id`);
        }
        const withForm = updates.filter((u) => (u.extra as { model: { formShift: number } }).model.formShift !== 0).length;
        return `Model updated ${updates.length} game(s); ${withForm} with recent-form adjustment, ${outRows.length} player(s) out/suspended considered.`;
      })
    );
  }

  results.push(await logStage(`${sport}:propGrading`, () => gradePendingPropPicks(sport)));

  return results;
}

export async function runAllSportsSync(
  sports: SportKey[] = ["nba", "wnba", "nhl", "mlb", "ncaaf", "ncaab"]
): Promise<SportSyncStageResult[]> {
  const all: SportSyncStageResult[] = [];
  for (const sport of sports) {
    try {
      all.push(...(await runSportSync(sport)));
    } catch (err) {
      all.push({
        stage: `${sport}:fatal`,
        status: "error",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return all;
}
