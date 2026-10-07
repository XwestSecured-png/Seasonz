// Grades pending userPropPicks (the "make your own pick" props on the
// Props page for every sport besides NFL) once their game is final and a
// box score row exists for the picked player — called as a sync stage from
// lib/sports/sync.ts, right after the playerStats stage populates
// sportPlayerGameStats. See db/schema.ts's userPropPicks comment for why
// this exists instead of a real model projection.
import { db } from "@/db";
import { userPropPicks, sportGames, sportPlayerGameStats } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import type { SportKey } from "./types";

/** First numeric token in a raw ESPN stat string ("8-12" shooting lines, "6.0" innings, plain "27") — null if nothing numeric is there. */
function parseStatValue(raw: string): number | null {
  const match = raw.match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Grades every pending pick for this sport whose game has gone final.
 * Defensive per-pick: one malformed pick or missing box score never stops
 * the rest from grading.
 */
export async function gradePendingPropPicks(sport: SportKey): Promise<string> {
  const pending = await db
    .select({
      id: userPropPicks.id,
      gameId: userPropPicks.gameId,
      player: userPropPicks.player,
      statLabel: userPropPicks.statLabel,
      threshold: userPropPicks.threshold,
      side: userPropPicks.side,
    })
    .from(userPropPicks)
    .where(and(eq(userPropPicks.sport, sport), eq(userPropPicks.result, "pending")));

  if (pending.length === 0) return "No pending picks to grade.";

  const gameIds = Array.from(new Set(pending.map((p) => p.gameId)));
  const finalGameIds = new Set(
    (
      await db
        .select({ id: sportGames.id })
        .from(sportGames)
        .where(and(eq(sportGames.sport, sport), eq(sportGames.isFinal, true)))
    )
      .map((g) => g.id)
      .filter((id) => gameIds.includes(id))
  );

  let won = 0;
  let lost = 0;
  let voided = 0;
  let stillWaiting = 0;

  for (const pick of pending) {
    if (!finalGameIds.has(pick.gameId)) {
      stillWaiting++;
      continue;
    }
    try {
      const boxRows = await db
        .select({ player: sportPlayerGameStats.player, stats: sportPlayerGameStats.stats })
        .from(sportPlayerGameStats)
        .where(and(eq(sportPlayerGameStats.sport, sport), eq(sportPlayerGameStats.gameId, pick.gameId)));

      const matchedPlayer = boxRows.find(
        (r) => r.player.trim().toLowerCase() === pick.player.trim().toLowerCase()
      );
      const statsObj = (matchedPlayer?.stats ?? null) as Record<string, string> | null;
      const matchedKey = statsObj
        ? Object.keys(statsObj).find((k) => k.trim().toLowerCase() === pick.statLabel.trim().toLowerCase())
        : undefined;
      const rawValue = matchedKey ? statsObj![matchedKey] : undefined;
      const actualValue = rawValue !== undefined ? parseStatValue(rawValue) : null;

      if (actualValue === null) {
        await db
          .update(userPropPicks)
          .set({ result: "void", gradedAt: new Date() })
          .where(eq(userPropPicks.id, pick.id));
        voided++;
        continue;
      }

      const isWin =
        pick.side === "over" ? actualValue > pick.threshold : actualValue < pick.threshold;
      await db
        .update(userPropPicks)
        .set({ result: isWin ? "win" : "loss", actualValue, gradedAt: new Date() })
        .where(eq(userPropPicks.id, pick.id));
      if (isWin) won++;
      else lost++;
    } catch {
      // One pick's lookup failing shouldn't block the rest.
      continue;
    }
  }

  return (
    `${won} win(s), ${lost} loss(es), ${voided} void (no matching box-score line)` +
    (stillWaiting > 0 ? `; ${stillWaiting} still waiting on a final game.` : ".")
  );
}
