// Back-from-injury check for every sport (/api/health/insights?returncal=nba).
// From box scores alone: a player "returns" when his team played 1+ games
// without him since his last game. "Key" = top 3 on his team in this stat
// (5+ games). For each prop stat, scores projection multipliers on lines
// around the projection (log loss, lower is better), for the returner's
// first game back and for teammates (same position group) in that game.
import { projectProp, propChance, type PropModelConfig } from "./prop-dist";

export interface BoxRow {
  gameId: number;
  team: string;
  player: string;
  position: string | null;
  season: number;
  at: number;
  value: number;
  min: number | null;
}

const M = [1, 0.95, 0.9, 0.85, 0.8, 0.75];
const ll = (y: number, p: number) => {
  const q = Math.min(0.999, Math.max(0.001, p));
  return -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
};
const grp = (sport: string, p: string | null) => {
  const x = (p ?? "").toUpperCase();
  if (sport === "nba" || sport === "wnba" || sport === "ncaab") return x.startsWith("C") ? "C" : x.startsWith("G") ? "G" : "F";
  if (sport === "nhl") return x === "D" ? "D" : x === "G" ? "G" : "F";
  if (sport === "ncaaf") return x === "WR" || x === "TE" ? "REC" : x;
  return x === "P" || x === "SP" || x === "RP" ? "P" : "B";
};

type Acc = Record<string, number[][]>; // key -> per multiplier [ll, n]

export function returnCal(sport: string, rows: BoxRow[], cfg: PropModelConfig, floor: number, testSeason: number) {
  const acc: Acc = {};
  const add = (key: string, prior: number[], mins: (number | null)[] | undefined, actual: number) => {
    const p = projectProp(prior, cfg, floor, mins);
    if (!p || p.mean <= 0) return;
    const a = (acc[key] ??= M.map(() => [0, 0]));
    for (const d of [-1, -0.5, 0, 0.5, 1]) {
      const line = Math.max(0.5, Math.floor(p.mean + d * p.sd) + 0.5);
      const y = actual > line ? 1 : 0;
      M.forEach((m, j) => {
        const q = propChance({ ...p, mean: p.mean * m, sd: cfg.dist === "normal" ? p.sd * m : p.sd }, line, cfg, "Over");
        a[j][0] += ll(y, q);
        a[j][1]++;
      });
    }
  };

  const teamGames = new Map<string, { id: number; at: number }[]>();
  const byPlayer = new Map<string, BoxRow[]>();
  for (const r of rows) {
    const k = `${r.season}|${r.team}`;
    const l = teamGames.get(k) ?? teamGames.set(k, []).get(k)!;
    if (!l.some((g) => g.id === r.gameId)) l.push({ id: r.gameId, at: r.at });
    (byPlayer.get(`${r.team}|${r.player}`) ?? byPlayer.set(`${r.team}|${r.player}`, []).get(`${r.team}|${r.player}`)!).push(r);
  }
  for (const l of teamGames.values()) l.sort((a, b) => a.at - b.at);
  for (const l of byPlayer.values()) l.sort((a, b) => a.at - b.at);
  const teamPlayers = new Map<string, string[]>();
  for (const k of byPlayer.keys()) {
    const t = k.slice(0, k.indexOf("|"));
    (teamPlayers.get(t) ?? teamPlayers.set(t, []).get(t)!).push(k);
  }

  // Returners per game: gameId -> [{ player, group }]
  const returners = new Map<number, { key: string; g: string }[]>();
  for (const [key, l] of byPlayer) {
    for (let i = 5; i < l.length; i++) {
      const r = l[i];
      const prev = l[i - 1];
      if (prev.season !== r.season) continue;
      const tg = teamGames.get(`${r.season}|${r.team}`) ?? [];
      const missed = tg.filter((g) => g.at > prev.at && g.at < r.at).length;
      if (missed < 1) continue;
      // Key: top 3 on the team in this stat over the prior games' window.
      const myAvg = l.slice(Math.max(0, i - 20), i).reduce((a, x) => a + x.value, 0) / Math.min(20, i);
      let rank = 1;
      for (const k2 of teamPlayers.get(r.team) ?? []) {
        if (k2 === key) continue;
        const l2 = byPlayer.get(k2)!;
        const prior2 = l2.filter((x) => x.at < r.at).slice(-20);
        if (prior2.length < 5) continue;
        if (prior2.reduce((a, x) => a + x.value, 0) / prior2.length > myAvg) rank++;
        if (rank > 3) break;
      }
      if (rank > 3) continue;
      const split = r.season === testSeason ? "test" : "train";
      add(`self|${split}`, l.slice(Math.max(0, i - 20), i).map((x) => x.value), cfg.useMinutes ? l.slice(Math.max(0, i - 20), i).map((x) => x.min) : undefined, r.value);
      (returners.get(r.gameId) ?? returners.set(r.gameId, []).get(r.gameId)!).push({ key, g: grp(sport, r.position) });
    }
  }
  for (const [key, l] of byPlayer) {
    for (let i = 5; i < l.length; i++) {
      const r = l[i];
      const ret = returners.get(r.gameId)?.filter((x) => x.key !== key && x.key.startsWith(`${r.team}|`));
      if (!ret?.length) continue;
      const same = ret.some((x) => x.g === grp(sport, r.position));
      const split = r.season === testSeason ? "test" : "train";
      add(`${same ? "mateSame" : "mateOther"}|${split}`, l.slice(Math.max(0, i - 20), i).map((x) => x.value), cfg.useMinutes ? l.slice(Math.max(0, i - 20), i).map((x) => x.min) : undefined, r.value);
    }
  }
  const out: Record<string, { n: number; ll: Record<string, number>; best: number }> = {};
  for (const [k, a] of Object.entries(acc)) {
    const lls = Object.fromEntries(M.map((m, j) => [String(m), +(a[j][0] / Math.max(1, a[j][1])).toFixed(4)]));
    const best = M.reduce((b, m, j) => (a[j][0] < a[M.indexOf(b)][0] ? m : b), 1);
    out[k] = { n: a[0][1], ll: lls, best };
  }
  return out;
}
