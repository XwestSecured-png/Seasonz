import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sportGames, sportUserPicks } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { isPickLocked } from "@/lib/time";
import { SPORTS, type SportKey } from "@/lib/sports/types";

function isSportKey(v: unknown): v is SportKey {
  return typeof v === "string" && v in SPORTS;
}

/**
 * Sets the signed-in user's own game-winner pick for one non-NFL sport's
 * game — the sport-keyed counterpart to app/api/picks/route.ts. Each person
 * has their own row in sport_user_picks (see db/schema.ts), same (userId,
 * gameId) uniqueness as NFL's user_picks.
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const userId = verifySessionToken(token);
  if (userId === null) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const gameId = Number(body?.gameId);
  const sport = body?.sport;
  const team = body?.team === null ? null : String(body?.team ?? "");

  if (!Number.isFinite(gameId)) {
    return NextResponse.json({ error: "gameId is required" }, { status: 400 });
  }
  if (!isSportKey(sport)) {
    return NextResponse.json({ error: "a valid sport is required" }, { status: 400 });
  }

  // Same server-side half of the pick lock as NFL's route — look the game
  // up fresh rather than trusting anything the client sent about timing,
  // and confirm it's actually this sport's game (not just any gameId).
  const [game] = await db
    .select({ kickoffAt: sportGames.kickoffAt, sport: sportGames.sport })
    .from(sportGames)
    .where(eq(sportGames.id, gameId))
    .limit(1);

  if (!game || game.sport !== sport) {
    return NextResponse.json({ error: "game not found" }, { status: 404 });
  }

  if (isPickLocked(game.kickoffAt)) {
    return NextResponse.json({ error: "picks are locked for this game" }, { status: 403 });
  }

  if (!team) {
    // Tapping the same team again clears the pick.
    await db
      .delete(sportUserPicks)
      .where(and(eq(sportUserPicks.userId, userId), eq(sportUserPicks.gameId, gameId)));
    return NextResponse.json({ ok: true });
  }

  await db
    .insert(sportUserPicks)
    .values({ userId, sport, gameId, team })
    .onConflictDoUpdate({
      target: [sportUserPicks.userId, sportUserPicks.gameId],
      set: { team, updatedAt: new Date() },
    });

  return NextResponse.json({ ok: true });
}
