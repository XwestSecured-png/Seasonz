// Lineup checks (/api/health/insights?mentalcal=<sport>&set=lineup).
//
//  ABS:  a team's top-2 scorer (a regular: 4 of the last 5 games) is missing
//        from the box score. How much do teammates' numbers rise? Split by
//        role (starter-level minutes vs bench) and by same/other position.
//  DVP:  opponent adjustment by position (what the opponent allowed to
//        guards / forwards / centers, or hockey forwards / defense, over its
//        last 15 games) vs the opponent's overall allowed rate, each as
//        factor^a on the projection.
// Scored like the other checks: lines around the projection, log loss, last
// season (train) and this season (test) separately.
import { projectProp, propChance, type PropModelConfig } from "./prop-dist";
import type { MentalGame, MentalRow, MentalStat } from "./mental-calibration";

const ll = (y: number, p: number) => {
  const q = Math.min(0.999, Math.max(0.001, p));
  return -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
};
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);

export const posGroup = (sport: string, p: string | null | undefined) => {
  const x = (p ?? "").toUpperCase();
  if (sport === "nhl") return x === "D" ? "D" : x === "G" ? "G" : "F";
  return x.startsWith("C") ? "C" : x.startsWith("G") || x === "PG" || x === "SG" ? "G" : "F";
};

type Acc = Record<string, { grid: number[]; ll: number[]; n: number }>;

export function lineupCal(
  sport: string,
  games: MentalGame[],
  rows: (MentalRow & { position: string | null })[],
  stats: MentalStat[],
  testSeason: number,
  minutesOf: (s: Record<string, string>) => number | null,
  scoreOf: (s: Record<string, string>) => number | null
) {
  const gameById = new Map(games.map((g) => [g.id, g]));
  const byGame = new Map<number, typeof rows>();
  for (const r of rows) (byGame.get(r.gameId) ?? byGame.set(r.gameId, []).get(r.gameId)!).push(r);
  const orderedGames = [...byGame.keys()].map((id) => gameById.get(id)!).filter(Boolean).sort((a, b) => (a.kickoffAt?.getTime() ?? 0) - (b.kickoffAt?.getTime() ?? 0));

  // Per team: its games in order, and who played/scored in each.
  const teamGames = new Map<string, { id: number; season: number; players: Map<string, { score: number; min: number | null; pos: string }> }[]>();
  for (const g of orderedGames) {
    for (const team of [g.homeTeam, g.awayTeam]) {
      const players = new Map<string, { score: number; min: number | null; pos: string }>();
      for (const r of byGame.get(g.id) ?? []) {
        if (r.team !== team) continue;
        const m = minutesOf(r.stats);
        if (m !== null && m <= 0) continue;
        players.set(r.player, { score: scoreOf(r.stats) ?? 0, min: m, pos: posGroup(sport, r.position) });
      }
      if (players.size) (teamGames.get(team) ?? teamGames.set(team, []).get(team)!).push({ id: g.id, season: g.season, players });
    }
  }
  // Absences per team-game: top-2 scorers over the last 10 games who played 4 of the last 5 and are missing now.
  const absent = new Map<string, { player: string; pos: string }[]>();
  for (const [team, l] of teamGames) {
    for (let i = 5; i < l.length; i++) {
      if (l[i].season !== l[i - 5].season) continue;
      const last10 = l.slice(Math.max(0, i - 10), i);
      const tot = new Map<string, { s: number; pos: string }>();
      for (const g of last10) for (const [p, v] of g.players) tot.set(p, { s: (tot.get(p)?.s ?? 0) + v.score, pos: v.pos });
      const top = [...tot].sort((a, b) => b[1].s - a[1].s).slice(0, 2);
      const out: { player: string; pos: string }[] = [];
      for (const [p, v] of top) {
        const played = l.slice(i - 5, i).filter((g) => g.players.has(p)).length;
        if (played >= 4 && !l[i].players.has(p)) out.push({ player: p, pos: v.pos });
      }
      if (out.length) absent.set(`${l[i].id}|${team}`, out);
    }
  }

  // Opponent allowed per position (and overall), last 15 games before each game.
  const allowedHist = new Map<string, { pos: Record<string, Record<string, number>>; all: Record<string, number> }[]>();
  const lg = new Map<string, { s: number; n: number }>(); // per stat|pos league average per team-game
  const statVal = (st: MentalStat, s: Record<string, string>) => st.extract(s);
  const oppPre = new Map<string, { pos: Record<string, Record<string, number>>; all: Record<string, number> }>();
  for (const g of orderedGames) {
    for (const [team, opp] of [[g.homeTeam, g.awayTeam], [g.awayTeam, g.homeTeam]] as const) {
      // Before this game: opponent's last 15 allowed.
      const h = allowedHist.get(opp) ?? [];
      const w = h.slice(-15);
      if (w.length >= 5) {
        const pos: Record<string, Record<string, number>> = {};
        const all: Record<string, number> = {};
        for (const st of stats) {
          for (const pg of ["G", "F", "C", "D"]) {
            const v = mean(w.map((x) => x.pos[pg]?.[st.statType] ?? 0));
            const L = lg.get(`${st.statType}|${pg}`);
            if (L && L.n > 50 && L.s > 0) (pos[pg] ??= {})[st.statType] = v / (L.s / L.n);
          }
          const va = mean(w.map((x) => x.all[st.statType] ?? 0));
          const La = lg.get(`${st.statType}|ALL`);
          if (La && La.n > 50 && La.s > 0) all[st.statType] = va / (La.s / La.n);
        }
        oppPre.set(`${g.id}|${team}`, { pos, all });
      }
    }
    // After the game: record what each team allowed.
    for (const [team, opp] of [[g.homeTeam, g.awayTeam], [g.awayTeam, g.homeTeam]] as const) {
      const pos: Record<string, Record<string, number>> = {};
      const all: Record<string, number> = {};
      for (const r of byGame.get(g.id) ?? []) {
        if (r.team !== team) continue;
        const pg = posGroup(sport, r.position);
        for (const st of stats) {
          const v = statVal(st, r.stats);
          if (v === null) continue;
          (pos[pg] ??= {})[st.statType] = (pos[pg]?.[st.statType] ?? 0) + v;
          all[st.statType] = (all[st.statType] ?? 0) + v;
        }
      }
      for (const st of stats) {
        for (const pg of ["G", "F", "C", "D"]) {
          const k = `${st.statType}|${pg}`;
          const e = lg.get(k) ?? { s: 0, n: 0 };
          e.s += pos[pg]?.[st.statType] ?? 0;
          e.n++;
          lg.set(k, e);
        }
        const ka = `${st.statType}|ALL`;
        const ea = lg.get(ka) ?? { s: 0, n: 0 };
        ea.s += all[st.statType] ?? 0;
        ea.n++;
        lg.set(ka, ea);
      }
      (allowedHist.get(opp) ?? allowedHist.set(opp, []).get(opp)!).push({ pos, all });
    }
  }

  const M = [0.95, 1, 1.03, 1.05, 1.08, 1.1, 1.15, 1.2];
  const A = [0, 0.25, 0.5, 0.75, 1];
  const acc: Acc = {};
  const add = (key: string, grid: number[], fac: (g: number) => number, p: NonNullable<ReturnType<typeof projectProp>>, cfg: PropModelConfig, actual: number) => {
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

  const sorted = [...rows].sort((a, b) => a.at - b.at);
  for (const st of stats) {
    const byPlayer = new Map<string, typeof rows>();
    for (const r of sorted) {
      if (st.extract(r.stats) === null) continue;
      const k = `${r.team}|${r.player}`;
      (byPlayer.get(k) ?? byPlayer.set(k, []).get(k)!).push(r);
    }
    for (const l of byPlayer.values()) {
      const vals = l.map((r) => st.extract(r.stats) ?? 0);
      const mins = l.map((r) => minutesOf(r.stats));
      if (vals.filter((v) => v > 0).length < vals.length * 0.4) continue;
      const hasMin = mins.every((m) => m !== null);
      for (let i = 8; i < l.length; i++) {
        if (hasMin && !((mins[i] ?? 0) > 0)) continue;
        const lo = Math.max(0, i - 20);
        const p = projectProp(vals.slice(lo, i), st.cfg, st.floor, st.cfg.useMinutes && hasMin ? mins.slice(lo, i) : undefined);
        if (!p || p.mean <= 0) continue;
        const r = l[i];
        const s = r.season === testSeason ? "test" : "train";
        const ab = absent.get(`${r.gameId}|${r.team}`)?.filter((x) => x.player !== r.player);
        if (ab?.length) {
          const avgMin = hasMin ? mean(mins.slice(Math.max(0, i - 10), i) as number[]) : null;
          const role = avgMin === null ? "all" : sport === "nhl" ? (avgMin >= 17 ? "top" : "depth") : avgMin >= 26 ? "starter" : "bench";
          const same = ab.some((x) => x.pos === posGroup(sport, r.position));
          add(`${st.statType}|ABS_${role}_${same ? "samePos" : "otherPos"}|${s}`, M, (m) => m, p, st.cfg, vals[i]);
          add(`${st.statType}|ABS_${role}|${s}`, M, (m) => m, p, st.cfg, vals[i]);
        }
        const op = oppPre.get(`${r.gameId}|${r.team}`);
        if (op) {
          const fa = op.all[st.statType];
          const fp = op.pos[posGroup(sport, r.position)]?.[st.statType];
          if (fa && fp) {
            const ca = Math.min(1.5, Math.max(0.67, fa));
            const cp = Math.min(1.5, Math.max(0.67, fp));
            add(`${st.statType}|DVP_all|${s}`, A, (a) => ca ** a, p, st.cfg, vals[i]);
            add(`${st.statType}|DVP_pos|${s}`, A, (a) => cp ** a, p, st.cfg, vals[i]);
          }
        }
      }
    }
  }
  const out: Record<string, { n: number; best: number; base: number; bestLl: number; gainPct: number }> = {};
  for (const [k, a] of Object.entries(acc)) {
    let bj = 0;
    a.ll.forEach((v, j) => {
      if (v < a.ll[bj]) bj = j;
    });
    const z = a.grid.indexOf(a.grid.includes(1) && a.grid !== A ? 1 : 0);
    out[k] = { n: a.n, best: a.grid[bj], base: +(a.ll[z] / a.n).toFixed(4), bestLl: +(a.ll[bj] / a.n).toFixed(4), gainPct: +(((a.ll[z] - a.ll[bj]) / a.ll[z]) * 100).toFixed(2) };
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}
