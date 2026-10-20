// Measures same-game correlations for hockey and baseball
// (/api/health/insights?sgpcal=nhl|mlb), the way football and basketball
// were measured for lib/sgp.ts: each player's game-to-game swing in a stat
// (value minus his prior 20-game average, over its spread) is paired with
// his own other stats, his teammates', his opponents', his team winning and
// the game's total. Pearson correlation of those swings, by stat family.

export interface SgpRow {
  gameId: number;
  team: string;
  player: string;
  at: number;
  home: string;
  homeScore: number | null;
  awayScore: number | null;
  stats: Record<string, string>;
}

type Fam = { name: string; extract: (s: Record<string, string>) => number | null };

class Corr {
  n = 0;
  sx = 0;
  sy = 0;
  sxx = 0;
  syy = 0;
  sxy = 0;
  add(x: number, y: number) {
    this.n++;
    this.sx += x;
    this.sy += y;
    this.sxx += x * x;
    this.syy += y * y;
    this.sxy += x * y;
  }
  r() {
    const { n, sx, sy, sxx, syy, sxy } = this;
    const v = (n * sxx - sx * sx) * (n * syy - sy * sy);
    return n > 30 && v > 0 ? +((n * sxy - sx * sy) / Math.sqrt(v)).toFixed(3) : null;
  }
}

export function sgpCal(rows: SgpRow[], fams: Fam[]) {
  rows.sort((a, b) => a.at - b.at);
  // z-swing per row per family, from the player's prior games only.
  const hist = new Map<string, number[]>();
  const z = new Map<SgpRow, Record<string, number>>();
  for (const r of rows) {
    const out: Record<string, number> = {};
    for (const f of fams) {
      const v = f.extract(r.stats);
      if (v === null) continue;
      const k = `${r.player}|${f.name}`;
      const h = hist.get(k) ?? [];
      if (h.length >= 8) {
        const w = h.slice(-20);
        const m = w.reduce((a, b) => a + b, 0) / w.length;
        const sd = Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / (w.length - 1));
        if (sd > 0) out[f.name] = (v - m) / sd;
      }
      h.push(v);
      hist.set(k, h);
    }
    if (Object.keys(out).length) z.set(r, out);
  }
  const same = new Map<string, Corr>();
  const mate = new Map<string, Corr>();
  const opp = new Map<string, Corr>();
  const win = new Map<string, Corr>();
  const total = new Map<string, Corr>();
  const get = (m: Map<string, Corr>, k: string) => m.get(k) ?? m.set(k, new Corr()).get(k)!;
  const pk = (a: string, b: string) => (a < b ? `${a}~${b}` : `${b}~${a}`);

  const byGame = new Map<number, SgpRow[]>();
  for (const r of z.keys()) (byGame.get(r.gameId) ?? byGame.set(r.gameId, []).get(r.gameId)!).push(r);
  // League-average game total, for the total swing.
  const totals = [...byGame.values()].map((l) => (l[0].homeScore ?? 0) + (l[0].awayScore ?? 0));
  const avgTotal = totals.reduce((a, b) => a + b, 0) / Math.max(1, totals.length);
  const sdTotal = Math.sqrt(totals.reduce((a, b) => a + (b - avgTotal) ** 2, 0) / Math.max(1, totals.length - 1)) || 1;

  for (const l of byGame.values()) {
    const g = l[0];
    if (g.homeScore == null || g.awayScore == null) continue;
    const t = (g.homeScore + g.awayScore - avgTotal) / sdTotal;
    for (let i = 0; i < l.length; i++) {
      const a = l[i];
      const za = z.get(a)!;
      const won = (a.team === g.home ? g.homeScore - g.awayScore : g.awayScore - g.homeScore) > 0 ? 1 : -1;
      const fa = Object.keys(za);
      for (let x = 0; x < fa.length; x++) {
        get(win, fa[x]).add(za[fa[x]], won);
        get(total, fa[x]).add(za[fa[x]], t);
        for (let y = x + 1; y < fa.length; y++) get(same, pk(fa[x], fa[y])).add(za[fa[x]], za[fa[y]]);
      }
      for (let j = i + 1; j < l.length; j++) {
        const b = l[j];
        const zb = z.get(b)!;
        const m = a.team === b.team ? mate : opp;
        for (const f1 of fa) for (const f2 of Object.keys(zb)) get(m, pk(f1, f2)).add(za[f1], zb[f2]);
      }
    }
  }
  const dump = (m: Map<string, Corr>) => Object.fromEntries([...m].map(([k, c]) => [k, { r: c.r(), n: c.n }]).filter(([, v]) => (v as { r: number | null }).r !== null));
  return { games: byGame.size, same: dump(same), teammates: dump(mate), opponents: dump(opp), teamWins: dump(win), gameTotal: dump(total) };
}
