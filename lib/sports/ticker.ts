// Builds the scrolling sports ticker (app/(app)/sports-ticker.tsx) shown
// across every page — recent final scores with each team's current record,
// plus recent injury updates, across NFL and every synced sport. Pure
// read-only aggregation of data the sync pipeline already writes (games/
// teamMetrics/injuryReports for NFL, sportGames/sportTeamMetrics/
// sportInjuryReports for the rest) — nothing here is a model pick, so
// there's no "never invent a bet" concern.
import { db } from "@/db";
import {
  games,
  teamMetrics,
  injuryReports,
  sportGames,
  sportTeamMetrics,
  sportInjuryReports,
} from "@/db/schema";
import { and, desc, eq, max } from "drizzle-orm";
import { SPORTS, type SportKey } from "./types";
import { currentSeasonYear } from "./espn";

export interface TickerItem {
  id: string;
  kind: "score" | "injury";
  text: string;
}

const LEAGUE_EMOJI: Record<"nfl" | SportKey, string> = {
  nfl: "🏈",
  nba: "🏀",
  wnba: "🏀",
  nhl: "🏒",
  mlb: "⚾",
  ncaaf: "🏈",
  ncaab: "🏀",
};

function currentNflSeason(): number {
  const now = new Date();
  return now.getMonth() >= 1 ? now.getFullYear() : now.getFullYear() - 1;
}

const SCORES_PER_LEAGUE = 2;
const INJURIES_PER_LEAGUE = 3;

async function nflScoreItems(): Promise<TickerItem[]> {
  const season = currentNflSeason();
  const recent = await db
    .select()
    .from(games)
    .where(and(eq(games.season, season), eq(games.isFinal, true)))
    .orderBy(desc(games.kickoffAt))
    .limit(SCORES_PER_LEAGUE);

  if (recent.length === 0) return [];

  const [latestWeek] = await db.select({ week: max(teamMetrics.week) }).from(teamMetrics).where(eq(teamMetrics.season, season));
  const records = latestWeek?.week
    ? new Map(
        (
          await db
            .select()
            .from(teamMetrics)
            .where(and(eq(teamMetrics.season, season), eq(teamMetrics.week, latestWeek.week)))
        ).map((m) => [m.team, `${m.wins}-${m.losses}${m.ties ? `-${m.ties}` : ""}`])
      )
    : new Map<string, string>();

  return recent
    .filter((g) => g.homeScore !== null && g.awayScore !== null)
    .map((g) => {
      const homeWon = (g.homeScore ?? 0) >= (g.awayScore ?? 0);
      const winner = homeWon ? g.homeTeam : g.awayTeam;
      const winnerScore = homeWon ? g.homeScore : g.awayScore;
      const loser = homeWon ? g.awayTeam : g.homeTeam;
      const loserScore = homeWon ? g.awayScore : g.homeScore;
      const rec = records.get(winner);
      return {
        id: `nfl-score-${g.id}`,
        kind: "score" as const,
        text: `${LEAGUE_EMOJI.nfl} NFL FINAL: ${winner} ${winnerScore}, ${loser} ${loserScore}${
          rec ? ` (${winner} ${rec})` : ""
        }`,
      };
    });
}

async function nflInjuryItems(): Promise<TickerItem[]> {
  const season = currentNflSeason();
  const recent = await db
    .select()
    .from(injuryReports)
    .where(eq(injuryReports.season, season))
    .orderBy(desc(injuryReports.updatedAt))
    .limit(INJURIES_PER_LEAGUE);

  return recent.map((r) => ({
    id: `nfl-injury-${r.id}`,
    kind: "injury" as const,
    text: `${LEAGUE_EMOJI.nfl} NFL injury: ${r.player} (${r.team})${r.position ? ` ${r.position}` : ""} — ${r.status}`,
  }));
}

async function sportScoreItems(sport: SportKey): Promise<TickerItem[]> {
  const season = currentSeasonYear(sport);
  const recent = await db
    .select()
    .from(sportGames)
    .where(and(eq(sportGames.sport, sport), eq(sportGames.season, season), eq(sportGames.isFinal, true)))
    .orderBy(desc(sportGames.kickoffAt))
    .limit(SCORES_PER_LEAGUE);

  if (recent.length === 0) return [];

  const [latestWeek] = await db
    .select({ week: max(sportTeamMetrics.week) })
    .from(sportTeamMetrics)
    .where(and(eq(sportTeamMetrics.sport, sport), eq(sportTeamMetrics.season, season)));
  const records = latestWeek?.week
    ? new Map(
        (
          await db
            .select()
            .from(sportTeamMetrics)
            .where(
              and(
                eq(sportTeamMetrics.sport, sport),
                eq(sportTeamMetrics.season, season),
                eq(sportTeamMetrics.week, latestWeek.week)
              )
            )
        ).map((m) => [m.team, `${m.wins}-${m.losses}${m.ties ? `-${m.ties}` : ""}`])
      )
    : new Map<string, string>();

  const label = SPORTS[sport].label;
  return recent
    .filter((g) => g.homeScore !== null && g.awayScore !== null)
    .map((g) => {
      const homeWon = (g.homeScore ?? 0) >= (g.awayScore ?? 0);
      const winner = homeWon ? g.homeTeam : g.awayTeam;
      const winnerScore = homeWon ? g.homeScore : g.awayScore;
      const loser = homeWon ? g.awayTeam : g.homeTeam;
      const loserScore = homeWon ? g.awayScore : g.homeScore;
      const rec = records.get(winner);
      return {
        id: `${sport}-score-${g.id}`,
        kind: "score" as const,
        text: `${LEAGUE_EMOJI[sport]} ${label} FINAL: ${winner} ${winnerScore}, ${loser} ${loserScore}${
          rec ? ` (${winner} ${rec})` : ""
        }`,
      };
    });
}

async function sportInjuryItems(sport: SportKey): Promise<TickerItem[]> {
  const season = currentSeasonYear(sport);
  const recent = await db
    .select()
    .from(sportInjuryReports)
    .where(and(eq(sportInjuryReports.sport, sport), eq(sportInjuryReports.season, season)))
    .orderBy(desc(sportInjuryReports.updatedAt))
    .limit(INJURIES_PER_LEAGUE);

  const label = SPORTS[sport].label;
  return recent.map((r) => ({
    id: `${sport}-injury-${r.id}`,
    kind: "injury" as const,
    text: `${LEAGUE_EMOJI[sport]} ${label} injury: ${r.player} (${r.team})${
      r.position ? ` ${r.position}` : ""
    } — ${r.status}`,
  }));
}

/**
 * Every item the ticker shows, scores first (most recent overall first),
 * then injuries (most recent overall first). Each league's own queries run
 * independently and defensively — one sport with no data yet (or a bad
 * row) just contributes nothing, never breaks the whole ticker.
 */
export async function buildTickerItems(): Promise<TickerItem[]> {
  const otherSports = Object.keys(SPORTS) as SportKey[];

  const [nflScores, nflInjuries, otherScores, otherInjuries] = await Promise.all([
    nflScoreItems().catch(() => []),
    nflInjuryItems().catch(() => []),
    Promise.all(otherSports.map((s) => sportScoreItems(s).catch(() => []))),
    Promise.all(otherSports.map((s) => sportInjuryItems(s).catch(() => []))),
  ]);

  const scores = [...nflScores, ...otherScores.flat()];
  const injuries = [...nflInjuries, ...otherInjuries.flat()];

  return [...scores, ...injuries];
}
