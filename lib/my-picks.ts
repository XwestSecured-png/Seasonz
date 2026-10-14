// Every pick the signed-in user has made, across every sport, in one list:
// NFL game picks (Model Tracker), game picks for the other sports, and
// player-prop picks. Each comes back with its status (pending / won / lost
// / push / void) and the model's side for comparison.
import { db } from "@/db";
import { games, sportGames, sportUserPicks, userPicks, userPropPicks } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { pregamePct } from "./sports/accuracy";
import { SPORTS, isCalledOff, type SportKey } from "./sports/types";

export type PickStatus = "pending" | "won" | "lost" | "push" | "void";

export interface MyPick {
  key: string;
  sport: string; // "nfl" | SportKey
  sportLabel: string;
  kind: "Game" | "Prop";
  kickoffAt: string | null; // ISO
  matchup: string;
  pick: string;
  status: PickStatus;
  /** Final score or the stat's actual value, once known. */
  result: string | null;
  /** The model's side and chance, for game picks. */
  model: { side: string; pct: number; agrees: boolean } | null;
  href: string;
  preseason: boolean;
}

export async function getMyPicks(userId: number): Promise<MyPick[]> {
  const [nfl, other, props] = await Promise.all([
    db
      .select({ pick: userPicks, game: games })
      .from(userPicks)
      .innerJoin(games, eq(games.id, userPicks.gameId))
      .where(eq(userPicks.userId, userId)),
    db
      .select({ pick: sportUserPicks, game: sportGames })
      .from(sportUserPicks)
      .innerJoin(sportGames, eq(sportGames.id, sportUserPicks.gameId))
      .where(eq(sportUserPicks.userId, userId)),
    db
      .select({ pick: userPropPicks, game: sportGames })
      .from(userPropPicks)
      .innerJoin(sportGames, and(eq(sportGames.id, userPropPicks.gameId)))
      .where(eq(userPropPicks.userId, userId)),
  ]);

  const out: MyPick[] = [];
  const gameStatus = (
    team: string,
    home: string,
    away: string,
    hs: number | null,
    as: number | null,
    final: boolean
  ): { status: PickStatus; result: string | null } => {
    if (!final || hs === null || as === null) return { status: "pending", result: null };
    const result = `${away} ${as} – ${home} ${hs}`;
    if (hs === as) return { status: "push", result };
    const winner = hs > as ? home : away;
    return { status: team === winner ? "won" : "lost", result };
  };
  const modelSide = (pct: number | null, home: string, away: string, team: string) =>
    pct === null ? null : { side: pct >= 0.5 ? home : away, pct: pct >= 0.5 ? pct : 1 - pct, agrees: (pct >= 0.5 ? home : away) === team };

  for (const { pick, game } of nfl) {
    const s = gameStatus(pick.team, game.homeTeam, game.awayTeam, game.homeScore, game.awayScore, game.isFinal);
    out.push({
      key: `nfl-${pick.id}`,
      sport: "nfl",
      sportLabel: "NFL",
      kind: "Game",
      kickoffAt: game.kickoffAt?.toISOString() ?? null,
      matchup: `${game.awayTeam} @ ${game.homeTeam}`,
      pick: `${pick.team} to win`,
      ...s,
      model: modelSide(game.lockedPct ?? game.homeWinPctPre, game.homeTeam, game.awayTeam, pick.team),
      href: "/model-tracker",
      preseason: false,
    });
  }

  for (const { pick, game } of other) {
    const s = isCalledOff(game.extra, game.kickoffAt) && !game.isFinal
      ? { status: "void" as PickStatus, result: "Canceled" }
      : gameStatus(pick.team, game.homeTeam, game.awayTeam, game.homeScore, game.awayScore, game.isFinal);
    out.push({
      key: `game-${pick.id}`,
      sport: game.sport,
      sportLabel: SPORTS[game.sport as SportKey]?.label ?? game.sport.toUpperCase(),
      kind: "Game",
      kickoffAt: game.kickoffAt?.toISOString() ?? null,
      matchup: `${game.awayTeam} @ ${game.homeTeam}`,
      pick: `${pick.team} to win`,
      ...s,
      model: modelSide(pregamePct(game), game.homeTeam, game.awayTeam, pick.team),
      href: `/sports/${game.sport}`,
      preseason: game.seasonType === 1,
    });
  }

  for (const { pick, game } of props) {
    const status: PickStatus =
      pick.result === "win" ? "won" : pick.result === "loss" ? "lost" : pick.result === "void" ? "void" : "pending";
    out.push({
      key: `prop-${pick.id}`,
      sport: pick.sport,
      sportLabel: SPORTS[pick.sport as SportKey]?.label ?? pick.sport.toUpperCase(),
      kind: "Prop",
      kickoffAt: game.kickoffAt?.toISOString() ?? null,
      matchup: `${game.awayTeam} @ ${game.homeTeam}`,
      pick: `${pick.player} ${pick.side === "over" ? "Over" : "Under"} ${pick.threshold} ${pick.statLabel}`,
      status,
      result: pick.actualValue !== null ? `Actual: ${pick.actualValue}` : null,
      model: null,
      href: "/props",
      preseason: game.seasonType === 1,
    });
  }

  return out;
}
