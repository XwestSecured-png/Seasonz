// Health check for the "Why" explanations: builds this week's insights for
// a sport and reports counts (no user data). Cron-secret only.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sportGames, sportPlayerGameStats } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { getGameInsights } from "@/lib/sports/insights";
import { getModelBuilds, type BuildSportFilter } from "@/lib/auto-builds";
import { fetchUpcomingEventsForSport } from "@/lib/sports/odds";
import { getPlayerOptions } from "@/lib/sports/player-options";
import { SPORTS, type SportKey } from "@/lib/sports/types";
import { currentSeasonYear } from "@/lib/sports/espn";
import { etWeekWindow, inWindow } from "@/lib/week-window";
import { calibrateStat } from "@/lib/prop-calibration";
import { STAT_EXTRACTORS } from "@/lib/sports/stat-extract";
import { STDDEV_FLOOR_ABS } from "@/lib/sports/props-model";
import { NFL_STDDEV_FLOOR_ABS } from "@/lib/props-model";
import { fetchPlayerWeekStats } from "@/lib/nflverse";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Prop-model calibration check (lib/prop-calibration.ts) on this and last
  // season's box scores: ?propcal=nba (or nfl).
  const propcal = req.nextUrl.searchParams.get("propcal");
  if (propcal) {
    const out: Record<string, unknown> = {};
    if (propcal === "nfl") {
      const now = new Date();
      const season = now.getMonth() >= 1 ? now.getFullYear() : now.getFullYear() - 1;
      const rows = [
        ...(await fetchPlayerWeekStats(season - 2)),
        ...(await fetchPlayerWeekStats(season - 1)),
        ...(await fetchPlayerWeekStats(season)),
      ];
      const fields: [string, "passYds" | "rushYds" | "recYds" | "receptions"][] = [
        ["Pass Yds", "passYds"],
        ["Rush Yds", "rushYds"],
        ["Rec Yds", "recYds"],
        ["Receptions", "receptions"],
      ];
      for (const [stat, field] of fields) {
        const byPlayer = new Map<string, { t: number; v: number }[]>();
        for (const r of rows) {
          const v = Number(r[field]) || 0;
          const list = byPlayer.get(r.player) ?? [];
          list.push({ t: r.season * 100 + r.week, v });
          byPlayer.set(r.player, list);
        }
        const series = [...byPlayer.entries()]
          .map(([player, values]) => ({ player, values: values.sort((a, b) => a.t - b.t) }))
          // Players who actually carry this stat (a QB's receiving yards aren't a market).
          .filter((x) => x.values.filter((v) => v.v > 0).length >= x.values.length * 0.5);
        out[stat] = calibrateStat(series, NFL_STDDEV_FLOOR_ABS[stat] ?? 5);
      }
      return NextResponse.json(out);
    }
    const sport = propcal as SportKey;
    const season = currentSeasonYear(sport);
    const rows = await db
      .select({ player: sportPlayerGameStats.player, stats: sportPlayerGameStats.stats, kickoffAt: sportGames.kickoffAt })
      .from(sportPlayerGameStats)
      .innerJoin(sportGames, eq(sportGames.id, sportPlayerGameStats.gameId))
      .where(and(eq(sportPlayerGameStats.sport, sport), inArray(sportPlayerGameStats.season, [season - 1, season])));
    for (const { statType, extract } of STAT_EXTRACTORS[sport]) {
      const byPlayer = new Map<string, { t: number; v: number }[]>();
      for (const r of rows) {
        const v = extract(r.stats as Record<string, string>);
        if (v === null) continue;
        const list = byPlayer.get(r.player) ?? [];
        list.push({ t: r.kickoffAt?.getTime() ?? 0, v });
        byPlayer.set(r.player, list);
      }
      const series = [...byPlayer.entries()]
        .map(([player, values]) => ({ player, values: values.sort((a, b) => a.t - b.t) }))
        .filter((x) => x.values.filter((v) => v.v > 0).length >= x.values.length * 0.5);
      out[statType] = calibrateStat(series, STDDEV_FLOOR_ABS[sport][statType] ?? 1);
    }
    return NextResponse.json(out);
  }
  const playersFor = req.nextUrl.searchParams.get("players");
  if (playersFor) {
    const [team1, team2] = (req.nextUrl.searchParams.get("teams") ?? "").split(",");
    const opts = await getPlayerOptions(playersFor as SportKey, [team1, team2].filter(Boolean));
    return NextResponse.json(
      Object.fromEntries(Object.entries(opts).map(([t, ps]) => [t, { players: ps.length, top: ps.slice(0, 2) }]))
    );
  }
  const eventsFor = req.nextUrl.searchParams.get("events");
  if (eventsFor) {
    const ev = await fetchUpcomingEventsForSport(eventsFor as SportKey);
    return NextResponse.json({ n: ev.length, sample: ev.slice(0, 8).map((e) => [e.away_team, e.home_team, e.commence_time]) });
  }
  const buildsFor = req.nextUrl.searchParams.get("builds");
  if (buildsFor) {
    try {
      const out: Record<string, unknown> = {};
      for (const w of ["today", "week"] as const) {
        const b = await getModelBuilds(w, buildsFor as BuildSportFilter);
        out[w] = {
          gamePool: b.gameLegPool,
          propPool: b.propLegPool,
          parlaySizes: b.parlays.map((x) => x.size),
          propSizes: b.props.map((x) => x.size),
          sample: b.parlays.at(-1)?.legs.map((l) => `${l.sport} ${l.label} ${Math.round(l.prob * 100)}%`),
        };
      }
      return NextResponse.json(out);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
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
