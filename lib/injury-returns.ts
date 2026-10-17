// Key players back from injury, for every sport.
//
// Other sports: each injuries sync compares ESPN's previous report with the
// new one. A player who was Out (or on the IL, or suspended), missed his
// team's last game(s), and is now off the Out list is "back". Only key
// players count (a top scorer, a starting goalie or pitcher, a starting QB),
// measured from this season's and last season's box scores.
// NFL: the props stage finds returners from nflverse's weekly reports
// (findReturners in lib/props-model.ts) and records them here too.
//
// Rows feed the "Back from injury" push alert (lib/alerts.ts) and the
// list on the Injury Impact page.
import { db } from "@/db";
import { injuryReturns, sportGames, sportPlayerGameStats } from "@/db/schema";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { statGroup } from "./sports/stat-extract";
import type { Returner } from "./props-model";
import type { PlayerWeekStats } from "./nflverse";

export const OUT_RE = /\bOUT\b|SUSPEND|\bIL\b|INJURED RESERVE|^IR$/i;
export const isOutStatus = (s: string) => OUT_RE.test(s.trim()) && !/DAY-TO-DAY/i.test(s);

export interface ReportRow {
  team: string;
  player: string;
  position: string | null;
  status: string;
}

const etDay = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const N = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/** Players already recorded as back in the last 6 days (no repeat alerts). */
async function recentlyRecorded(sport: string): Promise<Set<string>> {
  const since = new Date(Date.now() - 6 * 24 * 3600_000);
  const rows = await db
    .select({ team: injuryReturns.team, player: injuryReturns.player })
    .from(injuryReturns)
    .where(and(eq(injuryReturns.sport, sport), gte(injuryReturns.detectedAt, since)));
  return new Set(rows.map((r) => `${r.team}|${norm(r.player)}`));
}

interface PlayerGame {
  gameId: number;
  at: number;
  final: boolean;
  season: number;
  team: string;
  /** Main production number for ranking (sport-specific). */
  main: number;
  ip: number;
  goalie: boolean;
  pass: number;
  skill: number;
}

function mainOf(sport: string, s: Record<string, unknown>): Omit<PlayerGame, "gameId" | "at" | "final" | "season" | "team"> {
  switch (sport) {
    case "nba":
    case "wnba":
    case "ncaab":
      return { main: N(s.PTS), ip: 0, goalie: false, pass: 0, skill: 0 };
    case "nhl":
      return { main: N(s.G) + N(s.A), ip: 0, goalie: s.group === "goalies", pass: 0, skill: 0 };
    case "mlb":
      return { main: (N(s.R) + N(s.RBI)) / 2, ip: "IP" in s ? N(s.IP) : 0, goalie: false, pass: 0, skill: 0 };
    case "ncaaf": {
      const pass = N(statGroup(s, "passing")?.YDS);
      const skill = N(statGroup(s, "rushing")?.YDS) + N(statGroup(s, "receiving")?.YDS);
      return { main: skill, ip: 0, goalie: false, pass, skill };
    }
    default:
      return { main: 0, ip: 0, goalie: false, pass: 0, skill: 0 };
  }
}

/** Why a player is "key" for his team, or null if he isn't. */
function keyDetail(sport: string, mine: PlayerGame[], rank: number, teamGames: number): string | null {
  const n = mine.length;
  const avg = (f: (g: PlayerGame) => number) => mine.reduce((a, g) => a + f(g), 0) / Math.max(1, n);
  switch (sport) {
    case "nba":
    case "wnba":
    case "ncaab": {
      const ppg = avg((g) => g.main);
      return rank <= 3 && ppg >= 8 ? `${ppg.toFixed(1)} points a game` : null;
    }
    case "nhl": {
      if (mine.some((g) => g.goalie)) {
        const share = n / Math.max(1, teamGames);
        return share >= 0.4 ? "starting goalie" : null;
      }
      const p = avg((g) => g.main);
      return rank <= 4 && p >= 0.4 ? `${p.toFixed(2)} points a game` : null;
    }
    case "mlb": {
      const ip = avg((g) => g.ip);
      if (ip >= 4) return `starting pitcher (${ip.toFixed(1)} innings a start)`;
      return rank <= 4 ? `${avg((g) => g.main * 2).toFixed(2)} runs + RBIs a game` : null;
    }
    case "ncaaf": {
      const pass = avg((g) => g.pass);
      if (pass >= 150) return `starting QB (${Math.round(pass)} passing yards a game)`;
      const skill = avg((g) => g.skill);
      return rank <= 3 && skill >= 40 ? `${Math.round(skill)} rushing + receiving yards a game` : null;
    }
  }
  return null;
}

/**
 * Compares the previous and new ESPN injury reports for a sport and records
 * key players who are back. Returns a short note for the sync log.
 */
export async function detectSportReturns(sport: string, season: number, prev: ReportRow[], next: ReportRow[]): Promise<string> {
  const prevOut = prev.filter((r) => isOutStatus(r.status));
  if (prevOut.length === 0) return "";
  // A report that suddenly shrank by half is more likely a feed hiccup than a wave of recoveries.
  if (next.length < prev.length * 0.5) return " Return check skipped (report shrank by half; likely a feed hiccup).";
  const nowOut = new Set(next.filter((r) => isOutStatus(r.status)).map((r) => `${r.team}|${norm(r.player)}`));
  const candidates = prevOut.filter((r) => !nowOut.has(`${r.team}|${norm(r.player)}`));
  if (candidates.length === 0) return "";

  const teams = [...new Set(candidates.map((c) => c.team))];
  const rows = await db
    .select({
      gameId: sportPlayerGameStats.gameId,
      team: sportPlayerGameStats.team,
      player: sportPlayerGameStats.player,
      season: sportPlayerGameStats.season,
      stats: sportPlayerGameStats.stats,
      at: sportGames.kickoffAt,
      final: sportGames.isFinal,
    })
    .from(sportPlayerGameStats)
    .innerJoin(sportGames, eq(sportGames.id, sportPlayerGameStats.gameId))
    .where(
      and(eq(sportPlayerGameStats.sport, sport), inArray(sportPlayerGameStats.season, [season - 1, season]), inArray(sportPlayerGameStats.team, teams))
    );

  // One entry per player per game (college box scores list a player once per stat group).
  const byPlayer = new Map<string, Map<number, PlayerGame>>();
  const teamGames = new Map<string, Set<number>>();
  const teamGameAt = new Map<number, number>();
  for (const r of rows) {
    if (!r.final) continue;
    const at = r.at?.getTime() ?? 0;
    if (r.season === season) {
      (teamGames.get(r.team) ?? teamGames.set(r.team, new Set()).get(r.team)!).add(r.gameId);
      teamGameAt.set(r.gameId, at);
    }
    const key = `${r.team}|${norm(r.player)}`;
    const m = byPlayer.get(key) ?? byPlayer.set(key, new Map()).get(key)!;
    const v = mainOf(sport, (r.stats ?? {}) as Record<string, unknown>);
    const g = m.get(r.gameId);
    if (g) {
      g.main += v.main;
      g.pass += v.pass;
      g.skill += v.skill;
      g.ip += v.ip;
      g.goalie ||= v.goalie;
    } else m.set(r.gameId, { gameId: r.gameId, at, final: true, season: r.season, team: r.team, ...v });
  }

  const seen = await recentlyRecorded(sport);
  const day = etDay();
  let added = 0;
  for (const c of candidates) {
    const key = `${c.team}|${norm(c.player)}`;
    if (seen.has(key)) continue;
    const mine = [...(byPlayer.get(key)?.values() ?? [])].sort((a, b) => a.at - b.at);
    if (mine.length < 5) continue;
    const lastPlayed = mine[mine.length - 1].at;
    const missed = [...(teamGames.get(c.team) ?? [])].filter((id) => (teamGameAt.get(id) ?? 0) > lastPlayed).length;
    if (missed < 1) continue;
    // Rank by per-game production among this team's players with 5+ games.
    const avgOf = (k: string) => {
      const l = [...(byPlayer.get(k)?.values() ?? [])];
      return l.length >= 5 ? l.reduce((a, g) => a + g.main, 0) / l.length : -1;
    };
    const mineAvg = avgOf(key);
    let rank = 1;
    for (const k of byPlayer.keys()) if (k !== key && k.startsWith(`${c.team}|`) && avgOf(k) > mineAvg) rank++;
    const detail = keyDetail(sport, mine, rank, teamGames.get(c.team)?.size ?? 0);
    if (!detail) continue;
    await db
      .insert(injuryReturns)
      .values({ sport, season, team: c.team, player: c.player, position: c.position, missed, detail, detectedOn: day, detectedAt: new Date() })
      .onConflictDoNothing();
    added++;
  }
  return added ? ` ${added} key player(s) back from injury.` : "";
}

/** NFL: record this week's returners (from findReturners). */
export async function recordNflReturns(season: number, returners: Returner[], stats: PlayerWeekStats[]): Promise<number> {
  if (returners.length === 0) return 0;
  const seen = await recentlyRecorded("nfl");
  const day = etDay();
  let added = 0;
  for (const r of returners) {
    if (seen.has(`${r.team}|${norm(r.player)}`)) continue;
    const games = stats.filter((s) => s.player === r.player);
    const n = Math.max(1, games.length);
    const detail =
      r.position === "QB"
        ? `starting QB (${Math.round(games.reduce((a, g) => a + g.passYds, 0) / n)} passing yards a game)`
        : `${((games.reduce((a, g) => a + (g.targets ?? 0) + (g.carries ?? 0), 0)) / n).toFixed(1)} touches + targets a game`;
    await db
      .insert(injuryReturns)
      .values({ sport: "nfl", season, team: r.team, player: r.player, position: r.position, missed: r.missed, detail, detectedOn: day, detectedAt: new Date() })
      .onConflictDoNothing();
    added++;
  }
  return added;
}

export type InjuryReturn = typeof injuryReturns.$inferSelect;

export async function recentReturns(hours: number, sport?: string): Promise<InjuryReturn[]> {
  const since = new Date(Date.now() - hours * 3600_000);
  return db
    .select()
    .from(injuryReturns)
    .where(sport ? and(gte(injuryReturns.detectedAt, since), eq(injuryReturns.sport, sport)) : gte(injuryReturns.detectedAt, since))
    .orderBy(desc(injuryReturns.detectedAt));
}
