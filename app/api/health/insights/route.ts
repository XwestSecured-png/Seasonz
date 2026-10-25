import { fitBookWeights, bookRows } from "@/lib/book-weights";
import { codedBookWeight } from "@/lib/props-model";
import { curveCal, curveRows } from "@/lib/curve-calibration";
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
import { returnCal, type BoxRow } from "@/lib/return-calibration";
import { signalCal, contextCal, type SignalRow } from "@/lib/signal-calibration";
import { sgpCal } from "@/lib/sgp-calibration";
import { gameMentalCal, propMentalCal, errorsOf, type MentalGame } from "@/lib/mental-calibration";
import { minutesCal } from "@/lib/minutes-calibration";
import { lineupCal } from "@/lib/lineup-calibration";
import { marketRows, marketHoldout, fitMarket, fitStatBias, fitOneSided, oneSidedRows } from "@/lib/market-learn";
import { ONE_SIDED_SHIFT } from "@/lib/market-adjust";
import { STAT_EXTRACTORS } from "@/lib/sports/stat-extract";
import { STDDEV_FLOOR_ABS, propModelFor, minutesOf } from "@/lib/sports/props-model";
import { NFL_STDDEV_FLOOR_ABS, NFL_PROP_MODEL } from "@/lib/props-model";
import { fetchPlayerWeekStats } from "@/lib/nflverse";
import { trustSamples, trustBacktest, type TrustSample } from "@/lib/prop-trust";
import { scoreLines } from "@/lib/prop-score";
import { verdictFor } from "@/lib/prop-verdict";
import { propLinesRaw, sportPropLinesRaw } from "@/db/schema";
import { max } from "drizzle-orm";
import { MAIN_BOOKS } from "@/lib/football-markets";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Prop-model calibration check (lib/prop-calibration.ts) on this and last
  // season's box scores: ?propcal=nba (or nfl).
  // Every-line scoring check (lib/prop-score.ts): ?linescores=nba (or nfl).
  const ls = req.nextUrl.searchParams.get("linescores");
  if (ls) {
    const isNfl = ls === "nfl";
    const tbl = isNfl ? propLinesRaw : sportPropLinesRaw;
    const season = isNfl ? (new Date().getMonth() >= 1 ? new Date().getFullYear() : new Date().getFullYear() - 1) : currentSeasonYear(ls as SportKey);
    const where = isNfl ? eq(propLinesRaw.season, season) : and(eq(sportPropLinesRaw.sport, ls), eq(sportPropLinesRaw.season, season));
    const [w] = await db.select({ week: max(tbl.week) }).from(tbl).where(where);
    if (w?.week == null) return NextResponse.json({ error: "no lines" });
    const lines = (await db.select().from(tbl).where(and(where, eq(tbl.week, w.week), inArray(tbl.book, MAIN_BOOKS)))).map((r) => ({
      player: r.player,
      statType: r.statType,
      line: r.line,
      side: r.side,
      book: r.book,
      priceAmerican: r.priceAmerican,
    }));
    const scores = await scoreLines(ls, season, w.week, lines);
    const vals = Object.entries(scores);
    const byVerdict: Record<string, number> = {};
    for (const [, v] of vals) byVerdict[verdictFor(v.chance).label] = (byVerdict[verdictFor(v.chance).label] ?? 0) + 1;
    const keys = new Set(lines.map((l) => `${l.player}|${l.statType}|${l.line}|${l.side}`));
    return NextResponse.json({ week: w.week, lineSides: keys.size, scored: vals.length, byVerdict, sample: vals.slice(0, 4) });
  }
  // Prop trust-score fit (lib/prop-trust.ts): ?trustcal=nba (or nfl).
  const trustcal = req.nextUrl.searchParams.get("trustcal");
  if (trustcal) {
    const all: TrustSample[] = [];
    if (trustcal === "nfl") {
      const now = new Date();
      const season = now.getMonth() >= 1 ? now.getFullYear() : now.getFullYear() - 1;
      const rows = [...(await fetchPlayerWeekStats(season - 2)), ...(await fetchPlayerWeekStats(season - 1)), ...(await fetchPlayerWeekStats(season))];
      const fields: [string, "passYds" | "rushYds" | "recYds" | "receptions" | "rushRecYds"][] = [
        ["Pass Yds", "passYds"],
        ["Rush Yds", "rushYds"],
        ["Rec Yds", "recYds"],
        ["Receptions", "receptions"],
        ["Rush + Rec Yds", "rushRecYds"],
      ];
      for (const [stat, field] of fields) {
        const by = new Map<string, { t: number; v: number }[]>();
        for (const r of rows) {
          const l = by.get(r.player) ?? [];
          l.push({ t: r.season * 100 + r.week, v: Number(r[field]) || 0 });
          by.set(r.player, l);
        }
        const series = [...by.values()]
          .map((v) => ({ values: v.sort((a, b) => a.t - b.t) }))
          .filter((x) => x.values.filter((v) => v.v > 0).length >= x.values.length * 0.5);
        all.push(...trustSamples(series, NFL_PROP_MODEL[stat], NFL_STDDEV_FLOOR_ABS[stat] ?? 5));
      }
    } else {
      const sport = trustcal as SportKey;
      const season = currentSeasonYear(sport);
      const rows = await db
        .select({ player: sportPlayerGameStats.player, stats: sportPlayerGameStats.stats, kickoffAt: sportGames.kickoffAt })
        .from(sportPlayerGameStats)
        .innerJoin(sportGames, eq(sportGames.id, sportPlayerGameStats.gameId))
        .where(and(eq(sportPlayerGameStats.sport, sport), inArray(sportPlayerGameStats.season, [season - 1, season])));
      for (const { statType, extract } of STAT_EXTRACTORS[sport]) {
        const by = new Map<string, { t: number; v: number; min: number | null }[]>();
        for (const r of rows) {
          const st = r.stats as Record<string, string>;
          const v = extract(st);
          if (v === null) continue;
          const l = by.get(r.player) ?? [];
          l.push({ t: r.kickoffAt?.getTime() ?? 0, v, min: minutesOf(st) });
          by.set(r.player, l);
        }
        const series = [...by.values()]
          .map((v) => ({ values: v.sort((a, b) => a.t - b.t) }))
          .filter((x) => x.values.filter((v) => v.v > 0).length >= x.values.length * 0.5);
        all.push(...trustSamples(series, propModelFor(sport, statType), STDDEV_FLOOR_ABS[sport][statType] ?? 1));
      }
    }
    return NextResponse.json(trustBacktest(all) ?? { error: "not enough samples", n: all.length });
  }
  // Same-game correlations for hockey/baseball (lib/sgp-calibration.ts): ?sgpcal=nhl.
  const sgpcal = req.nextUrl.searchParams.get("sgpcal");
  if (sgpcal) {
    const sport = sgpcal as SportKey;
    const season = currentSeasonYear(sport);
    const raw = await db
      .select({
        gameId: sportPlayerGameStats.gameId,
        team: sportPlayerGameStats.team,
        player: sportPlayerGameStats.player,
        stats: sportPlayerGameStats.stats,
        kickoffAt: sportGames.kickoffAt,
        home: sportGames.homeTeam,
        homeScore: sportGames.homeScore,
        awayScore: sportGames.awayScore,
      })
      .from(sportPlayerGameStats)
      .innerJoin(sportGames, eq(sportGames.id, sportPlayerGameStats.gameId))
      .where(and(eq(sportPlayerGameStats.sport, sport), inArray(sportPlayerGameStats.season, [season - 1, season]), eq(sportGames.isFinal, true)));
    const fams = STAT_EXTRACTORS[sport].map((e) => ({ name: e.statType, extract: e.extract }));
    return NextResponse.json(
      sgpCal(
        raw.map((r) => ({ ...r, at: r.kickoffAt?.getTime() ?? 0, stats: r.stats as Record<string, string> })),
        fams
      )
    );
  }
  // Book weight check (lib/book-weights.ts): ?bookcal=1.
  if (req.nextUrl.searchParams.get("bookcal")) {
    const rows = await bookRows();
    const fit = fitBookWeights(rows, codedBookWeight);
    return NextResponse.json({ ...fit, edges: Object.fromEntries(Object.entries(fit.edges).sort((a, b) => a[1].raw - b[1].raw)) });
  }
  // Market curve check (lib/curve-calibration.ts): ?curvecal=nba.
  const curvecal = req.nextUrl.searchParams.get("curvecal");
  if (curvecal) {
    const rows = await curveRows(curvecal);
    return NextResponse.json(curveCal(rows, ONE_SIDED_SHIFT));
  }
  // Market learning check (lib/market-learn.ts): ?marketcal=nba.
  const marketcal = req.nextUrl.searchParams.get("marketcal");
  if (marketcal) {
    const rows = await marketRows(marketcal);
    const all = fitMarket(rows);
    const os = await oneSidedRows(marketcal);
    const half = (l: typeof os) => {
      const sorted = [...l].sort((a, b) => a.at - b.at);
      const cut = sorted[Math.floor(sorted.length / 2)]?.at ?? 0;
      const tr = sorted.filter((r) => r.at < cut);
      const te = sorted.filter((r) => r.at >= cut);
      const f = fitOneSided(tr, ONE_SIDED_SHIFT);
      const g = fitOneSided(te, f.fit);
      return { train: f, testWithTrainFit: { llOld: g.llOld, llTrainFit: g.llDefault, llDefault: fitOneSided(te, ONE_SIDED_SHIFT).llDefault } };
    };
    return NextResponse.json({ holdout: marketHoldout(rows), all, statBias: fitStatBias(rows, all.bias, all.move), oneSided: { all: fitOneSided(os, ONE_SIDED_SHIFT), holdout: half(os) } });
  }
  // Mental toughness / human error check (lib/mental-calibration.ts): ?mentalcal=nba[&set=games][&stat=Points].
  const mentalcal = req.nextUrl.searchParams.get("mentalcal");
  if (mentalcal) {
    const sport = mentalcal as SportKey;
    const season = currentSeasonYear(sport);
    const games: MentalGame[] = (
      await db
        .select()
        .from(sportGames)
        .where(and(eq(sportGames.sport, sport), inArray(sportGames.season, [season - 1, season])))
    ).map((g) => ({ id: g.id, season: g.season, week: g.week, kickoffAt: g.kickoffAt, homeTeam: g.homeTeam, awayTeam: g.awayTeam, homeScore: g.homeScore, awayScore: g.awayScore, isFinal: g.isFinal, neutralSite: g.neutralSite }));
    const raw = await db
      .select({ gameId: sportPlayerGameStats.gameId, team: sportPlayerGameStats.team, player: sportPlayerGameStats.player, season: sportPlayerGameStats.season, stats: sportPlayerGameStats.stats, kickoffAt: sportGames.kickoffAt, position: sportPlayerGameStats.position })
      .from(sportPlayerGameStats)
      .innerJoin(sportGames, eq(sportGames.id, sportPlayerGameStats.gameId))
      .where(and(eq(sportPlayerGameStats.sport, sport), inArray(sportPlayerGameStats.season, [season - 1, season]), eq(sportGames.isFinal, true)));
    const teamErr = new Map<string, [number, number]>();
    for (const r of raw) {
      const e = errorsOf(sport, r.stats as Record<string, unknown>);
      const k = `${r.gameId}|${r.team}`;
      const t = teamErr.get(k) ?? [0, 0];
      teamErr.set(k, [t[0] + e[0], t[1] + e[1]]);
    }
    if (req.nextUrl.searchParams.get("set") === "lineup") {
      const only1 = req.nextUrl.searchParams.get("stat");
      const defs1 = STAT_EXTRACTORS[sport]
        .filter((e) => !only1 || e.statType === only1)
        .map((e) => ({ statType: e.statType, extract: e.extract, cfg: propModelFor(sport, e.statType), floor: STDDEV_FLOOR_ABS[sport][e.statType] ?? 1 }));
      const scoreEx = STAT_EXTRACTORS[sport].find((e) => e.statType === "Points")?.extract ?? STAT_EXTRACTORS[sport][0].extract;
      const rows1 = raw.map((r) => ({ gameId: r.gameId, team: r.team, player: r.player, season: r.season, at: r.kickoffAt?.getTime() ?? 0, stats: r.stats as Record<string, string>, position: r.position }));
      return NextResponse.json({ season, results: lineupCal(sport, games, rows1, defs1, season, minutesOf, scoreEx) });
    }
    if (req.nextUrl.searchParams.get("set") === "minutes") {
      const only0 = req.nextUrl.searchParams.get("stat");
      const defs0 = STAT_EXTRACTORS[sport]
        .filter((e) => !only0 || e.statType === only0)
        .map((e) => ({ statType: e.statType, extract: e.extract, cfg: propModelFor(sport, e.statType), floor: STDDEV_FLOOR_ABS[sport][e.statType] ?? 1 }));
      const rows0 = raw.map((r) => ({ gameId: r.gameId, team: r.team, player: r.player, season: r.season, at: r.kickoffAt?.getTime() ?? 0, stats: r.stats as Record<string, string> }));
      return NextResponse.json({ season, results: minutesCal(sport, games, rows0, defs0, season, minutesOf) });
    }
    if (req.nextUrl.searchParams.get("set") === "games") return NextResponse.json({ season, games: games.length, results: gameMentalCal(sport, games, teamErr, season) });
    const only = req.nextUrl.searchParams.get("stat");
    const defs = STAT_EXTRACTORS[sport]
      .filter((e) => !only || e.statType === only)
      .map((e) => ({ statType: e.statType, extract: e.extract, cfg: propModelFor(sport, e.statType), floor: STDDEV_FLOOR_ABS[sport][e.statType] ?? 1 }));
    const rows = raw.map((r) => ({ gameId: r.gameId, team: r.team, player: r.player, season: r.season, at: r.kickoffAt?.getTime() ?? 0, stats: r.stats as Record<string, string> }));
    return NextResponse.json({ season, rows: rows.length, results: propMentalCal(sport, games, rows, teamErr, defs, season, minutesOf) });
  }
  // Game-day signal check (lib/signal-calibration.ts): ?signalcal=mlb[&stat=Hits].
  const signalcal = req.nextUrl.searchParams.get("signalcal");
  if (signalcal) {
    const sport = signalcal as SportKey;
    const season = currentSeasonYear(sport);
    const raw = await db
      .select({
        id: sportPlayerGameStats.id,
        gameId: sportPlayerGameStats.gameId,
        team: sportPlayerGameStats.team,
        player: sportPlayerGameStats.player,
        position: sportPlayerGameStats.position,
        season: sportPlayerGameStats.season,
        stats: sportPlayerGameStats.stats,
        kickoffAt: sportGames.kickoffAt,
        home: sportGames.homeTeam,
        homeWinPre: sportGames.homeWinPctPre,
        eloHome: sportGames.eloHomePre,
        eloAway: sportGames.eloAwayPre,
      })
      .from(sportPlayerGameStats)
      .innerJoin(sportGames, eq(sportGames.id, sportPlayerGameStats.gameId))
      .where(and(eq(sportPlayerGameStats.sport, sport), inArray(sportPlayerGameStats.season, [season - 1, season]), eq(sportGames.isFinal, true)));
    const only = req.nextUrl.searchParams.get("stat");
    const rows: SignalRow[] = raw.map((r) => ({
      ...r,
      at: r.kickoffAt?.getTime() ?? 0,
      stats: r.stats as Record<string, unknown>,
      homeWinPre: r.team === r.home ? r.homeWinPre : r.homeWinPre === null ? null : 1 - r.homeWinPre,
      oppElo: r.team === r.home ? r.eloAway : r.eloHome,
    }));
    const defs = STAT_EXTRACTORS[sport]
      .filter((e) => !only || e.statType === only)
      .map((e) => ({ statType: e.statType, extract: e.extract, cfg: propModelFor(sport, e.statType), floor: STDDEV_FLOOR_ABS[sport][e.statType] ?? 1 }));
    const set = req.nextUrl.searchParams.get("set");
    const results = set === "context" ? contextCal(sport, rows, defs, season, minutesOf) : signalCal(sport, rows, defs, season, minutesOf);
    return NextResponse.json({ season, rows: rows.length, results });
  }
  // Back-from-injury check (lib/return-calibration.ts): ?returncal=nba[&stat=Points].
  const returncal = req.nextUrl.searchParams.get("returncal");
  if (returncal) {
    const sport = returncal as SportKey;
    const season = currentSeasonYear(sport);
    const rows = await db
      .select({
        gameId: sportPlayerGameStats.gameId,
        team: sportPlayerGameStats.team,
        player: sportPlayerGameStats.player,
        position: sportPlayerGameStats.position,
        season: sportPlayerGameStats.season,
        stats: sportPlayerGameStats.stats,
        kickoffAt: sportGames.kickoffAt,
      })
      .from(sportPlayerGameStats)
      .innerJoin(sportGames, eq(sportGames.id, sportPlayerGameStats.gameId))
      .where(and(eq(sportPlayerGameStats.sport, sport), inArray(sportPlayerGameStats.season, [season - 1, season]), eq(sportGames.isFinal, true)));
    const only = req.nextUrl.searchParams.get("stat");
    const out: Record<string, unknown> = { season };
    for (const { statType, extract } of STAT_EXTRACTORS[sport]) {
      if (only && only !== statType) continue;
      const box: BoxRow[] = [];
      for (const r of rows) {
        const st = r.stats as Record<string, string>;
        const v = extract(st);
        if (v === null || minutesOf(st) === 0) continue;
        box.push({ gameId: r.gameId, team: r.team, player: r.player, position: r.position, season: r.season, at: r.kickoffAt?.getTime() ?? 0, value: v, min: minutesOf(st) });
      }
      out[statType] = returnCal(sport, box, propModelFor(sport, statType), STDDEV_FLOOR_ABS[sport][statType] ?? 1, season);
    }
    return NextResponse.json(out);
  }
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
      const fields: [string, "passYds" | "rushYds" | "recYds" | "receptions" | "rushRecYds"][] = [
        ["Pass Yds", "passYds"],
        ["Rush Yds", "rushYds"],
        ["Rec Yds", "recYds"],
        ["Receptions", "receptions"],
        ["Rush + Rec Yds", "rushRecYds"],
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
        out[stat] = calibrateStat(series, NFL_STDDEV_FLOOR_ABS[stat] ?? 5, NFL_PROP_MODEL[stat], stat === "Receptions");
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
    const only = req.nextUrl.searchParams.get("stat");
    for (const { statType, extract } of STAT_EXTRACTORS[sport]) {
      if (only && only !== statType) continue;
      const byPlayer = new Map<string, { t: number; v: number; min: number | null }[]>();
      for (const r of rows) {
        const st = r.stats as Record<string, string>;
        const v = extract(st);
        if (v === null) continue;
        const list = byPlayer.get(r.player) ?? [];
        list.push({ t: r.kickoffAt?.getTime() ?? 0, v, min: minutesOf(st) });
        byPlayer.set(r.player, list);
      }
      // ?all=1 keeps players who record the stat in under half their games
      // (needed for rare events: home runs, RBIs, goals).
      const all = req.nextUrl.searchParams.get("all") === "1";
      const series = [...byPlayer.entries()]
        .map(([player, values]) => ({ player, values: values.sort((a, b) => a.t - b.t) }))
        .filter((x) => (all ? x.values.length >= 10 : x.values.filter((v) => v.v > 0).length >= x.values.length * 0.5));
      // Yardage-type stats are continuous; everything else is a count.
      const isCount = !/Yds/.test(statType);
      out[statType] = calibrateStat(series, STDDEV_FLOOR_ABS[sport][statType] ?? 1, propModelFor(sport, statType), isCount);
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
