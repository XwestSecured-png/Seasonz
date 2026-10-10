// The prediction stages every sport runs after its schedule/Elo/box-score
// stages (see lib/sports/sync.ts):
//
//   preview  — ESPN scoreboard for the next few days: probable starting
//              pitchers / goalies, venue, and ESPN's posted moneyline.
//   gameOdds — FanDuel and BetMGM moneyline, spread and total.
//   weather  — game-time forecast for outdoor MLB and college football.
//   model    — the win chance for every game (lib/sports/game-model.ts).
import { db } from "@/db";
import { sportGames, sportInjuryReports, sportPlayerGameStats, sportTeamGameStats, sportTeams } from "@/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { SPORTS, type SportKey } from "./types";
import { fetchScoreboardPreview, fetchEspnEventMoneyline, type PreviewEvent } from "./espn";
import { fetchGameOddsForSport } from "./game-odds";
import { makeTeamResolver } from "./team-match";
import { formBefore, nbaWinProb, type FormRow } from "./nba-model";
import {
  GAME_MODEL,
  modelOnlyPct,
  injuryShift,
  blendWithMarket,
  noVigHome,
  calibrate,
  applyCalibration,
  pitcherRuns9,
  inningsToNumber,
  type Calibration,
} from "./game-model";
import { geocodeCity, forecastAt, type GameWeather } from "./weather";

type StageResult = { stage: string; status: "ok" | "error" | "skipped"; detail: string };
type LogStage = (stage: string, fn: () => Promise<string>) => Promise<StageResult>;

const HOUR = 3600_000;
const DAY = 86_400_000;

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    })
  );
}

/** Merges `key: value` into each game's extra JSON, in batches. */
async function mergeExtra(key: string, rows: { id: number; value: unknown }[]) {
  for (let i = 0; i < rows.length; i += 300) {
    const chunk = rows.slice(i, i + 300);
    const values = sql.join(
      chunk.map((r) => sql`(${r.id}::int, ${JSON.stringify(r.value)}::jsonb)`),
      sql`, `
    );
    await db.execute(sql`
      update ${sportGames} as g set extra = coalesce(g.extra, '{}'::jsonb) || jsonb_build_object(${key}::text, v.x)
      from (values ${values}) as v(id, x)
      where g.id = v.id`);
  }
}

function etDateKey(d: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(d)
      .map((x) => [x.type, x.value])
  );
  return `${p.year}${p.month}${p.day}`;
}

export interface PreviewExtra {
  homeProbable: string | null;
  awayProbable: string | null;
  venue: PreviewEvent["venue"];
  espnOdds: PreviewEvent["espnOdds"];
  updatedAt: string;
}

type BookLine = { mlHome: number | null; mlAway: number | null };
interface GameExtra {
  odds?: { fanduel?: BookLine; betmgm?: BookLine };
  preview?: PreviewExtra;
  weather?: GameWeather;
  noBox?: boolean;
  [k: string]: unknown;
}

const OUT_RE = /\bOUT\b|SUSPEND|\bIL\b|INJURED RESERVE|^IR$/i;

export async function runModelStages(sport: SportKey, year: number, logStage: LogStage): Promise<StageResult[]> {
  const def = SPORTS[sport];
  const results: StageResult[] = [];

  // ------------------------------------------------------------------ preview
  results.push(
    await logStage(`${sport}:preview`, async () => {
      const now = Date.now();
      const upcoming = (
        await db
          .select({ id: sportGames.id, espnEventId: sportGames.espnEventId, kickoffAt: sportGames.kickoffAt, extra: sportGames.extra })
          .from(sportGames)
          .where(and(eq(sportGames.sport, sport), eq(sportGames.season, year), eq(sportGames.isFinal, false)))
      ).filter((g) => g.kickoffAt && g.kickoffAt.getTime() > now - 6 * HOUR && g.kickoffAt.getTime() < now + 5 * DAY);
      if (upcoming.length === 0) return "No games in the next 5 days.";

      const dates = Array.from(new Set(upcoming.map((g) => etDateKey(g.kickoffAt!)))).sort();
      const byEvent = new Map<string, PreviewEvent>();
      const failed: string[] = [];
      await pool(dates, 4, async (d) => {
        try {
          for (const e of await fetchScoreboardPreview(def, d)) byEvent.set(e.espnEventId, e);
        } catch {
          failed.push(d);
        }
      });

      // ESPN's line for games the scoreboard didn't carry one for (next 3 days only).
      const needLine = upcoming
        .filter((g) => !byEvent.get(g.espnEventId)?.espnOdds && g.kickoffAt!.getTime() < now + 3 * DAY)
        .slice(0, 80);
      let coreHits = 0;
      await pool(needLine, 8, async (g) => {
        const ml = await fetchEspnEventMoneyline(def, g.espnEventId);
        if (!ml) return;
        const ev = byEvent.get(g.espnEventId);
        if (ev) ev.espnOdds = ml;
        else
          byEvent.set(g.espnEventId, {
            espnEventId: g.espnEventId,
            homeAbbr: "",
            awayAbbr: "",
            homeProbable: null,
            awayProbable: null,
            venue: null,
            espnOdds: ml,
          });
        coreHits++;
      });

      const rows: { id: number; value: PreviewExtra }[] = [];
      for (const g of upcoming) {
        const ev = byEvent.get(g.espnEventId);
        if (!ev) continue;
        const prev = (g.extra as GameExtra | null)?.preview;
        rows.push({
          id: g.id,
          value: {
            homeProbable: ev.homeProbable ?? prev?.homeProbable ?? null,
            awayProbable: ev.awayProbable ?? prev?.awayProbable ?? null,
            venue: ev.venue ?? prev?.venue ?? null,
            espnOdds: ev.espnOdds ?? prev?.espnOdds ?? null,
            updatedAt: new Date().toISOString(),
          },
        });
      }
      await mergeExtra("preview", rows);
      const withLine = rows.filter((r) => r.value.espnOdds).length;
      const withProb = rows.filter((r) => r.value.homeProbable || r.value.awayProbable).length;
      return (
        `Previewed ${rows.length} of ${upcoming.length} upcoming game(s): ${withLine} with ESPN's line (${coreHits} from the odds feed)` +
        (sport === "mlb" || sport === "nhl" ? `, ${withProb} with a probable ${sport === "mlb" ? "pitcher" : "goalie"}` : "") +
        (failed.length ? `; scoreboard failed for ${failed.join(", ")}` : "") +
        "."
      );
    })
  );

  // ----------------------------------------------------------------- gameOdds
  results.push(
    await logStage(`${sport}:gameOdds`, async () => {
      const teamRows = await db.select().from(sportTeams).where(eq(sportTeams.sport, sport));
      const resolve = makeTeamResolver(teamRows);
      const board = await fetchGameOddsForSport(sport);
      if (board.length === 0) return "No FanDuel/BetMGM board posted (or no odds key).";
      const upcoming = await db
        .select()
        .from(sportGames)
        .where(and(eq(sportGames.sport, sport), eq(sportGames.season, year), eq(sportGames.isFinal, false)));
      let matched = 0;
      for (const ev of board) {
        const t = Date.parse(ev.commenceTime);
        const near = upcoming.filter((x) => x.kickoffAt && Math.abs(x.kickoffAt.getTime() - t) < 18 * HOUR);
        const cands = new Set(near.flatMap((x) => [x.homeTeam, x.awayTeam]));
        const home = resolve(ev.homeTeam, cands);
        const away = resolve(ev.awayTeam, cands);
        const g = near.find((x) => x.homeTeam === home && x.awayTeam === away);
        if (!g) continue;
        const main = ev.books.fanduel ?? ev.books.betmgm;
        const book = ev.books.fanduel ? "FanDuel" : "BetMGM";
        await db
          .update(sportGames)
          .set({
            extra: { ...((g.extra as object) ?? {}), odds: ev.books, oddsUpdatedAt: new Date().toISOString() },
            moneylineHomeOdds: main?.mlHome ?? null,
            moneylineAwayOdds: main?.mlAway ?? null,
            moneylineBook: main ? book : null,
            spreadHomeLine: main?.spreadHome ?? null,
            spreadHomePriceAmerican: main?.spreadHomePrice ?? null,
            spreadAwayPriceAmerican: main?.spreadAwayPrice ?? null,
            spreadBook: main ? book : null,
            totalLine: main?.total ?? null,
            totalOverPriceAmerican: main?.overPrice ?? null,
            totalUnderPriceAmerican: main?.underPrice ?? null,
            totalBook: main ? book : null,
          })
          .where(eq(sportGames.id, g.id));
        matched++;
      }
      return `FanDuel/BetMGM odds matched to ${matched} of ${board.length} board game(s).`;
    })
  );

  // ------------------------------------------------------------------ weather
  if (sport === "mlb" || sport === "ncaaf") {
    results.push(
      await logStage(`${sport}:weather`, async () => {
        const now = Date.now();
        const games = (
          await db
            .select({ id: sportGames.id, kickoffAt: sportGames.kickoffAt, extra: sportGames.extra })
            .from(sportGames)
            .where(and(eq(sportGames.sport, sport), eq(sportGames.season, year), eq(sportGames.isFinal, false)))
        ).filter((g) => {
          const t = g.kickoffAt?.getTime() ?? 0;
          const ex = (g.extra ?? {}) as GameExtra;
          const fresh = ex.weather && Date.parse(ex.weather.fetchedAt) > now - 6 * HOUR;
          return t > now - HOUR && t < now + 6 * DAY && ex.preview?.venue?.city && ex.preview.venue.indoor !== true && !fresh;
        });
        if (games.length === 0) return "No outdoor games needing a forecast.";
        const rows: { id: number; value: GameWeather }[] = [];
        let failed = 0;
        await pool(games.slice(0, 150), 6, async (g) => {
          const v = ((g.extra ?? {}) as GameExtra).preview!.venue!;
          try {
            const loc = await geocodeCity(v.city!, v.state);
            if (!loc) return;
            const w = await forecastAt(loc.lat, loc.lon, g.kickoffAt!);
            if (w) rows.push({ id: g.id, value: w });
          } catch {
            failed++;
          }
        });
        await mergeExtra("weather", rows);
        return `Forecast saved for ${rows.length} of ${games.length} outdoor game(s)${failed ? ` (${failed} failed)` : ""}.`;
      })
    );
  }

  // -------------------------------------------------------------------- model
  results.push(await logStage(`${sport}:model`, () => runModel(sport, year)));
  return results;
}

interface PlayerValue {
  player: string;
  status: string;
  value: number; // in the sport's scoring unit above replacement
  ppg: number; // what's shown: points / points (G+A) / runs+RBI / yards per game
}

async function runModel(sport: SportKey, year: number): Promise<string> {
  const P = GAME_MODEL[sport];
  const games = await db
    .select()
    .from(sportGames)
    .where(and(eq(sportGames.sport, sport), eq(sportGames.season, year)));
  if (games.length === 0) return "No games.";
  games.sort((a, b) => (a.kickoffAt?.getTime() ?? 0) - (b.kickoffAt?.getTime() ?? 0));
  const now = Date.now();
  const ms = (g: { kickoffAt: Date | null }) => g.kickoffAt?.getTime() ?? 0;

  // Recent scoring margin (this season), per team, oldest first.
  const marginLog = new Map<string, { ms: number; m: number }[]>();
  for (const g of games) {
    if (!g.isFinal || g.homeScore === null || g.awayScore === null) continue;
    const add = (t: string, m: number) => marginLog.set(t, [...(marginLog.get(t) ?? []), { ms: ms(g), m }]);
    add(g.homeTeam, g.homeScore - g.awayScore);
    add(g.awayTeam, g.awayScore - g.homeScore);
  }
  const formAvg = (team: string, before: number): { n: number; avg: number } | null => {
    const prior = (marginLog.get(team) ?? []).filter((x) => x.ms < before).slice(-P.formN);
    if (prior.length < 5) return null;
    return { n: prior.length, avg: prior.reduce((s, x) => s + x.m, 0) / prior.length };
  };

  // NBA: paint + margin form from team box scores (lib/sports/nba-model.ts).
  const nbaForm = new Map<string, FormRow[]>();
  if (sport === "nba") {
    const statRows = await db
      .select()
      .from(sportTeamGameStats)
      .where(and(eq(sportTeamGameStats.sport, sport), eq(sportTeamGameStats.season, year)));
    const gameMs = new Map(games.map((g) => [g.id, ms(g)]));
    const byGame = new Map<number, typeof statRows>();
    for (const r of statRows) byGame.set(r.gameId, [...(byGame.get(r.gameId) ?? []), r]);
    for (const [gid, pair] of byGame) {
      if (pair.length !== 2) continue;
      for (const r of pair) {
        const o = pair.find((x) => x !== r)!;
        nbaForm.set(r.team, [...(nbaForm.get(r.team) ?? []), { ms: gameMs.get(gid) ?? 0, mov: r.pts - r.oppPts, paint: r.paintPts - o.paintPts }]);
      }
    }
    for (const list of nbaForm.values()) list.sort((a, b) => a.ms - b.ms);
  }

  // Player box scores (this season and last) for starters and injuries.
  const lines = await db
    .select({
      gameId: sportPlayerGameStats.gameId,
      team: sportPlayerGameStats.team,
      player: sportPlayerGameStats.player,
      position: sportPlayerGameStats.position,
      stats: sportPlayerGameStats.stats,
      kickoffAt: sportGames.kickoffAt,
    })
    .from(sportPlayerGameStats)
    .innerJoin(sportGames, eq(sportGames.id, sportPlayerGameStats.gameId))
    .where(and(eq(sportPlayerGameStats.sport, sport), inArray(sportPlayerGameStats.season, [year - 1, year])));
  const S = (r: { stats: unknown }) => (r.stats ?? {}) as Record<string, string>;
  const N = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  // --- MLB starting pitchers
  const starterOf = new Map<string, string>(); // `${gameId}|${team}` -> name
  const pitcherLog = new Map<string, { ms: number; ip: number; er: number; hr: number; bb: number; k: number }[]>();
  // --- NHL goalies
  const goalieStarts = new Map<number, Map<string, string>>(); // gameId -> team -> goalie
  if (sport === "mlb") {
    const byGameTeam = new Map<string, typeof lines>();
    for (const r of lines) {
      const s = S(r);
      if (!("IP" in s)) continue;
      const ip = inningsToNumber(s.IP);
      const k = `${r.gameId}|${r.team}`;
      byGameTeam.set(k, [...(byGameTeam.get(k) ?? []), r]);
      pitcherLog.set(r.player, [
        ...(pitcherLog.get(r.player) ?? []),
        { ms: r.kickoffAt?.getTime() ?? 0, ip, er: N(s.ER), hr: N(s.HR), bb: N(s.BB), k: N(s.K) },
      ]);
    }
    for (const [k, list] of byGameTeam) {
      const ranked = [...list].sort(
        (a, b) => (b.position === "SP" ? 1 : 0) - (a.position === "SP" ? 1 : 0) || inningsToNumber(S(b).IP) - inningsToNumber(S(a).IP)
      );
      starterOf.set(k, ranked[0].player);
    }
  }
  if (sport === "nhl") {
    const toi = (v: string | undefined) => {
      const [m, s] = String(v ?? "0:0").split(":").map(Number);
      return (m || 0) * 60 + (s || 0);
    };
    const best = new Map<string, { player: string; toi: number }>();
    for (const r of lines) {
      const s = S(r);
      if (s.group !== "goalies") continue;
      const k = `${r.gameId}|${r.team}`;
      const t = toi(s.TOI);
      if (!best.has(k) || best.get(k)!.toi < t) best.set(k, { player: r.player, toi: t });
    }
    for (const [k, v] of best) {
      const [gid, team] = k.split("|");
      const m = goalieStarts.get(Number(gid)) ?? new Map<string, string>();
      m.set(team, v.player);
      goalieStarts.set(Number(gid), m);
    }
  }
  const pitcherBefore = (name: string | null | undefined, before: number) => {
    if (!name) return null;
    const log = (pitcherLog.get(name) ?? []).filter((x) => x.ms < before);
    return { name, ...pitcherRuns9(log), starts: log.length };
  };

  // --- Injuries: OUT / IL / suspended, valued per sport.
  const injuries = await db
    .select()
    .from(sportInjuryReports)
    .where(and(eq(sportInjuryReports.sport, sport), eq(sportInjuryReports.season, year)));
  const outRows = injuries.filter((r) => OUT_RE.test(r.status.trim()) && !/DAY-TO-DAY/i.test(r.status));
  const perPlayer = new Map<string, { n: number; pts: number; ga: number; runs: number; pass: number; skill: number; pitcher: boolean; goalie: boolean }>();
  for (const r of lines) {
    const s = S(r);
    const a = perPlayer.get(r.player) ?? { n: 0, pts: 0, ga: 0, runs: 0, pass: 0, skill: 0, pitcher: false, goalie: false };
    a.n++;
    a.pts += N(s.PTS);
    a.ga += N(s.G) + N(s.A);
    a.runs += (N(s.R) + N(s.RBI)) / 2;
    if (s.group === "passing") a.pass += N(s.YDS);
    if (s.group === "rushing" || s.group === "receiving") a.skill += N(s.YDS);
    if ("IP" in s) a.pitcher = true;
    if (s.group === "goalies") a.goalie = true;
    perPlayer.set(r.player, a);
  }
  // College box scores list a player once per stat group, so per-game means
  // use distinct games, approximated by the most common group count.
  const valueOf = (player: string): { value: number; shown: number } => {
    const a = perPlayer.get(player);
    if (!a || a.n < 3) return { value: 0, shown: 0 };
    switch (sport) {
      case "nba":
      case "wnba":
      case "ncaab": {
        const ppg = a.pts / a.n;
        return { value: Math.max(0, ppg - P.replacement), shown: ppg };
      }
      case "nhl": {
        if (a.goalie) return { value: 0, shown: 0 }; // goalies are handled by the starter feature
        const p = a.ga / a.n;
        return { value: Math.max(0, p - P.replacement) / 1.7, shown: p };
      }
      case "mlb": {
        if (a.pitcher) return { value: 0, shown: 0 }; // starters handled separately
        const r = a.runs / a.n;
        return { value: Math.max(0, r - P.replacement), shown: r };
      }
      case "ncaaf": {
        const pass = a.pass / a.n;
        const skill = a.skill / a.n;
        const pts = Math.max(0, pass - 120) / 15 + Math.max(0, skill - 25) / 15;
        return { value: pts, shown: pass + skill };
      }
    }
  };
  const outByTeam = new Map<string, PlayerValue[]>();
  for (const r of outRows) {
    const v = valueOf(r.player);
    outByTeam.set(r.team, [...(outByTeam.get(r.team) ?? []), { player: r.player, status: r.status.toUpperCase(), value: v.value, ppg: +v.shown.toFixed(1) }]);
  }
  for (const list of outByTeam.values()) list.sort((a, b) => b.value - a.value);

  // --- Score every game.
  const teamGoalieCount = new Map<string, Map<string, number>>();
  const out: {
    id: number;
    pct: number;
    upcoming: boolean;
    model: Record<string, unknown>;
    homeWon: number | null;
  }[] = [];
  for (const g of games) {
    if (g.homeWinPctPre === null) continue;
    const t = ms(g);
    const ex = (g.extra ?? {}) as GameExtra;
    const prevModel = (ex as { model?: { eloPct?: number } }).model;
    // The Elo stage rewrites home_win_pct_pre to pure Elo every run before this stage.
    const eloPct = g.homeWinPctPre;
    const upcoming = !g.isFinal && t > now - 6 * HOUR;

    // Form
    let formDiff: number | null = null;
    let homeForm: unknown = null;
    let awayForm: unknown = null;
    let pModel: number;
    let starter: Record<string, unknown> | null = null;
    let backup: number | null = null;
    if (sport === "nba") {
      const hf = formBefore(nbaForm.get(g.homeTeam) ?? [], t);
      const af = formBefore(nbaForm.get(g.awayTeam) ?? [], t);
      homeForm = hf;
      awayForm = af;
      pModel = nbaWinProb(eloPct, hf, af);
    } else {
      const hf = formAvg(g.homeTeam, t);
      const af = formAvg(g.awayTeam, t);
      homeForm = hf;
      awayForm = af;
      formDiff = hf && af ? hf.avg - af.avg : null;
      let starterDiff: number | null = null;
      if (sport === "mlb") {
        const hName = g.isFinal ? starterOf.get(`${g.id}|${g.homeTeam}`) : ex.preview?.homeProbable;
        const aName = g.isFinal ? starterOf.get(`${g.id}|${g.awayTeam}`) : ex.preview?.awayProbable;
        const hp = pitcherBefore(hName, t);
        const ap = pitcherBefore(aName, t);
        if (hp && ap) starterDiff = ap.value - hp.value;
        starter = { home: hp, away: ap, diff: starterDiff };
      }
      if (sport === "nhl") {
        const share = (team: string, goalie: string | null | undefined) => {
          const m = teamGoalieCount.get(team);
          if (!goalie || !m) return null;
          const total = [...m.values()].reduce((s, x) => s + x, 0);
          if (total < 5) return null;
          return (m.get(goalie) ?? 0) / total;
        };
        const starts = goalieStarts.get(g.id);
        const hG = g.isFinal ? starts?.get(g.homeTeam) : ex.preview?.homeProbable;
        const aG = g.isFinal ? starts?.get(g.awayTeam) : ex.preview?.awayProbable;
        const hs = share(g.homeTeam, hG);
        const as = share(g.awayTeam, aG);
        const hBackup = hs !== null && hs < 0.35;
        const aBackup = as !== null && as < 0.35;
        backup = (aBackup ? 1 : 0) - (hBackup ? 1 : 0);
        starter = { home: hG ?? null, away: aG ?? null, homeShare: hs, awayShare: as, homeBackup: hBackup, awayBackup: aBackup };
        if (g.isFinal && starts) {
          for (const [team, goalie] of starts) {
            const m = teamGoalieCount.get(team) ?? new Map<string, number>();
            m.set(goalie, (m.get(goalie) ?? 0) + 1);
            teamGoalieCount.set(team, m);
          }
        }
      }
      pModel = modelOnlyPct(sport, { eloPct, formDiff, starterDiff, backup });
    }
    const formShift = pModel - eloPct;

    // Injuries — ESPN's report is "as of now".
    let injShift = 0;
    // Only for games in the next week: today's report says little about a game months away.
    const injWindow = upcoming && t < now + 7 * DAY;
    const homeOut = injWindow ? (outByTeam.get(g.homeTeam) ?? []) : [];
    const awayOut = injWindow ? (outByTeam.get(g.awayTeam) ?? []) : [];
    if (injWindow) {
      const lost = (l: PlayerValue[]) => l.reduce((s, p) => s + p.value, 0);
      injShift = injuryShift(sport, pModel, lost(homeOut), lost(awayOut));
    }
    const modelOnly = pModel + injShift;

    // Market: FanDuel, then BetMGM, then ESPN's line.
    let marketPct: number | null = null;
    let marketSource: string | null = null;
    for (const [k, label] of [["fanduel", "FanDuel"], ["betmgm", "BetMGM"]] as const) {
      const b = ex.odds?.[k];
      const p = b ? noVigHome(b.mlHome, b.mlAway) : null;
      if (p !== null) {
        marketPct = p;
        marketSource = label;
        break;
      }
    }
    if (marketPct === null && ex.preview?.espnOdds) {
      marketPct = noVigHome(ex.preview.espnOdds.mlHome, ex.preview.espnOdds.mlAway);
      marketSource = marketPct !== null ? `ESPN (${ex.preview.espnOdds.provider})` : null;
    }
    const blended = blendWithMarket(sport, modelOnly, marketPct);

    out.push({
      id: g.id,
      pct: blended,
      upcoming,
      homeWon: g.isFinal && g.homeScore !== null && g.awayScore !== null && g.homeScore !== g.awayScore ? (g.homeScore > g.awayScore ? 1 : 0) : null,
      model: {
        eloPct,
        formShift,
        formDiff,
        homeForm,
        awayForm,
        starter,
        injuryShift: injShift,
        homeOut: homeOut.slice(0, 8),
        awayOut: awayOut.slice(0, 8),
        modelOnlyPct: modelOnly,
        marketPct,
        marketSource,
        marketShift: blended - modelOnly,
        version: 2,
        prevElo: prevModel?.eloPct ?? null,
      },
    });
  }

  // Calibration check on this season's graded games, applied to upcoming ones.
  const graded = out.filter((o) => o.homeWon !== null).map((o) => ({ pct: o.pct, homeWon: o.homeWon! }));
  const cal: Calibration = calibrate(graded);
  for (const o of out) {
    if (!o.upcoming) continue;
    const before = o.pct;
    o.pct = applyCalibration(o.pct, cal);
    o.model.calibrationShift = o.pct - before;
  }

  // Write: every game's number; the full breakdown for upcoming and recent games.
  for (let i = 0; i < out.length; i += 300) {
    const chunk = out.slice(i, i + 300);
    const values = sql.join(chunk.map((u) => sql`(${u.id}::int, ${u.pct}::float8)`), sql`, `);
    await db.execute(sql`
      update ${sportGames} as g set home_win_pct_pre = v.p
      from (values ${values}) as v(id, p)
      where g.id = v.id`);
  }
  const recentCut = now - 3 * DAY;
  const kickById = new Map(games.map((g) => [g.id, ms(g)]));
  const finalById = new Map(games.map((g) => [g.id, g.isFinal]));
  const detailed = out.filter((o) => o.upcoming || (kickById.get(o.id) ?? 0) > recentCut);
  await mergeExtra(
    "model",
    detailed.map((o) => ({ id: o.id, value: { ...o.model, final: o.pct } }))
  );
  // Lock in the pre-game number: the last value written before a game
  // starts is what the scorecard grades, so later model changes can never
  // rewrite the record.
  await mergeExtra(
    "locked",
    out
      .filter((o) => !finalById.get(o.id) && (kickById.get(o.id) ?? 0) > now)
      .map((o) => ({ id: o.id, value: { pct: o.pct, at: new Date(now).toISOString(), market: o.model.marketPct ?? null } }))
  );
  await mergeExtra(
    "calibration",
    detailed.filter((o) => o.upcoming).map((o) => ({ id: o.id, value: cal }))
  );

  const up = out.filter((o) => o.upcoming);
  const withMarket = up.filter((o) => o.model.marketPct !== null).length;
  const withStarter = up.filter((o) => {
    const s = o.model.starter as { home?: unknown; away?: unknown } | null;
    return s && s.home && s.away;
  }).length;
  const withInj = up.filter((o) => o.model.injuryShift !== 0).length;
  return (
    `Model scored ${out.length} game(s) (${up.length} upcoming: ${withMarket} with a betting line, ${withInj} with injury adjustments` +
    (sport === "mlb" || sport === "nhl" ? `, ${withStarter} with both starters known` : "") +
    `). Calibration on ${cal.n} graded game(s): ${cal.applied ? `applied (a ${cal.a}, b ${cal.b})` : "not needed"}.`
  );
}
