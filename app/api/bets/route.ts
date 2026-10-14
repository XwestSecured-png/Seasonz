import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { userBets, games, sportGames } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { SPORTS } from "@/lib/sports/types";
import { payoutFor } from "@/lib/bet-settle";

const MARKETS = ["ML", "SPREAD", "TOTAL", "PROP", "PARLAY"] as const;
type Market = (typeof MARKETS)[number];

function userFrom(req: NextRequest): number | null {
  return verifySessionToken(req.cookies.get(COOKIE_NAME)?.value);
}
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

/**
 * Logs a bet the person says they actually placed — see db/schema.ts's
 * user_bets. Game bets (ML/SPREAD/TOTAL) and props attach to a game: NFL via
 * `gameId`, other sports via `sportGameId`. Parlays carry just a description.
 * Spread `line` is the HOME team's spread (lib/bet-grading.ts convention).
 */
export async function POST(req: NextRequest) {
  const userId = userFrom(req);
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const market = String(body?.market ?? "") as Market;
  const sport = String(body?.sport ?? "nfl");
  const selection = String(body?.selection ?? "");
  const line = num(body?.line);
  const priceAmerican = Number(body?.priceAmerican);
  const stakeUsd = Number(body?.stakeUsd);
  const description = body?.description ? String(body.description).slice(0, 500) : null;
  const gameId = num(body?.gameId);
  const sportGameId = num(body?.sportGameId);

  if (!MARKETS.includes(market)) return NextResponse.json({ error: "market must be ML, SPREAD, TOTAL, PROP or PARLAY" }, { status: 400 });
  if (sport !== "nfl" && sport !== "multi" && !(sport in SPORTS)) return NextResponse.json({ error: "unknown sport" }, { status: 400 });
  if (!Number.isFinite(priceAmerican) || Math.abs(priceAmerican) < 100 || Math.abs(priceAmerican) > 100000)
    return NextResponse.json({ error: "price must be American odds like -110 or +150" }, { status: 400 });
  if (!Number.isFinite(stakeUsd) || stakeUsd <= 0 || stakeUsd > 1_000_000) return NextResponse.json({ error: "stake must be a positive amount" }, { status: 400 });

  let prop: { player: string; statType: string; line: number; side: "Over" | "Under" } | null = null;
  if (market === "PARLAY") {
    if (!description) return NextResponse.json({ error: "describe the parlay's legs" }, { status: 400 });
  } else {
    if (sport === "multi") return NextResponse.json({ error: "only parlays can span sports" }, { status: 400 });
    // Must point at a real game of the right sport.
    if (sport === "nfl") {
      if (gameId === null || !Number.isFinite(gameId)) return NextResponse.json({ error: "gameId is required" }, { status: 400 });
      const [g] = await db.select({ id: games.id }).from(games).where(eq(games.id, gameId));
      if (!g) return NextResponse.json({ error: "game not found" }, { status: 404 });
    } else {
      if (sportGameId === null || !Number.isFinite(sportGameId)) return NextResponse.json({ error: "sportGameId is required" }, { status: 400 });
      const [g] = await db.select({ id: sportGames.id, sport: sportGames.sport }).from(sportGames).where(eq(sportGames.id, sportGameId));
      if (!g || g.sport !== sport) return NextResponse.json({ error: "game not found" }, { status: 404 });
    }
    if (!selection) return NextResponse.json({ error: "selection is required" }, { status: 400 });
    if ((market === "SPREAD" || market === "TOTAL") && (line === null || !Number.isFinite(line)))
      return NextResponse.json({ error: "line is required for spread/total bets" }, { status: 400 });
    if (market === "PROP") {
      const p = body?.prop;
      const pl = Number(p?.line);
      if (!p?.player || !p?.statType || !Number.isFinite(pl) || (p?.side !== "Over" && p?.side !== "Under"))
        return NextResponse.json({ error: "prop needs player, statType, line and side" }, { status: 400 });
      prop = { player: String(p.player), statType: String(p.statType), line: pl, side: p.side };
    }
  }

  const [row] = await db
    .insert(userBets)
    .values({
      userId,
      sport,
      gameId: sport === "nfl" && market !== "PARLAY" ? gameId : null,
      sportGameId: sport !== "nfl" && market !== "PARLAY" ? sportGameId : null,
      market,
      selection: market === "PARLAY" ? "PARLAY" : selection,
      line: market === "ML" || market === "PARLAY" ? null : (prop?.line ?? line),
      priceAmerican,
      stakeUsd,
      description,
      prop,
    })
    .returning({ id: userBets.id });

  return NextResponse.json({ ok: true, id: row.id });
}

/** Settles a pending bet by hand — for parlays and props the app can't read a stat for. */
export async function PATCH(req: NextRequest) {
  const userId = userFrom(req);
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = Number(req.nextUrl.searchParams.get("id"));
  const body = await req.json().catch(() => null);
  const result = String(body?.result ?? "");
  if (!Number.isFinite(id)) return NextResponse.json({ error: "id is required" }, { status: 400 });
  if (!["WON", "LOST", "PUSH", "VOID"].includes(result)) return NextResponse.json({ error: "result must be WON, LOST, PUSH or VOID" }, { status: 400 });

  const [bet] = await db.select().from(userBets).where(and(eq(userBets.id, id), eq(userBets.userId, userId)));
  if (!bet) return NextResponse.json({ error: "bet not found" }, { status: 404 });
  if (bet.result !== "PENDING") return NextResponse.json({ error: "this bet is already settled" }, { status: 409 });
  if (bet.market !== "PARLAY" && bet.market !== "PROP")
    return NextResponse.json({ error: "game bets are graded automatically from the final score" }, { status: 400 });

  await db
    .update(userBets)
    .set({ result, payoutUsd: payoutFor(result, bet.priceAmerican, bet.stakeUsd), gradedAt: new Date() })
    .where(eq(userBets.id, id));
  return NextResponse.json({ ok: true });
}

/** Removes a still-pending bet (a correction, not a cancellation after the fact — graded bets are the permanent record). */
export async function DELETE(req: NextRequest) {
  const userId = userFrom(req);
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isFinite(id)) return NextResponse.json({ error: "id is required" }, { status: 400 });
  await db.delete(userBets).where(and(eq(userBets.id, id), eq(userBets.userId, userId), eq(userBets.result, "PENDING")));
  return NextResponse.json({ ok: true });
}
