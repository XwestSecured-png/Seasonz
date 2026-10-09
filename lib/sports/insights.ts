// "Why the model picks this team" for every upcoming game on a sport page.
// Everything here is computed from synced data: ESPN schedules, scores, box
// scores, injury report and officiating crews, plus FanDuel and BetMGM
// lines. No columnist or expert opinion is used anywhere.
import { db } from "@/db";
import { sportGames, sportInjuryReports, sportTeamGameStats } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import type { SportKey } from "./types";
import { currentSeasonYear } from "./espn";
import { SPORT_ELO } from "./sport-elo";
import type { TeamForm } from "./nba-model";

type GameRow = typeof sportGames.$inferSelect;

export interface CompareRow {
  label: string;
  away: string;
  home: string;
  edge: "home" | "away" | null; // which side the number favors
}

export interface Insight {
  pick: string;
  pickPct: number;
  reasons: string[]; // the model's actual drivers, biggest first
  compare: CompareRow[]; // team stat comparison (per game)
  compareNote: string | null;
  meetings: { date: string; text: string }[];
  injuries: { team: string; player: string; status: string; ppg: number | null }[];
  officials: { names: string[]; style: string[] } | null;
  schedule: string[];
  odds: { book: string; ml: string; spread: string; total: string; edge: string | null }[];
}

const pctStr = (p: number) => `${Math.round(p * 100)}%`;
const f1 = (n: number) => n.toFixed(1);
const signed = (n: number, d = 1) => `${n >= 0 ? "+" : ""}${n.toFixed(d)}`;
const odds = (n: number | null | undefined) => (n == null ? "—" : n > 0 ? `+${n}` : `${n}`);
const implied = (a: number) => (a > 0 ? 100 / (a + 100) : -a / (-a + 100));
const dateEt = (d: Date | null) =>
  d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" }) : "";

interface ModelExtra {
  eloPct: number;
  formShift: number;
  injuryShift: number;
  homeForm: TeamForm | null;
  awayForm: TeamForm | null;
  homeOut: { player: string; status: string; ppg: number }[];
  awayOut: { player: string; status: string; ppg: number }[];
}
interface Extra {
  officials?: string[];
  odds?: Record<string, { mlHome: number | null; mlAway: number | null; spreadHome: number | null; spreadHomePrice: number | null; spreadAwayPrice: number | null; total: number | null; overPrice: number | null; underPrice: number | null }>;
  model?: ModelExtra;
}

export async function getGameInsights(sport: SportKey, upcoming: GameRow[]): Promise<Map<number, Insight>> {
  const out = new Map<number, Insight>();
  const games = upcoming.filter((g) => g.homeWinPctPre !== null);
  if (games.length === 0) return out;
  const season = currentSeasonYear(sport);
  const isHoops = sport === "nba" || sport === "wnba";

  const history = await db
    .select()
    .from(sportGames)
    .where(and(eq(sportGames.sport, sport), inArray(sportGames.season, [season - 1, season]), eq(sportGames.isFinal, true)));
  history.sort((a, b) => (a.kickoffAt?.getTime() ?? 0) - (b.kickoffAt?.getTime() ?? 0));
  const stats = isHoops
    ? await db
        .select()
        .from(sportTeamGameStats)
        .where(and(eq(sportTeamGameStats.sport, sport), inArray(sportTeamGameStats.season, [season - 1, season])))
    : [];
  const injuries = await db
    .select()
    .from(sportInjuryReports)
    .where(and(eq(sportInjuryReports.sport, sport), eq(sportInjuryReports.season, season)));

  const gameById = new Map(history.map((g) => [g.id, g]));
  const statsByTeam = new Map<string, typeof stats>();
  for (const r of stats) statsByTeam.set(r.team, [...(statsByTeam.get(r.team) ?? []), r]);
  for (const list of statsByTeam.values())
    list.sort((a, b) => (gameById.get(a.gameId)?.kickoffAt?.getTime() ?? 0) - (gameById.get(b.gameId)?.kickoffAt?.getTime() ?? 0));

  // Referee history: every crew member's games, fouls, free throws, points, home wins.
  const refAcc = new Map<string, { n: number; fouls: number; fta: number; pts: number; homeW: number }>();
  const lg = { n: 0, fouls: 0, fta: 0, pts: 0, homeW: 0 };
  if (isHoops) {
    const statsByGame = new Map<number, typeof stats>();
    for (const r of stats) statsByGame.set(r.gameId, [...(statsByGame.get(r.gameId) ?? []), r]);
    for (const g of history) {
      const pair = statsByGame.get(g.id);
      if (!pair || pair.length !== 2 || g.homeScore === null || g.awayScore === null) continue;
      const fouls = pair[0].fouls + pair[1].fouls;
      const fta = pair[0].fta + pair[1].fta;
      const pts = g.homeScore + g.awayScore;
      const hw = g.homeScore > g.awayScore ? 1 : 0;
      lg.n++;
      lg.fouls += fouls;
      lg.fta += fta;
      lg.pts += pts;
      lg.homeW += hw;
      for (const name of ((g.extra as Extra | null)?.officials ?? [])) {
        const a = refAcc.get(name) ?? { n: 0, fouls: 0, fta: 0, pts: 0, homeW: 0 };
        a.n++;
        a.fouls += fouls;
        a.fta += fta;
        a.pts += pts;
        a.homeW += hw;
        refAcc.set(name, a);
      }
    }
  }

  const finalsFor = (team: string, s: number) =>
    history.filter((g) => g.season === s && (g.homeTeam === team || g.awayTeam === team) && g.homeScore !== null && g.awayScore !== null);
  const won = (g: GameRow, team: string) => (g.homeTeam === team ? g.homeScore! > g.awayScore! : g.awayScore! > g.homeScore!);

  for (const g of games) {
    const ex = (g.extra ?? {}) as Extra;
    const pHome = g.homeWinPctPre!;
    const homePick = pHome >= 0.5;
    const pick = homePick ? g.homeTeam : g.awayTeam;
    const opp = homePick ? g.awayTeam : g.homeTeam;
    const pickPct = homePick ? pHome : 1 - pHome;
    const sideSign = homePick ? 1 : -1;
    const reasons: string[] = [];

    // --- Model drivers
    const m = ex.model;
    const eloPct = m?.eloPct ?? pHome;
    if (g.eloHomePre !== null && g.eloAwayPre !== null) {
      const mine = homePick ? g.eloHomePre : g.eloAwayPre;
      const theirs = homePick ? g.eloAwayPre : g.eloHomePre;
      const homeEdge = g.neutralSite ? "neutral court" : homePick ? `plus home court (worth about ${SPORT_ELO[sport].hfa} rating points)` : "despite playing on the road";
      reasons.push(
        `Power rating ${pick} ${Math.round(mine)} vs ${opp} ${Math.round(theirs)} (${signed(mine - theirs, 0)}), ${homeEdge}. On ratings and rest alone: ${pick} ${pctStr(homePick ? eloPct : 1 - eloPct)}.`
      );
    }
    if (m && m.formShift !== 0 && m.homeForm && m.awayForm) {
      const pf = homePick ? m.homeForm : m.awayForm;
      const of = homePick ? m.awayForm : m.homeForm;
      reasons.push(
        `Recent form (last ${Math.min(pf.games, of.games)}+ games): ${pick} ${signed(pf.mov)} points per game and ${signed(pf.paint)} in the paint, ${opp} ${signed(of.mov)} and ${signed(of.paint)}. That moves the pick ${signed(m.formShift * 100 * sideSign)} points.`
      );
    }
    if (m && m.injuryShift !== 0) {
      reasons.push(`Injuries and suspensions move it ${signed(m.injuryShift * 100 * sideSign)} points (see the injury list).`);
    }
    if (g.restDaysHome !== null || g.restDaysAway !== null) {
      const rp = homePick ? g.restDaysHome : g.restDaysAway;
      const ro = homePick ? g.restDaysAway : g.restDaysHome;
      if (rp !== null && ro !== null && rp !== ro) {
        reasons.push(
          rp > ro
            ? `Rest edge: ${pick} ${rp === 3 ? "3+" : rp} day(s) off vs ${ro} for ${opp}${ro === 0 ? " (back-to-back)" : ""}.`
            : `Rest works against ${pick} (${rp} vs ${ro} days), already counted above.`
        );
      }
    }
    reasons.push(`Final model chance: ${pick} ${pctStr(pickPct)}.`);

    // --- Team stat comparison (this season; last season until 5 games are in)
    const compare: CompareRow[] = [];
    let compareNote: string | null = null;
    if (isHoops) {
      const pick5 = (team: string) => {
        const all = statsByTeam.get(team) ?? [];
        const cur = all.filter((r) => r.season === season);
        return cur.length >= 5 ? { rows: cur, label: "this season" } : { rows: all.filter((r) => r.season === season - 1), label: "last season" };
      };
      const H = pick5(g.homeTeam);
      const A = pick5(g.awayTeam);
      compareNote =
        H.label === A.label
          ? `Per-game averages, ${H.label}${H.label === "last season" ? " (this season has fewer than 5 games)" : ""}.`
          : `Per-game averages: ${g.awayTeam} ${A.label}, ${g.homeTeam} ${H.label}.`;
      const avg = (rows: typeof stats, f: (r: (typeof stats)[number]) => number) =>
        rows.length ? rows.reduce((s, r) => s + f(r), 0) / rows.length : null;
      const row = (label: string, f: (r: (typeof stats)[number]) => number, higherIsBetter = true) => {
        const a = avg(A.rows, f);
        const h = avg(H.rows, f);
        if (a === null || h === null) return;
        const edge = Math.abs(a - h) < 0.05 ? null : (h > a) === higherIsBetter ? "home" : "away";
        compare.push({ label, away: f1(a), home: f1(h), edge });
      };
      row("Points scored", (r) => r.pts);
      row("Points allowed", (r) => r.oppPts, false);
      row("Points in the paint", (r) => r.paintPts);
      row("Offensive rebounds", (r) => r.oreb);
      row("Defensive rebounds", (r) => r.dreb);
      row("Turnovers", (r) => r.tov, false);
      row("Offensive fouls", (r) => r.offFouls, false);
      row("Defensive fouls", (r) => r.fouls - r.offFouls, false);
      row("3-pointers made", (r) => r.fg3m);
      row("Mid-range makes", (r) => r.midMade);
    }

    // Home / road records
    const recStr = (list: GameRow[], team: string) => `${list.filter((x) => won(x, team)).length}-${list.filter((x) => !won(x, team)).length}`;
    const hAll = finalsFor(g.homeTeam, season).length >= 3 ? season : season - 1;
    const aAll = finalsFor(g.awayTeam, season).length >= 3 ? season : season - 1;
    const hHome = finalsFor(g.homeTeam, hAll).filter((x) => x.homeTeam === g.homeTeam);
    const aRoad = finalsFor(g.awayTeam, aAll).filter((x) => x.awayTeam === g.awayTeam);
    compare.unshift(
      { label: "Overall record", away: recStr(finalsFor(g.awayTeam, aAll), g.awayTeam), home: recStr(finalsFor(g.homeTeam, hAll), g.homeTeam), edge: null },
      { label: `${g.homeTeam} at home / ${g.awayTeam} on the road`, away: recStr(aRoad, g.awayTeam), home: recStr(hHome, g.homeTeam), edge: null }
    );

    // Trends: last 10, streak, scoring trend
    const trend = (team: string) => {
      const list = [...finalsFor(team, season - 1), ...finalsFor(team, season)];
      const last10 = list.slice(-10);
      let streak = 0;
      for (let i = list.length - 1; i >= 0; i--) {
        const w = won(list[i], team);
        if (streak === 0) streak = w ? 1 : -1;
        else if ((streak > 0) === w) streak += w ? 1 : -1;
        else break;
      }
      const margin = (x: GameRow) => (x.homeTeam === team ? x.homeScore! - x.awayScore! : x.awayScore! - x.homeScore!);
      const m5 = list.slice(-5).reduce((s, x) => s + margin(x), 0) / Math.max(1, Math.min(5, list.length));
      return { l10: recStr(last10, team), streak: streak > 0 ? `W${streak}` : streak < 0 ? `L${-streak}` : "—", m5 };
    };
    const ta = trend(g.awayTeam);
    const th = trend(g.homeTeam);
    compare.push(
      { label: "Last 10 games", away: ta.l10, home: th.l10, edge: null },
      { label: "Streak", away: ta.streak, home: th.streak, edge: null },
      { label: "Avg margin, last 5", away: signed(ta.m5), home: signed(th.m5), edge: ta.m5 === th.m5 ? null : th.m5 > ta.m5 ? "home" : "away" }
    );

    // Past meetings with final scores (last two seasons)
    const meetings = history
      .filter((x) => (x.homeTeam === g.homeTeam && x.awayTeam === g.awayTeam) || (x.homeTeam === g.awayTeam && x.awayTeam === g.homeTeam))
      .slice(-5)
      .reverse()
      .map((x) => ({
        date: dateEt(x.kickoffAt),
        text: `${x.awayTeam} ${x.awayScore} @ ${x.homeTeam} ${x.homeScore} — ${x.homeScore! > x.awayScore! ? x.homeTeam : x.awayTeam} won by ${Math.abs(x.homeScore! - x.awayScore!)}`,
      }));

    // Injuries & suspensions
    const ppgOf = new Map<string, number>();
    for (const o of [...(m?.homeOut ?? []), ...(m?.awayOut ?? [])]) ppgOf.set(o.player, o.ppg);
    const inj = injuries
      .filter((r) => r.team === g.homeTeam || r.team === g.awayTeam)
      .map((r) => ({ team: r.team, player: r.player, status: r.status, ppg: ppgOf.get(r.player) ?? null }))
      .sort((a, b) => (b.ppg ?? 0) - (a.ppg ?? 0));

    // Officials
    let officials: Insight["officials"] = null;
    const names = ex.officials ?? [];
    if (names.length) {
      const style: string[] = [];
      const known = names.map((n) => ({ n, a: refAcc.get(n) })).filter((x) => x.a && x.a.n >= 10);
      if (known.length && lg.n > 0) {
        const avg = (k: "fouls" | "fta" | "pts" | "homeW") => known.reduce((s, x) => s + x.a![k] / x.a!.n, 0) / known.length;
        const L = (k: "fouls" | "fta" | "pts" | "homeW") => lg[k] / lg.n;
        style.push(`Fouls called: ${f1(avg("fouls"))} per game (league ${f1(L("fouls"))}) — ${avg("fouls") > L("fouls") + 1 ? "a whistle-heavy crew" : avg("fouls") < L("fouls") - 1 ? "lets them play" : "about average"}.`);
        style.push(`Free throws: ${f1(avg("fta"))} attempts per game (league ${f1(L("fta"))}).`);
        style.push(`Scoring: ${f1(avg("pts"))} total points per game (league ${f1(L("pts"))}).`);
        style.push(`Home teams win ${pctStr(avg("homeW"))} with these officials (league ${pctStr(L("homeW"))}).`);
        style.push(`Based on ${known.map((x) => `${x.n} (${x.a!.n} games)`).join(", ")}. Context only: in testing, crews didn't predict winners, so they don't change the pick.`);
      } else {
        style.push("Not enough past games with this crew in our data to describe their style yet.");
      }
      officials = { names, style };
    }

    // Schedule
    const sched = (team: string, rest: number | null) => {
      const list = [...finalsFor(team, season - 1), ...finalsFor(team, season)];
      const t = g.kickoffAt?.getTime() ?? Date.now();
      const last7 = list.filter((x) => (x.kickoffAt?.getTime() ?? 0) > t - 7 * 86_400_000).length;
      let stretch = 0;
      const where = g.homeTeam === team ? "home" : "road";
      for (let i = list.length - 1; i >= 0; i--) {
        const wasHome = list[i].homeTeam === team;
        if ((where === "home") === wasHome) stretch++;
        else break;
      }
      return `${team}: ${rest === null ? "first game of the season" : rest === 0 ? "second night of a back-to-back" : `${rest === 3 ? "3+" : rest} day(s) of rest`}, ${last7} game(s) in the last 7 days${stretch >= 2 ? `, ${stretch + 1} straight ${where} game(s) including this one` : ""}.`;
    };
    const schedule = [sched(g.awayTeam, g.restDaysAway), sched(g.homeTeam, g.restDaysHome)];

    // FanDuel / BetMGM
    const oddsRows: Insight["odds"] = [];
    for (const [key, label] of [["fanduel", "FanDuel"], ["betmgm", "BetMGM"]] as const) {
      const b = ex.odds?.[key];
      if (!b) continue;
      const ml = homePick ? b.mlHome : b.mlAway;
      const edge = ml != null ? pickPct - implied(ml) : null;
      oddsRows.push({
        book: label,
        ml: `${g.awayTeam} ${odds(b.mlAway)} / ${g.homeTeam} ${odds(b.mlHome)}`,
        spread: b.spreadHome == null ? "—" : `${g.homeTeam} ${b.spreadHome > 0 ? "+" : ""}${b.spreadHome} (${odds(b.spreadHomePrice)})`,
        total: b.total == null ? "—" : `${b.total} (O ${odds(b.overPrice)} / U ${odds(b.underPrice)})`,
        edge:
          edge == null
            ? null
            : `${pick} at ${odds(ml)} implies ${pctStr(implied(ml!))}; model says ${pctStr(pickPct)} (${signed(edge * 100)} pts${edge > 0.03 ? ", value" : edge < -0.03 ? ", price too short" : ""}).`,
      });
    }

    out.set(g.id, { pick, pickPct, reasons, compare, compareNote, meetings, injuries: inj, officials, schedule, odds: oddsRows });
  }
  return out;
}
