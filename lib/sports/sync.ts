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
  sportEloRatings,
  sportTeamMetrics,
  sportPlayerGameStats,
  sportInjuryReports,
  sportOddsLines,
  sportPropLinesRaw,
  syncRuns,
} from "@/db/schema";
import { replayElo, type EloInputGame } from "../elo";
import { SPORTS, type SportKey } from "./types";
import {
  fetchTeams,
  fetchFullSeasonSchedule,
  fetchBoxscorePlayers,
  fetchInjuries,
  currentSeasonYear,
} from "./espn";
import { gradePendingPropPicks } from "./prop-grading";
import { fetchUpcomingEventsForSport, fetchEventPlayerPropsForSport } from "./odds";
import { computeSportSeasonAverages, buildSportPropPicks, type SportScheduleGame } from "./props-model";
import { americanToImpliedProb } from "../props-model";
import { hasOddsApiKey } from "../odds-provider";
import { eq, and, inArray, sql } from "drizzle-orm";

// EloInputGame plus the DB row id, carried through replayElo generically so
// the write-back loop below can match each result straight back to its row
// — ESPN's espnEventId gives every sport a real stable id, unlike NFL's
// games.csv rows (which is why lib/sync.ts needs a separate (season, week,
// home, away) lookup instead).
interface EloInputGameWithId extends EloInputGame {
  __id: number;
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

      gameCount = games.length;
      return `${games.length} game(s) synced for ${def.label} ${year}.`;
    })
  );

  if (gameCount === 0) return results;

  results.push(
    await logStage(`${sport}:elo`, async () => {
      const gameRows = await db
        .select()
        .from(sportGames)
        .where(and(eq(sportGames.sport, sport), eq(sportGames.season, year)));

      const { results: eloResults, finalRatings } = replayElo<EloInputGameWithId>(
        gameRows.map((g) => ({
          season: g.season,
          week: g.week,
          homeTeam: g.homeTeam,
          awayTeam: g.awayTeam,
          homeScore: g.homeScore,
          awayScore: g.awayScore,
          isFinal: g.isFinal,
          __id: g.id,
        }))
      );

      for (const r of eloResults) {
        await db
          .update(sportGames)
          .set({
            eloHomePre: r.homeRatingPre,
            eloAwayPre: r.awayRatingPre,
            homeWinPctPre: r.homeWinProbPre,
          })
          .where(eq(sportGames.id, r.game.__id));
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

      const PER_RUN_CAP = 40;
      const toFetch = finalGames.filter((g) => !alreadyHave.has(g.id)).slice(0, PER_RUN_CAP);
      if (toFetch.length === 0) return "Every final game already has box scores on file.";

      let gamesWithStats = 0;
      let playerRows = 0;
      for (const g of toFetch) {
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

      const remaining = finalGames.length - alreadyHave.size - toFetch.length;
      return (
        `Box scores fetched for ${gamesWithStats}/${toFetch.length} game(s) (${playerRows} player row(s))` +
        (remaining > 0 ? `; ${remaining} more final game(s) queued for next run.` : ".")
      );
    })
  );

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
          status: inj.status,
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

        const upcoming = allGameRows.filter((g) => !g.isFinal);
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
        const nameToAbbr = new Map(teamRows.map((t) => [t.name.trim().toLowerCase(), t.abbr]));

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

        const statRows = (
          await db
            .select({
              player: sportPlayerGameStats.player,
              team: sportPlayerGameStats.team,
              week: sportPlayerGameStats.week,
              stats: sportPlayerGameStats.stats,
            })
            .from(sportPlayerGameStats)
            .where(and(eq(sportPlayerGameStats.sport, sport), eq(sportPlayerGameStats.season, year)))
        ).map((r) => ({ ...r, stats: r.stats as Record<string, string> }));

        const averages = computeSportSeasonAverages(sport, statRows, schedule, week);

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
