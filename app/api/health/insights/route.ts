// Health check for the "Why" explanations: builds this week's insights for
// a sport and reports counts (no user data). Cron-secret only.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sportGames } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getGameInsights } from "@/lib/sports/insights";
import { SPORTS, type SportKey } from "@/lib/sports/types";
import { currentSeasonYear } from "@/lib/sports/espn";
import { etWeekWindow, inWindow } from "@/lib/week-window";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const sport = (req.nextUrl.searchParams.get("sport") ?? "nba") as SportKey;
  if (!(sport in SPORTS)) return NextResponse.json({ error: "bad sport" }, { status: 400 });
  const all = req.nextUrl.searchParams.get("all") === "1";
  const w = etWeekWindow();
  const games = (
    await db
      .select()
      .from(sportGames)
      .where(and(eq(sportGames.sport, sport), eq(sportGames.season, currentSeasonYear(sport)), eq(sportGames.isFinal, false)))
  )
    .filter((g) => all || inWindow(g.kickoffAt, w))
    .sort((a, b) => (a.kickoffAt?.getTime() ?? 0) - (b.kickoffAt?.getTime() ?? 0))
    .slice(0, 3);
  try {
    const m = await getGameInsights(sport, games);
    return NextResponse.json({ sport, games: games.length, insights: [...m.values()].slice(0, 1) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
