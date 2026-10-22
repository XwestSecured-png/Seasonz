// Minutes-first and game-pace checks (/api/health/insights?mincal=<sport>).
//
//  MIN_k:   expected minutes = last 5 games' minutes pulled toward the
//           20-game average with weight k (k=0 is the current model);
//           for hockey, also turning on per-minute (ice time) projections.
//  PACE_b:  (team's points scored over its last 10 vs league)^b, and the
//           game's expected total (both teams' last 10 scoring and allowing,
//           the stand-in for the book's over/under)^b.
// Lines are set around the CURRENT projection so every variant is scored
// on the same lines; last season (train) and this one (test) separately.
import { projectProp, propChance, type PropModelConfig } from "./prop-dist";
import type { MentalGame, MentalRow, MentalStat } from "./mental-calibration";

const ll = (y: number, p: number) => {
  const q = Math.min(0.999, Math.max(0.001, p));
  return -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
};

type Acc = Record<string, { ll: number; n: number }>;

export function minutesCal(
  sport: string,
  games: MentalGame[],
  rows: MentalRow[],
  stats: MentalStat[],
  testSeason: number,
  minutesOf: (s: Record<string, string>) => number | null
) {
  // Team scoring before each game (last 10, same season).
  const sorted = [...games].filter((g) => g.isFinal && g.homeScore !== null && g.awayScore !== null).sort((a, b) => (a.kickoffAt?.getTime() ?? 0) - (b.kickoffAt?.getTime() ?? 0));
  const hist = new Map<string, { f: number; a: number }[]>();
  const pre = new Map<number, { home: { f: number; a: number } | null; away: { f: number; a: number } | null; lg: number }>();
  let lgSum = 0;
  let lgN = 0;
  let season = -1;
  const avg = (l: { f: number; a: number }[] | undefined) => {
    if (!l || l.length < 5) return null;
    const w = l.slice(-10);
    return { f: w.reduce((s, x) => s + x.f, 0) / w.length, a: w.reduce((s, x) => s + x.a, 0) / w.length };
  };
  for (const g of sorted) {
    if (g.season !== season) {
      hist.clear();
      season = g.season;
      lgSum = 0;
      lgN = 0;
    }
    pre.set(g.id, { home: avg(hist.get(g.homeTeam)), away: avg(hist.get(g.awayTeam)), lg: lgN >= 20 ? lgSum / lgN : 0 });
    (hist.get(g.homeTeam) ?? hist.set(g.homeTeam, []).get(g.homeTeam)!).push({ f: g.homeScore!, a: g.awayScore! });
    (hist.get(g.awayTeam) ?? hist.set(g.awayTeam, []).get(g.awayTeam)!).push({ f: g.awayScore!, a: g.homeScore! });
    lgSum += g.homeScore! + g.awayScore!;
    lgN += 2;
  }
  const gameById = new Map(games.map((g) => [g.id, g]));

  const K = [0, 3, 5, 10, 20, 40];
  const B = [0, 0.25, 0.5, 0.75, 1];
  const acc: Acc = {};
  const add = (key: string, y: number, q: number) => {
    const a = (acc[key] ??= { ll: 0, n: 0 });
    a.ll += ll(y, q);
    a.n++;
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
    const minCfgs: [string, PropModelConfig][] = K.map((k) => [`MIN_${k}`, { ...st.cfg, useMinutes: true, minShrinkK: k }]);
    for (const l of byPlayer.values()) {
      const vals = l.map((r) => st.extract(r.stats) ?? 0);
      const mins = l.map((r) => minutesOf(r.stats));
      if (vals.filter((v) => v > 0).length < vals.length * 0.4) continue;
      const hasMin = mins.every((m) => m !== null);
      for (let i = 8; i < l.length; i++) {
        if (i % thin !== 0) continue;
        if (hasMin && !((mins[i] ?? 0) > 0)) continue;
        const lo = Math.max(0, i - 20);
        const prior = vals.slice(lo, i);
        const pm = mins.slice(lo, i);
        const base = projectProp(prior, st.cfg, st.floor, st.cfg.useMinutes && hasMin ? pm : undefined);
        if (!base || base.mean <= 0) continue;
        const r = l[i];
        const s = r.season === testSeason ? "test" : "train";
        const g = gameById.get(r.gameId);
        const pr = pre.get(r.gameId);
        const isHome = g ? g.homeTeam === r.team : false;
        const me = pr ? (isHome ? pr.home : pr.away) : null;
        const op = pr ? (isHome ? pr.away : pr.home) : null;
        const lgTeam = pr && pr.lg > 0 ? pr.lg : 0;
        const xOwn = me && lgTeam ? Math.min(1.5, Math.max(0.67, me.f / lgTeam)) : null;
        const xTot = me && op && lgTeam ? Math.min(1.5, Math.max(0.67, (me.f + me.a + op.f + op.a) / 2 / (2 * lgTeam) * 2 / 2)) : null;
        const variants = hasMin ? minCfgs.map(([n, c]) => [n, projectProp(prior, c, st.floor, pm)] as const) : [];
        for (const d of [-1, -0.5, 0, 0.5, 1]) {
          const line = Math.max(0.5, Math.floor(base.mean + d * base.sd) + 0.5);
          const y = vals[i] > line ? 1 : 0;
          const ch = (p: typeof base, f = 1) => propChance({ ...p, mean: p.mean * f, sd: st.cfg.dist === "normal" ? p.sd * Math.sqrt(f) : p.sd }, line, st.cfg, "Over");
          add(`${st.statType}|BASE|${s}`, y, ch(base));
          for (const [n, p] of variants) if (p && p.mean > 0) add(`${st.statType}|${n}|${s}`, y, ch(p));
          if (xOwn !== null) for (const b of B) add(`${st.statType}|PACEOWN_${b}|${s}`, y, ch(base, xOwn ** b));
          if (xTot !== null) for (const b of B) add(`${st.statType}|PACETOT_${b}|${s}`, y, ch(base, xTot ** b));
        }
      }
    }
  }
  // Report: per stat/split, each variant's log loss vs that stat's matching baseline.
  const out: Record<string, Record<string, { n: number; ll: number; gainPct: number }>> = {};
  for (const [k, a] of Object.entries(acc)) {
    const [stat, v, s] = k.split("|");
    const group = `${stat}|${s}`;
    const baseKey = v.startsWith("PACEOWN") ? `${stat}|PACEOWN_0|${s}` : v.startsWith("PACETOT") ? `${stat}|PACETOT_0|${s}` : v.startsWith("MIN_") ? `${stat}|MIN_0|${s}` : k;
    const b = acc[baseKey] ?? a;
    (out[group] ??= {})[v] = { n: a.n, ll: +(a.ll / a.n).toFixed(4), gainPct: +(((b.ll / b.n - a.ll / a.n) / (b.ll / b.n)) * 100).toFixed(2) };
  }
  return out;
}
