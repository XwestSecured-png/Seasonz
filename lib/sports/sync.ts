// Generic sync pipeline for every non-NFL sport — the multi-sport
// counterpart to lib/sync.ts's runFullSync. Deliberately smaller than the
// NFL pipeline today: teams -> schedule -> Elo -> team metrics. NFL's extra
// stages (weather, referee, the six team factors, ESPN FPI/QBR, injury
// impact, player props, odds/edges) don't have a sport-general equivalent
// yet — each one lands per-sport in lib/sports/<sport>/factors.ts as its
// own follow-up, not invented generically here. See db/schema.ts's
// "Multi-sport tables" comment and lib/sports/espn.ts's caveat about this
// being unverified against live ESPN data until the first real Vercel sync.
import { liveMarketLearn } from "../market-learn";
import { db } from "@/db";
import { buildGameDayContext } from "./game-day";
import { STAT_EXTRACTORS } from "./stat-extract";
import { archiveGameLines, archivePropLines, gradeLineArchive } from "../line-archive";
import { inBatches } from "../bulk";
import { detectSportReturns, recentReturns, type ReportRow } from "../injury-returns";
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
import { makeTeamResolver } from "./team-match";
import { gradePropLog, logPropPicks } from "../prop-log";
import { saveProjections } from "../prop-score";
import { getModelWeights, weightFor, propWeightFn, trustShiftFor, adjStrengthFor } from "../model-weights";
import { settlePendingBets } from "../bet-settle";
import { SPORTS, PRESEASON, PRESEASON_SPORTS, type SportKey } from "./types";
import {
  fetchTeams,
  fetchFullSeasonSchedule,
  fetchBoxscorePlayers,
  fetchInjuries,
  fetchGameSummaryTeams,
  currentSeasonYear,
} from "./espn";
import { gradePendingPropPicks } from "./prop-grading";
import { runModelStages } from "./model-sync";
import { fetchUpcomingEventsForSport, fetchEventPlayerPropsForSport } from "./odds";
import { computeSportSeasonAverages, buildSportPropPicks, type SportScheduleGame } from "./props-model";
import { americanToImpliedProb } from "../props-model";
import { hasOddsApiKey } from "../odds-provider";
import { eq, ne, and, inArray, notInArray, sql } from "drizzle-orm";

// SportEloGame plus the DB row id, so each Elo result maps straight back to
// its row for the write-back.
interface EloInputGameWithId extends SportEloGame {
  __id: number;
}

/** Upserts a season's games; returns the ESPN event ids that were written. */

async function upsertSportGames(games: Awaited<ReturnType<typeof fetchFullSeasonSchedule>>) {
  // One row per event (a team schedule fetch lists each game twice).
  const unique = [...new Map(games.map((g) => [g.espnEventId, g])).values()];
  // Batched: one statement per 300 games instead of one per game (college
  // schedules run to thousands of games).
  for (let i = 0; i < unique.length; i += 300) {
    const chunk = unique.slice(i, i + 300);
    await db
      .insert(sportGames)
      .values(
        chunk.map((g) => ({
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
          seasonType: g.seasonType ?? 2,
          extra: g.espnStatus ? { espnStatus: g.espnStatus } : null,
        }))
      )
      .onConflictDoUpdate({
        target: [sportGames.sport, sportGames.espnEventId],
        set: {
          week: sql`excluded.week`,
          gameDate: sql`excluded.game_date`,
          kickoffAt: sql`excluded.kickoff_at`,
          homeScore: sql`excluded.home_score`,
          awayScore: sql`excluded.away_score`,
          isFinal: sql`excluded.is_final`,
          neutralSite: sql`excluded.neutral_site`,
          seasonType: sql`excluded.season_type`,
          // ESPN's status (canceled / postponed games never go final), merged into extra.
          extra: sql`case when excluded.extra is null then ${sportGames.extra} else coalesce(${sportGames.extra}, '{}'::jsonb) || excluded.extra end`,
          // Playoff opponents ESPN lists as "TBD" until a series is decided:
          // take the real team once ESPN posts it, never overwrite one with TBD.
          homeTeam: sql`case when excluded.home_team ~* '^(TBD|TBA)$' then ${sportGames.homeTeam} else excluded.home_team end`,
          awayTeam: sql`case when excluded.away_team ~* '^(TBD|TBA)$' then ${sportGames.awayTeam} else excluded.away_team end`,
        },
        // Only rewrite a game that actually changed (score, status, time, a
        // TBD opponent filled in). Rewriting all 1,000-6,000 games every run
        // was most of the schedule stage's time.
        setWhere: sql`(${sportGames.week}, ${sportGames.gameDate}, ${sportGames.kickoffAt}, ${sportGames.homeScore}, ${sportGames.awayScore}, ${sportGames.isFinal}, ${sportGames.neutralSite}, ${sportGames.seasonType})
            is distinct from (excluded.week, excluded.game_date, excluded.kickoff_at, excluded.home_score, excluded.away_score, excluded.is_final, excluded.neutral_site, excluded.season_type)
          or (excluded.extra is not null and (${sportGames.extra} ->> 'espnStatus') is distinct from (excluded.extra ->> 'espnStatus'))
          or (excluded.home_team !~* '^(TBD|TBA)$' and excluded.home_team <> ${sportGames.homeTeam})
          or (excluded.away_team !~* '^(TBD|TBA)$' and excluded.away_team <> ${sportGames.awayTeam})`,
      });
  }
}

export interface SportSyncStageResult {
  stage: string; // "<sport>:<stage>", e.g. "nba:schedule"
  status: "ok" | "error" | "skipped";
  detail: string;
}

async function logStageRaw(
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
export async function runSportSync(
  sport: SportKey,
  season?: number,
  opts: { refresh?: boolean } = {}
): Promise<SportSyncStageResult[]> {
  // Pre-game refresh (11am / 5pm ET): only what moves close to game time —
  // scores, ratings, injuries, starters, lines, weather and the model.
  // Box scores, team stats and player props wait for the full sync.
  const REFRESH_SKIP = new Set(["teamMetrics", "playerStats", "teamGameStats", "props", "propGrading"]);
  const logStage = (stage: string, fn: () => Promise<string>): Promise<SportSyncStageResult> =>
    opts.refresh && REFRESH_SKIP.has(stage.split(":")[1])
      ? Promise.resolve({ stage, status: "skipped" as const, detail: "Skipped in pre-game refresh." })
      : logStageRaw(stage, fn);
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
        year,
        { preseason: PRESEASON_SPORTS.has(sport) }
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
        // Games ESPN dropped that someone picked (e.g. an "if necessary"
        // playoff game that wasn't needed): kept, but marked removed so
        // picks and bets on them are voided.
        await db.execute(sql`
          update ${sportGames} set extra = coalesce(extra, '{}'::jsonb) || '{"espnStatus":"STATUS_REMOVED"}'::jsonb
          where ${sportGames.sport} = ${sport} and ${sportGames.season} = ${year} and ${sportGames.isFinal} = false
            and ${notInArray(sportGames.espnEventId, keep)}`);
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
          // Preseason games get a pre-game number but never move ratings
          // (starters sit, so the results say little about the teams).
          homeScore: g.seasonType === PRESEASON ? null : g.homeScore,
          awayScore: g.seasonType === PRESEASON ? null : g.awayScore,
          isFinal: g.seasonType === PRESEASON ? false : g.isFinal,
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
        .where(and(eq(sportGames.sport, sport), eq(sportGames.season, year), eq(sportGames.isFinal, true), ne(sportGames.seasonType, PRESEASON)));

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
      // NHL and MLB also backfill last season (newest first, after this
      // season's games), so starting goalies/pitchers have a track record
      // from day one of a new season.
      // Every sport keeps last season's box scores: the props stage projects
      // from this season plus last season (the 20-game window). College
      // football and basketball used to fetch this season only, so college
      // projections ran on a handful of games.
      const statSeasons = [year - 1, year];
      const finalGames = await db
        .select({ id: sportGames.id, espnEventId: sportGames.espnEventId, week: sportGames.week, season: sportGames.season, extra: sportGames.extra })
        .from(sportGames)
        .where(and(eq(sportGames.sport, sport), inArray(sportGames.season, statSeasons), eq(sportGames.isFinal, true), ne(sportGames.seasonType, PRESEASON)));

      if (finalGames.length === 0) return "No final games yet — nothing to fetch box scores for.";
      // Games ESPN has no box score for (common in lower college divisions)
      // are marked once and skipped, so they don't block newer games.
      const noBox = (g: { extra: unknown }) => !!(g.extra as { noBox?: boolean } | null)?.noBox;

      const alreadyHave = new Set(
        (
          await db
            .select({ gameId: sportPlayerGameStats.gameId })
            .from(sportPlayerGameStats)
            .where(
              and(
                eq(sportPlayerGameStats.sport, sport),
                inArray(sportPlayerGameStats.gameId, finalGames.map((g) => g.id)),
                // College games saved before every stat group was kept get
                // fetched again (the upsert below overwrites them).
                sport === "ncaaf" ? sql`${sportPlayerGameStats.stats} ? 'groups'` : sql`true`
              )
            )
        ).map((r) => r.gameId)
      );

      // Newest games first: props are projected from each player's most
      // recent games, so those matter most. Older games fill in over later runs.
      // Larger for NHL/MLB while last season's box scores backfill (starters need them).
      const PER_RUN_CAP = sport === "nhl" || sport === "mlb" || sport === "ncaaf" || sport === "ncaab" ? 900 : 300;
      const kickoffById = new Map(
        (
          await db
            .select({ id: sportGames.id, kickoffAt: sportGames.kickoffAt })
            .from(sportGames)
            .where(and(eq(sportGames.sport, sport), inArray(sportGames.season, statSeasons), eq(sportGames.isFinal, true)))
        ).map((r) => [r.id, r.kickoffAt?.getTime() ?? 0])
      );
      const toFetch = finalGames
        .filter((g) => !alreadyHave.has(g.id) && !noBox(g))
        .sort((a, b) => (kickoffById.get(b.id) ?? 0) - (kickoffById.get(a.id) ?? 0))
        .slice(0, PER_RUN_CAP);
      if (toFetch.length === 0) return "Every final game already has box scores on file.";

      let gamesWithStats = 0;
      let playerRows = 0;
      let nextIdx = 0;
      const failures: string[] = [];
      await Promise.all(Array.from({ length: 8 }, async () => {
      while (nextIdx < toFetch.length) {
        const g = toFetch[nextIdx++];
        try {
          const lines = await fetchBoxscorePlayers(def, g.espnEventId);
          if (lines.length === 0) {
            if ((kickoffById.get(g.id) ?? 0) < Date.now() - 2 * 86_400_000) {
              await db
                .update(sportGames)
                .set({ extra: { ...((g.extra as object) ?? {}), noBox: true } })
                .where(eq(sportGames.id, g.id));
            }
            continue;
          }
          gamesWithStats++;
          // One row per player per game. ESPN lists a player once per stat
          // group (a college QB under passing AND rushing), so every group
          // is kept under stats.groups, with the first group's numbers also
          // at the top level as before.
          const merged = new Map<
            string,
            { team: string; player: string; position: string | null; stats: Record<string, unknown>; groups: Record<string, Record<string, string>> }
          >();
          for (const l of lines) {
            const groupName = l.stats.group ?? "main";
            const plain: Record<string, string> = { ...l.stats };
            delete plain.group;
            const cur = merged.get(l.player);
            if (!cur) {
              merged.set(l.player, { team: l.team, player: l.player, position: l.position, stats: { ...l.stats }, groups: { [groupName]: plain } });
            } else if (!cur.groups[groupName]) {
              cur.groups[groupName] = plain;
            }
          }
          // One insert per game (a box score can be 80+ players).
          const values = Array.from(merged.values()).map((line) => ({
            sport,
            gameId: g.id,
            season: g.season,
            week: g.week,
            team: line.team,
            player: line.player,
            position: line.position,
            stats: { ...line.stats, groups: line.groups } as unknown as Record<string, string>,
          }));
          await db
            .insert(sportPlayerGameStats)
            .values(values)
            .onConflictDoUpdate({
              target: [sportPlayerGameStats.sport, sportPlayerGameStats.gameId, sportPlayerGameStats.player],
              set: { position: sql`excluded.position`, stats: sql`excluded.stats`, updatedAt: new Date() },
            });
          playerRows += values.length;
        } catch (err) {
          // One game's box score failing shouldn't stop the rest. A 404
          // (ESPN has no summary for this game) is permanent: mark it.
          if (err instanceof Error && /failed: 404/.test(err.message) && (kickoffById.get(g.id) ?? 0) < Date.now() - 2 * 86_400_000) {
            await db
              .update(sportGames)
              .set({ extra: { ...((g.extra as object) ?? {}), noBox: true } })
              .where(eq(sportGames.id, g.id))
              .catch(() => {});
          } else {
            failures.push(err instanceof Error ? err.message.slice(0, 60) : "error");
          }
          continue;
        }
      }
      }));

      // Games ESPN has no box score for (noBox) aren't waiting on anything.
      const remaining = finalGames.filter((g) => !alreadyHave.has(g.id) && !noBox(g)).length - toFetch.length;
      return (
        `Box scores fetched for ${gamesWithStats}/${toFetch.length} game(s) (${playerRows} player row(s))` +
        (failures.length ? ` [${failures.length} failed, e.g. ${failures[0]}]` : "") +
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
            seasonType: sportGames.seasonType,
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
              g.seasonType !== PRESEASON &&
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
        .where(and(eq(sportGames.sport, sport), eq(sportGames.season, year), ne(sportGames.seasonType, PRESEASON)));
      const upcomingForWeek = allGameRows.filter((g) => !g.isFinal);
      const week =
        upcomingForWeek.length > 0
          ? Math.min(...upcomingForWeek.map((g) => g.week))
          : Math.max(0, ...allGameRows.map((g) => g.week)) + 1;

      // Last run's report, to spot key players coming off the Out list.
      const prevReport = await db
        .select({ team: sportInjuryReports.team, player: sportInjuryReports.player, position: sportInjuryReports.position, status: sportInjuryReports.status })
        .from(sportInjuryReports)
        .where(and(eq(sportInjuryReports.sport, sport), eq(sportInjuryReports.season, year)));
      const nextReport: ReportRow[] = [];

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
        const status = /suspen/i.test(inj.detail ?? "") ? "SUSPENDED" : inj.status;
        await db.insert(sportInjuryReports).values({
          sport,
          season: year,
          week,
          team: abbr,
          player: inj.player,
          position: inj.position,
          // ESPN lists suspensions as "Out" with the reason in the detail.
          status,
          winPctImpact: null,
        });
        nextReport.push({ team: abbr, player: inj.player, position: inj.position ?? null, status });
        inserted++;
      }
      let returnNote = "";
      try {
        returnNote = await detectSportReturns(sport, year, prevReport, nextReport);
      } catch (e) {
        returnNote = ` Return check failed: ${e instanceof Error ? e.message : String(e)}.`;
      }

      return (
        `${inserted} injury report row(s) synced for ${def.label}` +
        (unmatched > 0 ? ` (${unmatched} couldn't be matched to a synced team).` : ".") +
        returnNote
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
        // Where the stage's time goes, reported at the end of its message.
        let tMark = Date.now();
        const timing: string[] = [];
        const mark = (what: string) => {
          timing.push(`${what} ${((Date.now() - tMark) / 1000).toFixed(1)}s`);
          tMark = Date.now();
        };
        // Props are regular season / playoffs only: preseason minutes are
        // too unpredictable for player projections.
        const allGameRows = await db
          .select()
          .from(sportGames)
          .where(and(eq(sportGames.sport, sport), eq(sportGames.season, year), ne(sportGames.seasonType, PRESEASON)));

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

        // Box scores load while the odds feed is fetched (they don't depend on it).
        const rawStatRowsP = Promise.resolve(db
          .select({
            player: sportPlayerGameStats.player,
            team: sportPlayerGameStats.team,
            week: sportPlayerGameStats.week,
            season: sportPlayerGameStats.season,
            stats: sportPlayerGameStats.stats,
            position: sportPlayerGameStats.position,
            kickoffAt: sportGames.kickoffAt,
            gameId: sportPlayerGameStats.gameId,
            home: sportGames.homeTeam,
            id: sportPlayerGameStats.id,
          })
          .from(sportPlayerGameStats)
          .innerJoin(sportGames, eq(sportGames.id, sportPlayerGameStats.gameId))
          .where(and(eq(sportPlayerGameStats.sport, sport), inArray(sportPlayerGameStats.season, [year - 1, year]))));
        rawStatRowsP.catch(() => {});
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
        mark("odds");

        // This season's games plus last season's. Last season's games sort before this
        // season's (negative week numbers) and never count toward opponent
        // adjustments.
        const rawStatRows = await rawStatRowsP;
        mark("stats");
        // Every player gets last season's games too (the projection's
        // 20-game long window; opening-week props still get a projection):
        // early-season projections from a handful of games ran
        // overconfident (see lib/props-model.ts computeSeasonAverages).
        const prior = rawStatRows
          .filter((r) => r.season === year - 1)
          .sort((a, b) => (a.kickoffAt?.getTime() ?? 0) - (b.kickoffAt?.getTime() ?? 0));
        const statRows = [
          ...prior.map((r, i) => ({ player: r.player, team: r.team, week: i - prior.length - 1000, t: r.kickoffAt?.getTime() ?? 0, stats: r.stats as Record<string, string> })),
          ...rawStatRows
            .filter((r) => r.season === year)
            .map((r) => ({ player: r.player, team: r.team, position: r.position, week: r.week, t: r.kickoffAt?.getTime() ?? 0, stats: r.stats as Record<string, string> })),
        ];

        // Key players back from injury in the last week (lib/injury-returns.ts).
        const returners = (await recentReturns(7 * 24, sport).catch(() => [])).map((r) => ({
          player: r.player,
          team: r.team,
          position: r.position,
          at: r.detectedAt.getTime(),
        }));
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

        // Opposing pitcher, park and opponent strength (lib/sports/game-day.ts).
        const gameDay = buildGameDayContext(
          sport,
          thisWeekGames,
          allGameRows,
          rawStatRows.map((r) => ({ id: r.id, player: r.player, team: r.team, position: r.position, gameId: r.gameId, home: r.home, t: r.kickoffAt?.getTime() ?? 0, stats: r.stats as Record<string, string> })),
          STAT_EXTRACTORS[sport],
          unavailable
        );
        const averages = computeSportSeasonAverages(sport, statRows, schedule, week, returners, gameDay);
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

        const propWeight = weightFor(await getModelWeights().catch(() => ({})), `prop:${sport}`);
        const weightStore = await getModelWeights().catch(() => ({}));
        const marketLearn = await liveMarketLearn(weightStore, sport, year, week).catch(() => undefined);
        const picks = buildSportPropPicks(allProps, averages, schedule, week, unavailable, propWeightFn(weightStore, sport), trustShiftFor(weightStore, sport), marketLearn, adjStrengthFor(weightStore, sport));
        mark("model");

        await db
          .delete(sportOddsLines)
          .where(
            sql`${sportOddsLines.sport} = ${sport} AND ${sportOddsLines.season} = ${year} AND ${sportOddsLines.week} = ${week}`
          );
        // One row per player/stat/book (alt lines: keep the strongest), batched.
        const seenPick = new Set<string>();
        const pickRows = picks
          .filter((p) => {
            const k = `${p.player}|${p.statType}|${p.book}`;
            if (seenPick.has(k)) return false;
            seenPick.add(k);
            return true;
          })
          .map((p) => ({
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
            impliedProbPct: americanToImpliedProb(p.priceAmerican) * 100,
            projection: p.projection,
            edgePct: p.edgePct,
            modelWinPct: p.modelWinPct,
            trust: p.trust ?? null,
            source: "LIVE",
          }));
        for (let i = 0; i < pickRows.length; i += 300) {
          await db.insert(sportOddsLines).values(pickRows.slice(i, i + 300)).onConflictDoNothing();
        }

        // Each player's team for every line, including props the model
        // doesn't project (TDs, sacks, tackles, kicking...): from the
        // projections first, else his most recent box score.
        const teamOf = new Map<string, string>();
        for (const avg of averages.values()) teamOf.set(avg.player, avg.team);
        const needTeam = Array.from(new Set(allProps.map((p) => p.player).filter((p) => !teamOf.has(p))));
        for (let i = 0; i < needTeam.length; i += 1000) {
          const rows = await db
            .select({ player: sportPlayerGameStats.player, team: sportPlayerGameStats.team, gameId: sportPlayerGameStats.gameId })
            .from(sportPlayerGameStats)
            .where(
              and(
                eq(sportPlayerGameStats.sport, sport),
                inArray(sportPlayerGameStats.season, [year - 1, year]),
                inArray(sportPlayerGameStats.player, needTeam.slice(i, i + 1000))
              )
            );
          rows.sort((x, y) => x.gameId - y.gameId);
          for (const r of rows) {
            const teams = eventTeamsByPlayer.get(r.player);
            if (!teams || teams.has(r.team)) teamOf.set(r.player, r.team);
          }
        }

        // Existing rows this week: lines no longer posted are deleted below;
        // unchanged lines are left alone (they used to be deleted and
        // re-inserted every run).
        const existingRaw = await db
          .select({ id: sportPropLinesRaw.id, player: sportPropLinesRaw.player, statType: sportPropLinesRaw.statType, line: sportPropLinesRaw.line, side: sportPropLinesRaw.side, book: sportPropLinesRaw.book })
          .from(sportPropLinesRaw)
          .where(sql`${sportPropLinesRaw.sport} = ${sport} AND ${sportPropLinesRaw.season} = ${year} AND ${sportPropLinesRaw.week} = ${week}`);
        const seenRaw = new Set<string>();
        const rawRows = [];
        for (const raw of allProps) {
          const k = `${raw.player}|${raw.statType}|${raw.line}|${raw.side}|${raw.book}`;
          if (seenRaw.has(k)) continue;
          seenRaw.add(k);
          rawRows.push({
            sport,
            season: year,
            week,
            player: raw.player,
            team: averages.get(`${raw.player}|${raw.statType}`)?.team ?? teamOf.get(raw.player) ?? null,
            statType: raw.statType,
            line: raw.line,
            side: raw.side,
            book: raw.book,
            priceAmerican: raw.priceAmerican,
          });
        }
        // The week's rows were just deleted and rawRows is de-duplicated, so
        // plain inserts, several batches at once, alongside the archive.
        const liveKeys = new Set(rawRows.map((r) => `${r.player}|${r.statType}|${r.line}|${r.side}|${r.book}`));
        const goneIds = existingRaw.filter((r) => !liveKeys.has(`${r.player}|${r.statType}|${r.line}|${r.side}|${r.book}`)).map((r) => r.id);
        await inBatches(goneIds, 5000, 1, (ids) => db.delete(sportPropLinesRaw).where(inArray(sportPropLinesRaw.id, ids)));
        await inBatches(rawRows, 2000, 1, (chunk) =>
          db
            .insert(sportPropLinesRaw)
            .values(chunk)
            .onConflictDoUpdate({
              target: [sportPropLinesRaw.sport, sportPropLinesRaw.season, sportPropLinesRaw.week, sportPropLinesRaw.player, sportPropLinesRaw.statType, sportPropLinesRaw.line, sportPropLinesRaw.side, sportPropLinesRaw.book],
              set: { team: sql`excluded.team`, priceAmerican: sql`excluded.price_american`, fetchedAt: new Date() },
              setWhere: sql`(${sportPropLinesRaw.priceAmerican}, ${sportPropLinesRaw.team}) is distinct from (excluded.price_american, excluded.team)`,
            })
        );
        // Keep every line's opening and closing price (lib/line-archive.ts).
        await archivePropLines(sport, year, week, rawRows).catch(() => 0);
        mark("save+archive");

        const loggedN = await logPropPicks(sport, year, week, picks).catch(() => 0);
        // Projections for every player with a posted line, so the Props page
        // can score any line (lib/prop-score.ts).
        const withLines = new Set(allProps.map((p) => `${p.player}|${p.statType}`));
        await saveProjections(
          sport,
          year,
          week,
          [...averages.values()]
            .filter((a) => a.proj && a.cfg && a.values && withLines.has(`${a.player}|${a.statType}`))
            .map((a) => ({ player: a.player, team: a.team, statType: a.statType, data: { proj: a.proj!, cfg: a.cfg!, values: a.values!, minutes: a.minutes } }))
        ).catch(() => 0);
        mark("log+projections");
        const gdNote = [
          gameDay.backups?.size ? `${gameDay.backups.size} backup(s) stepping in` : "",
          gameDay.starOut?.size ? `${gameDay.starOut.size} teammate(s) of a star who is out` : "",
          gameDay.oppPitcher?.size ? `${gameDay.oppPitcher.size} opposing-starter matchup(s)` : "",
          gameDay.park?.size ? `${gameDay.park.size} park factor(s)` : "",
          gameDay.oppEloZ?.size ? `${gameDay.oppEloZ.size} opponent-strength adjustment(s)` : "",
        ]
          .filter(Boolean)
          .join(", ");
        return `Props: ${thisWeekEvents.length} event(s), ${allProps.length} raw line(s), ${picks.length} pick(s) at 70%+ (model ${Math.round(propWeight * 100)}% / market blend; ${loggedN} logged), for week ${week}.${gdNote ? ` Game-day: ${gdNote}.` : ""} [${timing.join(", ")}]`;
      })
    );
  }

  // Grades any "make your own pick" other-sport player props (Props page)
  // whose game just went final this run — see lib/sports/prop-grading.ts.
  // Probable starters, ESPN/FanDuel/BetMGM lines, weather, and the win model.
  results.push(...(await runModelStages(sport, year, logStage)));

  results.push(await logStage(`${sport}:lineArchive`, async () => `Archived ${await archiveGameLines(sport)} game line(s).`));
  results.push(await logStage(`${sport}:propGrading`, () => gradePendingPropPicks(sport)));
  // Logged bets (game bets and props) for this sport — lib/bet-settle.ts.
  results.push(await logStage(`${sport}:gradeBets`, () => settlePendingBets({ sport })));
  // Logged model props (lib/prop-log.ts), for re-fitting the props blend.
  results.push(await logStage(`${sport}:gradePropLog`, () => gradePropLog(sport)));
  results.push(await logStage(`${sport}:gradeLineArchive`, () => gradeLineArchive(sport)));

  return results;
}

export async function runAllSportsSync(
  sports: SportKey[] = ["nba", "wnba", "nhl", "mlb", "ncaaf", "ncaab"],
  opts: { refresh?: boolean } = {}
): Promise<SportSyncStageResult[]> {
  const all: SportSyncStageResult[] = [];
  for (const sport of sports) {
    try {
      all.push(...(await runSportSync(sport, undefined, opts)));
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
