// Two seasons of player box scores (up to 150,000 rows with their stats) are
// read by three stages of a sport's sync: injury returns, the game model and
// props. They're loaded once per sync and shared; the box-score stage clears
// the cache whenever it saves new games.
import { db } from "@/db";
import { sportGames, sportPlayerGameStats } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";

export interface CachedBoxRow {
  id: number;
  gameId: number;
  team: string;
  player: string;
  position: string | null;
  season: number;
  week: number;
  stats: unknown;
  kickoffAt: Date | null;
  home: string;
  isFinal: boolean;
}

const TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; rows: Promise<CachedBoxRow[]> }>();

export function loadBoxScores(sport: string, seasons: number[]): Promise<CachedBoxRow[]> {
  const key = `${sport}|${[...seasons].sort().join(",")}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.rows;
  const rows = Promise.resolve(
    db
      .select({
        id: sportPlayerGameStats.id,
        gameId: sportPlayerGameStats.gameId,
        team: sportPlayerGameStats.team,
        player: sportPlayerGameStats.player,
        position: sportPlayerGameStats.position,
        season: sportPlayerGameStats.season,
        week: sportPlayerGameStats.week,
        stats: sportPlayerGameStats.stats,
        kickoffAt: sportGames.kickoffAt,
        home: sportGames.homeTeam,
        isFinal: sportGames.isFinal,
      })
      .from(sportPlayerGameStats)
      .innerJoin(sportGames, eq(sportGames.id, sportPlayerGameStats.gameId))
      .where(and(eq(sportPlayerGameStats.sport, sport), inArray(sportPlayerGameStats.season, seasons)))
  );
  cache.set(key, { at: Date.now(), rows });
  rows.catch(() => cache.delete(key));
  return rows;
}

/** Called after new box scores are saved for a sport. */
export function clearBoxScores(sport: string) {
  for (const k of cache.keys()) if (k.startsWith(`${sport}|`)) cache.delete(k);
}
