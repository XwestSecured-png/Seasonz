import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { games, userPicks } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { isPickLocked } from "@/lib/time";

/**
 * Sets the signed-in user's OWN pick for one game. Each person has their
 * own row in user_picks (see db/schema.ts) — this used to write a single
 * shared games.userPickTeam column back when the app had no per-person
 * accounts; that column is left in place, unused.
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const userId = verifySessionToken(token);
  if (userId === null) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const gameId = Number(body?.gameId);
  const team = body?.team === null ? null : String(body?.team ?? "");

  if (!Number.isFinite(gameId)) {
    return NextResponse.json({ error: "gameId is required" }, { status: 400 });
  }

  // Server-side half of the pick lock — the UI already disables the toggle
  // once we're inside 5 minutes of kickoff, but that alone is just a visual
  // nicety; this is what actually stops a locked pick from being set (or
  // cleared) via a direct API call made after the page loaded.
  const [game] = await db
    .select({ kickoffAt: games.kickoffAt })
    .from(games)
    .where(eq(games.id, gameId))
    .limit(1);

  if (!game) {
    return NextResponse.json({ error: "game not found" }, { status: 404 });
  }

  if (isPickLocked(game.kickoffAt)) {
    return NextResponse.json({ error: "picks are locked for this game" }, { status: 403 });
  }

  if (!team) {
    // Tapping the same team again clears the pick.
    await db
      .delete(userPicks)
      .where(and(eq(userPicks.userId, userId), eq(userPicks.gameId, gameId)));
    return NextResponse.json({ ok: true });
  }

  await db
    .insert(userPicks)
    .values({ userId, gameId, team })
    .onConflictDoUpdate({
      target: [userPicks.userId, userPicks.gameId],
      set: { team, updatedAt: new Date() },
    });

  return NextResponse.json({ ok: true });
}
