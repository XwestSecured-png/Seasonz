import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { userBets, games } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth";

/** Logs a bet the person says they actually placed — see db/schema.ts's user_bets. */
export async function POST(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const userId = verifySessionToken(token);
  if (userId === null) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const gameId = Number(body?.gameId);
  const market = String(body?.market ?? "");
  const selection = String(body?.selection ?? "");
  const line = body?.line === null || body?.line === undefined || body?.line === "" ? null : Number(body.line);
  const priceAmerican = Number(body?.priceAmerican);
  const stakeUsd = Number(body?.stakeUsd);

  if (!Number.isFinite(gameId)) {
    return NextResponse.json({ error: "gameId is required" }, { status: 400 });
  }
  if (!["ML", "SPREAD", "TOTAL"].includes(market)) {
    return NextResponse.json({ error: "market must be ML, SPREAD, or TOTAL" }, { status: 400 });
  }
  if (!selection) {
    return NextResponse.json({ error: "selection is required" }, { status: 400 });
  }
  if ((market === "SPREAD" || market === "TOTAL") && (line === null || !Number.isFinite(line))) {
    return NextResponse.json({ error: "line is required for spread/total bets" }, { status: 400 });
  }
  if (!Number.isFinite(priceAmerican) || priceAmerican === 0) {
    return NextResponse.json({ error: "priceAmerican is required" }, { status: 400 });
  }
  if (!Number.isFinite(stakeUsd) || stakeUsd <= 0) {
    return NextResponse.json({ error: "stakeUsd must be a positive number" }, { status: 400 });
  }

  const [game] = await db.select().from(games).where(eq(games.id, gameId));
  if (!game) {
    return NextResponse.json({ error: "game not found" }, { status: 404 });
  }

  await db.insert(userBets).values({
    userId,
    gameId,
    market,
    selection,
    line,
    priceAmerican,
    stakeUsd,
  });

  return NextResponse.json({ ok: true });
}

/** Removes a still-pending bet (a correction, not a cancellation after the fact — graded bets are the permanent record). */
export async function DELETE(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const userId = verifySessionToken(token);
  if (userId === null) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  await db
    .delete(userBets)
    .where(and(eq(userBets.id, id), eq(userBets.userId, userId), eq(userBets.result, "PENDING")));

  return NextResponse.json({ ok: true });
}
