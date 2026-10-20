// Game-day signal checks for the other sports (/api/health/insights?signalcal=<sport>).
// Each candidate signal multiplies the current projection; it's scored by
// log loss at lines around the projection (lower is better) for a grid of
// strengths, on last season (train) and this season (test) separately, so
// only signals that help on both are adopted.
//
// From box scores alone (ESPN lists players in lineup order, so the order
// rows were saved recovers it):
//   MLB: batting-order slot; the opposing starting pitcher's strikeout and
//        hit rates; the ballpark (home team) for each stat.
//   NBA/WNBA: started vs came off the bench (first five listed), and
//        blowout risk from the pre-game win chance.
//   NHL: goalie saves projected from his starts only (relief outings
//        dragged the average down).
import { projectProp, propChance, type PropModelConfig } from "./prop-dist";

export interface SignalRow {
  id: number;
  gameId: number;
  team: string;
  player: string;
  position: string | null;
  season: number;
  at: number;
  home: string;
  homeWinPre: number | null;
  /** Opponent's pre-game Elo rating. */
  oppElo: number | null;
  stats: Record<string, unknown>;
}

const N = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const ll = (y: number, p: number) => {
  const q = Math.min(0.999, Math.max(0.001, p));
  return -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
};
const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);

type Acc = Record<string, { grid: number[]; ll: number[]; n: number }>;
function scorer(acc: Acc) {
  return (key: string, grid: number[], prior: number[], mins: (number | null)[] | undefined, cfg: PropModelConfig, floor: number, actual: number, factorFor: (g: number) => number) => {
    const p = projectProp(prior, cfg, floor, mins);
    if (!p || p.mean <= 0) return;
    const a = (acc[key] ??= { grid, ll: grid.map(() => 0), n: 0 });
    for (const d of [-1, -0.5, 0, 0.5, 1]) {
      const line = Math.max(0.5, Math.floor(p.mean + d * p.sd) + 0.5);
      const y = actual > line ? 1 : 0;
      grid.forEach((g, j) => {
        const f = factorFor(g);
        a.ll[j] += ll(y, propChance({ ...p, mean: p.mean * f, sd: cfg.dist === "normal" ? p.sd * Math.sqrt(f) : p.sd }, line, cfg, "Over"));
      });
      a.n++;
    }
  };
}
function report(acc: Acc) {
  const out: Record<string, { n: number; best: number; base: number; bestLl: number; gainPct: number }> = {};
  for (const [k, a] of Object.entries(acc)) {
    let bj = 0;
    a.ll.forEach((v, j) => {
      if (v < a.ll[bj]) bj = j;
    });
    const zero = a.grid.indexOf(0) >= 0 ? a.grid.indexOf(0) : a.grid.indexOf(1);
    out[k] = {
      n: a.n,
      best: a.grid[bj],
      base: +(a.ll[zero] / a.n).toFixed(4),
      bestLl: +(a.ll[bj] / a.n).toFixed(4),
      gainPct: +(((a.ll[zero] - a.ll[bj]) / a.ll[zero]) * 100).toFixed(2),
    };
  }
  return out;
}

export interface StatDef {
  statType: string;
  extract: (s: Record<string, string>) => number | null;
  cfg: PropModelConfig;
  floor: number;
}

// Expected plate appearances by batting-order slot (MLB averages).
const PA_BY_SLOT = [4.65, 4.55, 4.45, 4.35, 4.25, 4.15, 4.05, 3.95, 3.85];

export function signalCal(sport: string, rows: SignalRow[], stats: StatDef[], testSeason: number, minutesOf: (s: Record<string, string>) => number | null) {
  const acc: Acc = {};
  const add = scorer(acc);
  rows.sort((a, b) => a.at - b.at || a.id - b.id);
  const byGameTeam = new Map<string, SignalRow[]>();
  for (const r of rows) (byGameTeam.get(`${r.gameId}|${r.team}`) ?? byGameTeam.set(`${r.gameId}|${r.team}`, []).get(`${r.gameId}|${r.team}`)!).push(r);
  for (const l of byGameTeam.values()) l.sort((a, b) => a.id - b.id);
  const split = (r: SignalRow) => (r.season === testSeason ? "test" : "train");

  if (sport === "mlb") {
    const isPitcher = (r: SignalRow) => "IP" in r.stats;
    // Batting slot (1-9) per batter per game; starting pitcher per team-game.
    const slot = new Map<number, number>();
    const starter = new Map<string, SignalRow>();
    for (const [k, l] of byGameTeam) {
      const bats = l.filter((r) => !isPitcher(r));
      bats.slice(0, 9).forEach((r, i) => slot.set(r.id, i + 1));
      const sp = l.find(isPitcher);
      if (sp) starter.set(k, sp);
    }
    const gameTeams = new Map<number, string[]>();
    for (const k of byGameTeam.keys()) {
      const [g, t] = k.split("|");
      (gameTeams.get(+g) ?? gameTeams.set(+g, []).get(+g)!).push(t);
    }
    // Pitcher history (starts only) for opponent quality, league rates per IP.
    const pitcherLog = new Map<string, { at: number; ip: number; k: number; h: number }[]>();
    for (const sp of starter.values()) {
      const ipRaw = String(sp.stats.IP ?? "0");
      const ip = Math.floor(N(ipRaw)) + (N(ipRaw) % 1) * (10 / 3);
      (pitcherLog.get(sp.player) ?? pitcherLog.set(sp.player, []).get(sp.player)!).push({ at: sp.at, ip, k: N(sp.stats.K), h: N(sp.stats.H) });
    }
    let lgIp = 0, lgK = 0, lgH = 0;
    for (const l of pitcherLog.values()) for (const x of l) { lgIp += x.ip; lgK += x.k; lgH += x.h; }
    const lgKr = lgK / Math.max(1, lgIp), lgHr = lgH / Math.max(1, lgIp);
    const oppRate = (gameId: number, team: string, at: number, kind: "k" | "h") => {
      const opp = (gameTeams.get(gameId) ?? []).find((t) => t !== team);
      const sp = opp ? starter.get(`${gameId}|${opp}`) : undefined;
      if (!sp) return null;
      const prior = (pitcherLog.get(sp.player) ?? []).filter((x) => x.at < at).slice(-15);
      const ip = prior.reduce((a, x) => a + x.ip, 0);
      if (ip < 10) return null;
      const r = prior.reduce((a, x) => a + x[kind], 0) / ip;
      const lg = kind === "k" ? lgKr : lgHr;
      // Shrink toward league with 30 innings of prior.
      return ((r * ip + lg * 30) / (ip + 30)) / lg;
    };
    // Park: stat per team-game at each home park vs league, prior games only (computed per stat below).
    const B = [0, 0.25, 0.5, 0.75, 1, 1.25];
    for (const st of stats) {
      if (/Allowed|Earned|Pitcher/.test(st.statType)) continue;
      const byPlayer = new Map<string, SignalRow[]>();
      const parkSum = new Map<string, { s: number; n: number }>();
      let lgS = 0, lgN = 0;
      for (const r of rows) {
        if (isPitcher(r)) continue;
        (byPlayer.get(r.player) ?? byPlayer.set(r.player, []).get(r.player)!).push(r);
      }
      // Walk games in time order to keep park and league numbers to prior games only.
      const parkAt = new Map<number, number>(); // row id -> park factor (prior)
      const gameOrder = [...byGameTeam.entries()].sort((a, b) => a[1][0].at - b[1][0].at);
      for (const [k, l] of gameOrder) {
        const park = l[0].home;
        const ps = parkSum.get(park);
        const pf = ps && lgN > 0 && ps.n >= 20 ? ((ps.s + (lgS / lgN) * 40) / (ps.n + 40)) / (lgS / lgN) : 1;
        let tot = 0;
        for (const r of l) {
          if (isPitcher(r)) continue;
          parkAt.set(r.id, pf);
          tot += st.extract(r.stats as Record<string, string>) ?? 0;
        }
        void k;
        const cur = parkSum.get(park) ?? { s: 0, n: 0 };
        cur.s += tot;
        cur.n += 1;
        parkSum.set(park, cur);
        lgS += tot;
        lgN += 1;
      }
      for (const l of byPlayer.values()) {
        const vals = l.map((r) => st.extract(r.stats as Record<string, string>));
        for (let i = 10; i < l.length; i++) {
          if (i % 3 !== 0) continue; // thin: a third of games keeps the check inside one request
          const v = vals[i];
          if (v === null) continue;
          const prior = vals.slice(Math.max(0, i - 20), i).filter((x): x is number => x !== null);
          if (prior.length < 5) continue;
          const r = l[i];
          const s = split(r);
          const today = slot.get(r.id);
          if (today) {
            const past = l.slice(Math.max(0, i - 20), i).map((x) => slot.get(x.id)).filter((x): x is number => !!x);
            if (past.length >= 5) {
              const ratio = PA_BY_SLOT[today - 1] / mean(past.map((x) => PA_BY_SLOT[x - 1]));
              add(`${st.statType}|slot|${s}`, B, prior, undefined, st.cfg, st.floor, v, (b) => Math.pow(ratio, b));
            }
          }
          const kind = st.statType === "Strikeouts (Batter)" ? "k" : st.statType === "Hits" || st.statType === "Home Runs" || st.statType === "RBIs" || st.statType === "Runs Scored" ? "h" : null;
          if (kind) {
            const q = oppRate(r.gameId, r.team, r.at, kind);
            if (q !== null) add(`${st.statType}|oppPitcher|${s}`, B, prior, undefined, st.cfg, st.floor, v, (b) => Math.pow(q, b));
          }
          const pf = parkAt.get(r.id) ?? 1;
          add(`${st.statType}|park|${s}`, B, prior, undefined, st.cfg, st.floor, v, (b) => Math.pow(pf, b));
        }
      }
    }
    return report(acc);
  }

  if (sport === "nba" || sport === "wnba" || sport === "ncaab") {
    const started = new Set<number>();
    for (const l of byGameTeam.values()) l.slice(0, 5).forEach((r) => started.add(r.id));
    const M = [0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.2, 1.3, 1.4];
    // Deployable version (known before tip from the injury report): a usual
    // starter is missing, so the bench player at his position with the most
    // recent minutes moves up. Box-score absence stands in for "listed Out".
    const grp = (p: string | null) => {
      const x = (p ?? "").toUpperCase();
      return x.startsWith("C") ? "C" : x.startsWith("G") || x === "PG" || x === "SG" ? "G" : "F";
    };
    const teamGames = new Map<string, { gameId: number; at: number }[]>();
    for (const [k, l] of byGameTeam) {
      const [g, t] = k.split("|");
      (teamGames.get(t) ?? teamGames.set(t, []).get(t)!).push({ gameId: +g, at: l[0].at });
    }
    for (const l of teamGames.values()) l.sort((a, b) => a.at - b.at);
    const history = new Map<string, { gameId: number; start: boolean; min: number }[]>();
    const posOf = new Map<string, string>();
    for (const r of rows) if (r.position) posOf.set(r.player, grp(r.position));
    const backups = new Set<number>(); // row ids of promoted backups
    for (const [team, tg] of teamGames) {
      for (let gi = 0; gi < tg.length; gi++) {
        const rowsHere = byGameTeam.get(`${tg[gi].gameId}|${team}`) ?? [];
        const present = new Set(rowsHere.map((r) => r.player));
        // Usual starters who played one of the team's last 3 games but not this one.
        const recentIds = new Set(tg.slice(Math.max(0, gi - 3), gi).map((x) => x.gameId));
        const missing: string[] = [];
        for (const [key, h] of history) {
          if (!key.startsWith(`${team}|`)) continue;
          const pl = key.slice(team.length + 1);
          if (present.has(pl)) continue;
          const last10 = h.slice(-10);
          if (last10.length < 5 || last10.filter((x) => x.start).length < 7 * (last10.length / 10)) continue;
          if (!last10.some((x) => recentIds.has(x.gameId))) continue;
          missing.push(pl);
        }
        if (missing.length) {
          const used = new Set<number>();
          for (const m of missing) {
            const g = posOf.get(m);
            const cands = rowsHere
              .filter((r) => !used.has(r.id) && grp(r.position) === g)
              .map((r) => {
                const h = (history.get(`${team}|${r.player}`) ?? []).slice(-10);
                return { r, rate: h.length ? h.filter((x) => x.start).length / h.length : 1, min: mean(h.map((x) => x.min)), n: h.length };
              })
              .filter((c) => c.n >= 5 && c.rate < 0.5)
              .sort((a, b) => b.min - a.min);
            if (cands[0]) {
              backups.add(cands[0].r.id);
              used.add(cands[0].r.id);
            }
          }
        }
        for (const r of rowsHere) {
          const k = `${team}|${r.player}`;
          (history.get(k) ?? history.set(k, []).get(k)!).push({ gameId: r.gameId, start: started.has(r.id), min: minutesOf(r.stats as Record<string, string>) ?? 0 });
        }
      }
    }
    const K = [0, 0.1, 0.2, 0.3, 0.4, 0.6];
    for (const st of stats) {
      const byPlayer = new Map<string, SignalRow[]>();
      for (const r of rows) (byPlayer.get(`${r.team}|${r.player}`) ?? byPlayer.set(`${r.team}|${r.player}`, []).get(`${r.team}|${r.player}`)!).push(r);
      for (const l of byPlayer.values()) {
        const vals = l.map((r) => st.extract(r.stats as Record<string, string>));
        const mins = l.map((r) => minutesOf(r.stats as Record<string, string>));
        for (let i = 8; i < l.length; i++) {
          const v = vals[i];
          if (v === null || !((mins[i] ?? 0) > 0)) continue;
          const lo = Math.max(0, i - 20);
          const prior = vals.slice(lo, i).map((x) => x ?? 0);
          const pm = st.cfg.useMinutes ? mins.slice(lo, i) : undefined;
          const r = l[i];
          const s = split(r);
          const rate = mean(l.slice(Math.max(0, i - 10), i).map((x) => (started.has(x.id) ? 1 : 0)));
          const nowStart = started.has(r.id);
          if (backups.has(r.id)) add(`${st.statType}|starterOutBackup|${s}`, M, prior, pm, st.cfg, st.floor, v, (m) => m);
          if (nowStart && rate < 0.5) add(`${st.statType}|promotedToStarter|${s}`, M, prior, pm, st.cfg, st.floor, v, (m) => m);
          else if (!nowStart && rate >= 0.5) add(`${st.statType}|benched|${s}`, M, prior, pm, st.cfg, st.floor, v, (m) => m);
          if (r.homeWinPre !== null && rate >= 0.5 && nowStart) {
            const lop = Math.max(0, Math.abs(r.homeWinPre - 0.5) - 0.2);
            add(`${st.statType}|blowout|${s}`, K, prior, pm, st.cfg, st.floor, v, (k) => 1 - k * lop);
          }
        }
      }
    }
    return report(acc);
  }

  if (sport === "ncaaf") {
    // Opponent strength from its pre-game Elo (1500 = average): a strong
    // defense holds yards down. factor = 1 - c x (oppElo - mean) / 100.
    const elos = rows.map((r) => r.oppElo).filter((x): x is number => x !== null);
    const avgElo = mean(elos);
    const C = [0, 0.02, 0.04, 0.06, 0.08, 0.1];
    for (const st of stats) {
      const byPlayer = new Map<string, SignalRow[]>();
      for (const r of rows) {
        if (st.extract(r.stats as Record<string, string>) === null) continue;
        (byPlayer.get(r.player) ?? byPlayer.set(r.player, []).get(r.player)!).push(r);
      }
      for (const l of byPlayer.values()) {
        const vals = l.map((r) => st.extract(r.stats as Record<string, string>) ?? 0);
        if (vals.filter((v) => v > 0).length < vals.length * 0.5) continue;
        for (let i = 4; i < l.length; i++) {
          const r = l[i];
          if (r.oppElo === null) continue;
          const prior = vals.slice(Math.max(0, i - 20), i);
          const z = (r.oppElo - avgElo) / 100;
          add(`${st.statType}|oppElo|${split(r)}`, C, prior, undefined, st.cfg, st.floor, vals[i], (c) => Math.min(1.3, Math.max(0.7, 1 - c * z)));
        }
      }
    }
    return report(acc);
  }

  if (sport === "nhl") {
    const st = stats.find((x) => x.statType === "Saves");
    if (!st) return {};
    const toi = (r: SignalRow) => {
      const [m, s] = String(r.stats.TOI ?? "0:0").split(":").map(Number);
      return (m || 0) + (s || 0) / 60;
    };
    const byPlayer = new Map<string, SignalRow[]>();
    for (const r of rows) if (r.stats.group === "goalies") (byPlayer.get(r.player) ?? byPlayer.set(r.player, []).get(r.player)!).push(r);
    for (const l of byPlayer.values()) {
      for (let i = 8; i < l.length; i++) {
        const r = l[i];
        if (toi(r) < 40) continue; // props are for starts
        const v = st.extract(r.stats as Record<string, string>);
        if (v === null) continue;
        const priorAll = l.slice(Math.max(0, i - 20), i);
        const all = priorAll.map((x) => st.extract(x.stats as Record<string, string>) ?? 0);
        const starts = priorAll.filter((x) => toi(x) >= 40).map((x) => st.extract(x.stats as Record<string, string>) ?? 0);
        if (starts.length < 4) continue;
        const pAll = projectProp(all, st.cfg, st.floor);
        const pStart = projectProp(starts, st.cfg, st.floor);
        if (!pAll || !pStart || pAll.mean <= 0) continue;
        const ratio = pStart.mean / pAll.mean;
        add(`Saves|startsOnly|${split(r)}`, [0, 0.5, 1], all, undefined, st.cfg, st.floor, v, (b) => Math.pow(ratio, b));
      }
    }
    return report(acc);
  }
  return {};
}

/**
 * Round 2 (/api/health/insights?signalcal=<sport>&set=context): player-level
 * context the model doesn't use yet, every sport:
 *   rest: second night of a back-to-back (under ~30 hours since his last
 *         game) or 3+ days off, vs his usual rhythm;
 *   venue: home or away (his average mixes both).
 * Each is a multiplier on the projection, best fit on a grid.
 */
export function contextCal(sport: string, rows: SignalRow[], stats: StatDef[], testSeason: number, minutesOf: (s: Record<string, string>) => number | null) {
  const acc: Acc = {};
  const add = scorer(acc);
  rows.sort((a, b) => a.at - b.at || a.id - b.id);
  const split = (r: SignalRow) => (r.season === testSeason ? "test" : "train");
  const M = [0.9, 0.93, 0.95, 0.97, 1, 1.03, 1.05, 1.07, 1.1];
  const thin = sport === "mlb" ? 3 : 1;
  for (const st of stats) {
    const byPlayer = new Map<string, SignalRow[]>();
    for (const r of rows) {
      if (st.extract(r.stats as Record<string, string>) === null) continue;
      (byPlayer.get(`${r.team}|${r.player}`) ?? byPlayer.set(`${r.team}|${r.player}`, []).get(`${r.team}|${r.player}`)!).push(r);
    }
    for (const l of byPlayer.values()) {
      const vals = l.map((r) => st.extract(r.stats as Record<string, string>) ?? 0);
      const mins = l.map((r) => minutesOf(r.stats as Record<string, string>));
      if (vals.filter((v) => v > 0).length < vals.length * 0.4) continue;
      for (let i = 8; i < l.length; i++) {
        if (i % thin !== 0) continue;
        if (st.cfg.useMinutes && !((mins[i] ?? 0) > 0)) continue;
        const r = l[i];
        const lo = Math.max(0, i - 20);
        const prior = vals.slice(lo, i);
        const pm = st.cfg.useMinutes ? mins.slice(lo, i) : undefined;
        const s = split(r);
        const hours = (r.at - l[i - 1].at) / 3600_000;
        if (sport !== "mlb" && hours > 0) {
          if (hours < 30) add(`${st.statType}|backToBack|${s}`, M, prior, pm, st.cfg, st.floor, vals[i], (m) => m);
          else if (hours >= 72 && hours < 24 * 10) add(`${st.statType}|rested3plus|${s}`, M, prior, pm, st.cfg, st.floor, vals[i], (m) => m);
        }
        add(`${st.statType}|${r.team === r.home ? "home" : "away"}|${s}`, M, prior, pm, st.cfg, st.floor, vals[i], (m) => m);
      }
    }
  }
  return report(acc);
}
