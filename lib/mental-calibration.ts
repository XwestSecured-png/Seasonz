// "Mental toughness" and "human error" checks (/api/health/insights?mentalcal=<sport>).
// Everything here is measured from box scores and final scores, then scored
// the same way as lib/signal-calibration.ts: last season (train) and this
// season (test) separately, so only signals that help on both get adopted.
//
// Player props (multiplier on the projection, log loss at lines around it):
//   lastBad / lastGreat   bounce-back: last game far below / above his norm
//   cold3 / hot3          slump or hot streak: last 3 games all below / above
//   afterLoss / afterBigLoss / afterWin   how players respond to adversity
//   tossup                game expected to be close (pre-game 42-58%)
//   clutchUp / clutchDown his own record in earlier close-expected games
//                         (a "clutch" trait), applied in close-expected games
//   oppErrA/B hi|lo       opponent's recent error rate (basketball turnovers /
//                         fouls, hockey giveaways / penalty minutes, college
//                         football turnovers)
//   ownErrA hi            own team's recent error rate
// Games (log-odds shift on the Elo win chance, standardized):
//   closeLuck   record in close games vs what Elo expected ("clutch" teams)
//   luck        record in all games vs Elo's expectation
//   afterLoss   coming off a loss
//   errA / errB recent error rates (home minus away)
import { projectProp, propChance, type PropModelConfig } from "./prop-dist";
import { replaySportElo } from "./sports/sport-elo";
import type { SportKey } from "./sports/types";

const N = (v: unknown) => {
  const n = Number(String(v ?? "").split(/[-/]/)[0]);
  return Number.isFinite(n) ? n : 0;
};
const ll = (y: number, p: number) => {
  const q = Math.min(0.999, Math.max(0.001, p));
  return -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
};
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
const sdOf = (v: number[]) => {
  const m = mean(v);
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, v.length - 1));
};

/** A team's mistakes in one game: [A, B]. */
export function errorsOf(sport: string, s: Record<string, unknown>): [number, number] {
  if (sport === "nba" || sport === "wnba" || sport === "ncaab") return [N(s.TO), N(s.PF)];
  if (sport === "nhl") return s.group === "goalies" ? [0, N(s.PIM)] : [N(s.GV), N(s.PIM)];
  if (sport === "ncaaf") {
    if (s.group === "fumbles") return [N(s.LOST), 0];
    if (s.group === "passing") return [N(s.INT), 0];
    return [0, 0];
  }
  return [0, 0];
}

/** Close-game margin per sport (final margin at or below this). */
const CLOSE: Record<string, number> = { nba: 5, wnba: 5, ncaab: 5, nhl: 1, mlb: 1, ncaaf: 8 };

export interface MentalGame {
  id: number;
  season: number;
  week: number;
  kickoffAt: Date | null;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  isFinal: boolean;
  neutralSite: boolean;
}

export interface MentalRow {
  gameId: number;
  team: string;
  player: string;
  season: number;
  at: number;
  stats: Record<string, string>;
}

interface TeamState {
  games: number;
  close: number;
  closeLuck: number;
  luck: number;
  lastLost: number; // 0 / 1 / 2 (lost by a lot)
  errA: number[];
  errB: number[];
}

/**
 * Walks every game in order, keeping each team's running "luck" and recent
 * error rates. Returns the point-in-time state before each game.
 */
function teamTimeline(sport: SportKey, games: MentalGame[], teamErr: Map<string, [number, number]>) {
  const { results } = replaySportElo(sport, games);
  const st = new Map<string, TeamState>();
  const get = (t: string) => st.get(t) ?? st.set(t, { games: 0, close: 0, closeLuck: 0, luck: 0, lastLost: 0, errA: [], errB: [] }).get(t)!;
  const before = new Map<number, { prob: number; home: TeamState; away: TeamState }>();
  // League error averages (all games), for standardizing.
  const allA: number[] = [];
  const allB: number[] = [];
  for (const v of teamErr.values()) {
    allA.push(v[0]);
    allB.push(v[1]);
  }
  const lg = { a: mean(allA), sa: sdOf(allA) || 1, b: mean(allB), sb: sdOf(allB) || 1 };
  let season = -1;
  const big = (CLOSE[sport] ?? 3) * 3;
  for (const r of results) {
    const g = r.game;
    if (g.season !== season) {
      st.clear();
      season = g.season;
    }
    const h = get(g.homeTeam);
    const a = get(g.awayTeam);
    before.set(g.id, { prob: r.homeWinProbPre, home: { ...h, errA: [...h.errA], errB: [...h.errB] }, away: { ...a, errA: [...a.errA], errB: [...a.errB] } });
    if (!g.isFinal || g.homeScore === null || g.awayScore === null) continue;
    const won = g.homeScore > g.awayScore ? 1 : g.homeScore < g.awayScore ? 0 : 0.5;
    const margin = Math.abs(g.homeScore - g.awayScore);
    for (const [t, s, w, p] of [
      [g.homeTeam, h, won, r.homeWinProbPre],
      [g.awayTeam, a, 1 - won, 1 - r.homeWinProbPre],
    ] as const) {
      s.games++;
      s.luck += w - p;
      if (margin <= (CLOSE[sport] ?? 3)) {
        s.close++;
        s.closeLuck += w - p;
      }
      s.lastLost = w === 0 ? (margin >= big ? 2 : 1) : 0;
      const e = teamErr.get(`${g.id}|${t}`);
      if (e) {
        s.errA.push((e[0] - lg.a) / lg.sa);
        s.errB.push((e[1] - lg.b) / lg.sb);
        if (s.errA.length > 10) s.errA.shift();
        if (s.errB.length > 10) s.errB.shift();
      }
    }
  }
  return before;
}

type Acc = Record<string, { grid: number[]; ll: number[]; n: number }>;
function report(acc: Acc, zero: number, zero2?: number) {
  const out: Record<string, { n: number; best: number; base: number; bestLl: number; gainPct: number }> = {};
  for (const [k, a] of Object.entries(acc)) {
    let bj = 0;
    a.ll.forEach((v, j) => {
      if (v < a.ll[bj]) bj = j;
    });
    const z = a.grid.indexOf(zero) >= 0 ? a.grid.indexOf(zero) : a.grid.indexOf(zero2 ?? zero);
    out[k] = {
      n: a.n,
      best: a.grid[bj],
      base: +(a.ll[z] / a.n).toFixed(4),
      bestLl: +(a.ll[bj] / a.n).toFixed(4),
      gainPct: +(((a.ll[z] - a.ll[bj]) / a.ll[z]) * 100).toFixed(2),
    };
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/** Team-level: does "clutch" record, luck, a loss or sloppiness predict the next game beyond Elo? */
export function gameMentalCal(sport: SportKey, games: MentalGame[], teamErr: Map<string, [number, number]>, testSeason: number) {
  const before = teamTimeline(sport, games, teamErr);
  const B = [-0.3, -0.2, -0.1, -0.05, 0, 0.05, 0.1, 0.2, 0.3];
  const acc: Acc = {};
  const add = (key: string, prob: number, x: number, y: number) => {
    const a = (acc[key] ??= { grid: B, ll: B.map(() => 0), n: 0 });
    const z0 = Math.log(prob / (1 - prob));
    B.forEach((b, j) => (a.ll[j] += ll(y, 1 / (1 + Math.exp(-(z0 + b * x))))));
    a.n++;
  };
  for (const g of games) {
    if (!g.isFinal || g.homeScore === null || g.awayScore === null || g.homeScore === g.awayScore) continue;
    const b = before.get(g.id);
    if (!b || b.home.games < 5 || b.away.games < 5) continue;
    const y = g.homeScore > g.awayScore ? 1 : 0;
    const s = g.season === testSeason ? "test" : "train";
    // Standardized-ish features (home minus away).
    add(`luck|${s}`, b.prob, (b.home.luck / b.home.games - b.away.luck / b.away.games) * 4, y);
    if (b.home.close >= 3 && b.away.close >= 3) add(`closeLuck|${s}`, b.prob, (b.home.closeLuck / b.home.close - b.away.closeLuck / b.away.close) * 3, y);
    add(`afterLoss|${s}`, b.prob, (b.home.lastLost ? 1 : 0) - (b.away.lastLost ? 1 : 0), y);
    add(`afterBigLoss|${s}`, b.prob, (b.home.lastLost === 2 ? 1 : 0) - (b.away.lastLost === 2 ? 1 : 0), y);
    if (b.home.errA.length >= 5 && b.away.errA.length >= 5) {
      add(`errA|${s}`, b.prob, (mean(b.home.errA) - mean(b.away.errA)) * 2, y);
      add(`errB|${s}`, b.prob, (mean(b.home.errB) - mean(b.away.errB)) * 2, y);
    }
  }
  return report(acc, 0);
}

export interface MentalStat {
  statType: string;
  extract: (s: Record<string, string>) => number | null;
  cfg: PropModelConfig;
  floor: number;
}

/** Player-level: bounce-back, streaks, response to losses, clutch trait, opponent mistakes. */
export function propMentalCal(
  sport: SportKey,
  games: MentalGame[],
  rows: MentalRow[],
  teamErr: Map<string, [number, number]>,
  stats: MentalStat[],
  testSeason: number,
  minutesOf: (s: Record<string, string>) => number | null
) {
  const before = teamTimeline(sport, games, teamErr);
  const dbg = { players: 0, kept: 0, noGame: 0, scored: 0 };
  const gameById = new Map(games.map((g) => [g.id, g]));
  const M = [0.9, 0.93, 0.95, 0.97, 1, 1.03, 1.05, 1.07, 1.1];
  const acc: Acc = {};
  const add = (key: string, prior: number[], mins: (number | null)[] | undefined, cfg: PropModelConfig, floor: number, actual: number) => {
    const p = projectProp(prior, cfg, floor, mins);
    if (!p || p.mean <= 0) return;
    const a = (acc[key] ??= { grid: M, ll: M.map(() => 0), n: 0 });
    for (const d of [-1, -0.5, 0, 0.5, 1]) {
      const line = Math.max(0.5, Math.floor(p.mean + d * p.sd) + 0.5);
      const y = actual > line ? 1 : 0;
      M.forEach((f, j) => {
        a.ll[j] += ll(y, propChance({ ...p, mean: p.mean * f, sd: cfg.dist === "normal" ? p.sd * Math.sqrt(f) : p.sd }, line, cfg, "Over"));
      });
      a.n++;
    }
  };
  // Continuous versions: streak = (last-3 average / 20-game average)^-a;
  // opponent mistakes = exp(c * opponent's recent error z-score).
  const SA = [0, 0.05, 0.1, 0.15, 0.2, 0.3];
  const OC = [-0.08, -0.06, -0.04, -0.02, 0, 0.02, 0.04, 0.06, 0.08];
  const addF = (key: string, grid: number[], fac: (g: number) => number, prior: number[], mins: (number | null)[] | undefined, cfg: PropModelConfig, floor: number, actual: number) => {
    const p = projectProp(prior, cfg, floor, mins);
    if (!p || p.mean <= 0) return;
    const a = (acc[key] ??= { grid, ll: grid.map(() => 0), n: 0 });
    for (const d of [-1, -0.5, 0, 0.5, 1]) {
      const line = Math.max(0.5, Math.floor(p.mean + d * p.sd) + 0.5);
      const y = actual > line ? 1 : 0;
      grid.forEach((g, j) => {
        const f = fac(g);
        a.ll[j] += ll(y, propChance({ ...p, mean: p.mean * f, sd: cfg.dist === "normal" ? p.sd * Math.sqrt(f) : p.sd }, line, cfg, "Over"));
      });
      a.n++;
    }
  };
  const thin = sport === "mlb" ? 3 : 1;
  rows.sort((a, b) => a.at - b.at);
  for (const st of stats) {
    const byPlayer = new Map<string, MentalRow[]>();
    for (const r of rows) {
      if (st.extract(r.stats) === null) continue;
      const k = `${r.team}|${r.player}`;
      (byPlayer.get(k) ?? byPlayer.set(k, []).get(k)!).push(r);
    }
    for (const l of byPlayer.values()) {
      dbg.players++;
      const vals = l.map((r) => st.extract(r.stats) ?? 0);
      const mins = l.map((r) => minutesOf(r.stats));
      if (vals.filter((v) => v > 0).length < vals.length * 0.4) continue;
      dbg.kept++;
      // Running "clutch" residuals in close-expected games.
      const clutch: number[] = [];
      for (let i = 0; i < l.length; i++) {
        const r = l[i];
        const g = gameById.get(r.gameId);
        const b = before.get(r.gameId);
        if (!g || !b) {
          dbg.noGame++;
          continue;
        }
        if (i >= 8) dbg.scored++;
        const isHome = r.team === g.homeTeam;
        const p = isHome ? b.prob : 1 - b.prob;
        const tossup = p > 0.42 && p < 0.58;
        const lo = Math.max(0, i - 20);
        const prior = vals.slice(lo, i);
        const m = mean(prior);
        const sd = sdOf(prior) || 1;
        const resid = (vals[i] - m) / sd;
        if (i >= 8 && i % thin === 0 && !(st.cfg.useMinutes && !((mins[i] ?? 0) > 0))) {
          const pm = st.cfg.useMinutes ? mins.slice(lo, i) : undefined;
          const s = r.season === testSeason ? "test" : "train";
          const k = (name: string) => `${st.statType}|${name}|${s}`;
          const go = (name: string) => add(k(name), prior, pm, st.cfg, st.floor, vals[i]);
          const prevZ = (vals[i - 1] - mean(vals.slice(Math.max(0, i - 21), i - 1))) / (sdOf(vals.slice(Math.max(0, i - 21), i - 1)) || 1);
          if (prevZ < -1) go("lastBad");
          if (prevZ > 1.25) go("lastGreat");
          const last3 = vals.slice(i - 3, i);
          if (last3.every((v) => v < m)) go("cold3");
          if (last3.every((v) => v > m)) go("hot3");
          const me = isHome ? b.home : b.away;
          const opp = isHome ? b.away : b.home;
          if (me.games >= 3) {
            if (me.lastLost === 2) go("afterBigLoss");
            else if (me.lastLost === 1) go("afterLoss");
            else go("afterWin");
          }
          if (tossup) {
            go("tossup");
            if (clutch.length >= 6) {
              const c = mean(clutch);
              if (c > 0.25) go("clutchUp");
              else if (c < -0.25) go("clutchDown");
            }
          }
          if (opp.errA.length >= 5) {
            const ea = mean(opp.errA);
            const eb = mean(opp.errB);
            if (ea > 0.5) go("oppErrA_hi");
            else if (ea < -0.5) go("oppErrA_lo");
            if (eb > 0.5) go("oppErrB_hi");
            else if (eb < -0.5) go("oppErrB_lo");
          }
          if (me.errA.length >= 5 && mean(me.errA) > 0.5) go("ownErrA_hi");
          const pmF = st.cfg.useMinutes ? mins.slice(lo, i) : undefined;
          if (m > 0) {
            const x = Math.min(2, Math.max(0.5, (mean(last3) + 0.25 * m) / (1.25 * m)));
            addF(`${st.statType}|STREAK_a|${s}`, SA, (a) => x ** -a, prior, pmF, st.cfg, st.floor, vals[i]);
          }
          if (opp.errA.length >= 5) {
            const za = Math.max(-2, Math.min(2, mean(opp.errA) * Math.sqrt(opp.errA.length)));
            const zb = Math.max(-2, Math.min(2, mean(opp.errB) * Math.sqrt(opp.errB.length)));
            addF(`${st.statType}|OPPERR_A_c|${s}`, OC, (c) => Math.exp(c * za), prior, pmF, st.cfg, st.floor, vals[i]);
            addF(`${st.statType}|OPPERR_B_c|${s}`, OC, (c) => Math.exp(c * zb), prior, pmF, st.cfg, st.floor, vals[i]);
          }
        }
        if (tossup && i >= 8) clutch.push(resid);
      }
    }
  }
  return { ...report(acc, 1, 0), _debug: dbg } as Record<string, unknown>;
}
