import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sportGames, userPropPicks } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { isPickLocked } from "@/lib/time";
import { SPORTS, type SportKey } from "@/lib/sports/types";

function isSportKey(v: unknown): v is SportKey {
  return typeof v === "string" && v in SPORTS;
}

const MAX_TEXT_LEN = 60;

function cleanText(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed || trimmed.length > MAX_TEXT_LEN) return null;
  return trimmed;
}

/**
 * Creates one of the user's own "make your own pick" player props for a
 * non-NFL sport (see db/schema.ts's userPropPicks comment for why these are
 * user-called rather than model-generated). Mirrors app/api/picks/route.ts's
 * shape and lock logic.
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const userId = verifySessionToken(token);
  if (userId === null) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const sport = body?.sport;
  const gameId = Number(body?.gameId);
  const team = cleanText(body?.team);
  const player = cleanText(body?.player);
  const statLabel = cleanText(body?.statLabel);
  const threshold = Number(body?.threshold);
  const side = body?.side === "under" ? "under" : body?.side === "over" ? "over" : null;

  if (!isSportKey(sport)) {
    return NextResponse.json({ error: "invalid sport" }, { status: 400 });
  }
  if (!Number.isFinite(gameId) || !team || !player || !statLabel || !Number.isFinite(threshold) || !side) {
    return NextResponse.json({ error: "missing or invalid fields" }, { status: 400 });
  }

  const [game] = await db
    .select({ id: sportGames.id, sport: sportGames.sport, kickoffAt: sportGames.kickoffAt, isFinal: sportGames.isFinal })
    .from(sportGames)
    .where(eq(sportGames.id, gameId))
    .limit(1);

  if (!game || game.sport !== sport) {
    return NextResponse.json({ error: "game not found" }, { status: 404 });
  }

  // Same lock window as team picks — once the game's effectively started,
  // a new prop pick would just be hindsight.
  if (game.isFinal || isPickLocked(game.kickoffAt)) {
    return NextResponse.json({ error: "this game has already started" }, { status: 403 });
  }

  try {
    await db.insert(userPropPicks).values({
      userId,
      sport,
      gameId,
      team,
      player,
      statLabel,
      threshold,
      side,
    });
  } catch (err) {
    // Unique violation (same player/stat already picked for this game).
    const code = (err as { code?: string })?.code;
    if (code === "23505") {
      return NextResponse.json({ error: "you already have a pick for that player and stat" }, { status: 409 });
    }
    throw err;
  }

  return NextResponse.json({ ok: true });
}

/** Removes one of the user's own pending prop picks — graded picks are kept as a record, not deletable. */
export async function DELETE(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const userId = verifySessionToken(token);
  if (userId === null) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const id = Number(body?.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  await db
    .delete(userPropPicks)
    .where(and(eq(userPropPicks.id, id), eq(userPropPicks.userId, userId), eq(userPropPicks.result, "pending")));

  return NextResponse.json({ ok: true });
}
