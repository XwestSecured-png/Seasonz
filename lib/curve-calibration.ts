// Market curve check (/api/health/insights?curvecal=<sport>), 1.24.0.
//
// On every graded archived prop line: is the line better priced by its own
// books (two-sided no-vig, or one book's one-sided alt price less the learned
// margin) or by the player's whole price curve (lib/market-curve.ts), or a
// blend? One vote per player-game, alt lines split it; slope prior k fitted
// per stat on the older half, scored on the newer half.
import { bookWeight, isPlaceholderLine, americanToImpliedProb } from "./props-model";
import { buildCurve, curveChance, blendLogit, type CurvePoint } from "./market-curve";
import { oneSidedChance } from "./market-adjust";

export interface CurveRow {
  gameKey: string;
  player: string | null;
  statType: string | null;
  line: number | null;
  side: string;
  book: string;
  closePrice: number | null;
  closeAt: Date | null;
  actual: number | null;
}

const ll = (y: number, p: number) => {
  const q = Math.min(0.995, Math.max(0.005, p));
  return -(y ? Math.log(q) : Math.log(1 - q));
};

interface LineEval {
  stat: string;
  at: number;
  w: number;
  y: 0 | 1;
  cat: "two" | "one" | "none";
  base?: number;
  /** Two-sided points of the player-game, line excluded or not. */
  ptsAll: CurvePoint[];
  ptsLoo: CurvePoint[];
  line: number;
}

export function curveCal(rows: CurveRow[], oneSidedShift: number) {
  // Per player-game: per line+book the two sides' prices.
  const games = new Map<string, Map<string, { line: number; book: string; o?: number; u?: number; at: number; actual: number | null }>>();
  for (const r of rows) {
    if (r.line == null || !r.player || !r.statType || r.closePrice == null) continue;
    if (r.side !== "Over" && r.side !== "Under") continue;
    const pk = `${r.gameKey}|${r.player}|${r.statType}`;
    const m = games.get(pk) ?? games.set(pk, new Map()).get(pk)!;
    const k = `${r.line}|${r.book}`;
    const e = m.get(k) ?? { line: r.line, book: r.book, at: r.closeAt?.getTime() ?? 0, actual: r.actual };
    if (r.side === "Over") e.o = r.closePrice;
    else e.u = r.closePrice;
    if (e.actual == null) e.actual = r.actual;
    m.set(k, e);
  }
  const evals: LineEval[] = [];
  const slopes = new Map<string, { v: number; w: number; at: number }[]>();
  for (const [pk, m] of games) {
    const stat = pk.split("|").slice(-1)[0];
    const actual = [...m.values()].find((e) => e.actual != null)?.actual;
    if (actual == null) continue;
    const two = new Map<number, { s: number; w: number }>();
    const one = new Map<number, number[]>();
    const lines = new Set<number>();
    let at = 0;
    for (const e of m.values()) {
      at = Math.max(at, e.at);
      lines.add(e.line);
      if (e.o !== undefined && e.u !== undefined) {
        if (isPlaceholderLine(e.book, e.o, e.u)) continue;
        const o = americanToImpliedProb(e.o);
        const u = americanToImpliedProb(e.u);
        if (o + u < 0.98 || o + u > 1.3) continue;
        const t = two.get(e.line) ?? { s: 0, w: 0 };
        const w = bookWeight(e.book);
        t.s += w * (o / (o + u));
        t.w += w;
        two.set(e.line, t);
      } else {
        if (isPlaceholderLine(e.book, e.o, e.u)) continue;
        const c = oneSidedChance(e.o, e.u, oneSidedShift);
        if (c !== undefined) (one.get(e.line) ?? one.set(e.line, []).get(e.line)!).push(c);
      }
    }
    const pts: CurvePoint[] = [...two].map(([line, t]) => ({ line, p: t.s / t.w, w: t.w }));
    // Raw ladder slope (normalized by sqrt(line)) when the player has 2+ two-sided lines.
    if (pts.length >= 2) {
      const W = pts.reduce((s, p) => s + p.w, 0);
      const c = pts.reduce((s, p) => s + p.w * p.line, 0) / W;
      const lg = (p: number) => Math.log(Math.min(0.995, Math.max(0.005, p)) / (1 - Math.min(0.995, Math.max(0.005, p))));
      const a = pts.reduce((s, p) => s + p.w * lg(p.p), 0) / W;
      let sxy = 0;
      let sxx = 0;
      for (const p of pts) {
        sxy += p.w * (p.line - c) * (lg(p.p) - a);
        sxx += p.w * (p.line - c) ** 2;
      }
      if (sxx > 0) (slopes.get(stat) ?? slopes.set(stat, []).get(stat)!).push({ v: (-sxy / sxx) * Math.sqrt(Math.max(0.5, Math.abs(c))), w: sxx, at });
    }
    const graded = [...lines].filter((l) => actual !== l);
    for (const line of graded) {
      const y: 0 | 1 = actual > line ? 1 : 0;
      const t = two.get(line);
      const os = one.get(line);
      const cat = t ? "two" : os ? "one" : "none";
      const base = t ? t.s / t.w : os ? os.reduce((s, x) => s + x, 0) / os.length : undefined;
      evals.push({ stat, at, w: 1 / graded.length, y, cat, base, line, ptsAll: pts, ptsLoo: pts.filter((p) => p.line !== line) });
    }
  }
  // Time split.
  const sorted = [...evals].sort((a, b) => a.at - b.at);
  const cut = sorted[Math.floor(sorted.length / 2)]?.at ?? 0;
  const kFit = (pred: (s: { at: number }) => boolean) => {
    const out: Record<string, number> = {};
    for (const [stat, l] of slopes) {
      const v = l.filter(pred).filter((x) => x.v > 0 && Number.isFinite(x.v)).sort((a, b) => a.v - b.v);
      if (v.length < 20) continue;
      const W = v.reduce((s, x) => s + x.w, 0);
      let acc = 0;
      for (const x of v) {
        acc += x.w;
        if (acc >= W / 2) {
          out[stat] = +x.v.toFixed(3);
          break;
        }
      }
    }
    return out;
  };
  const kTrain = kFit((s) => s.at < cut);
  const kAll = kFit(() => true);
  const W = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
  const score = (set: LineEval[], k: Record<string, number>, kDefault: number, loo: boolean) => {
    const acc: Record<string, { n: number; base: number; curve: number; grid: number[]; noCurve: number }> = {};
    for (const e of set) {
      for (const key of [e.cat, `${e.cat}|${e.stat}`]) {
        const a = (acc[key] ??= { n: 0, base: 0, curve: 0, grid: W.map(() => 0), noCurve: 0 });
        const cv = buildCurve(loo ? e.ptsLoo : e.ptsAll, k[e.stat] ?? kDefault);
        if (!cv) {
          a.noCurve += e.w;
          continue;
        }
        const pc = curveChance(cv, e.line);
        const pb = e.base ?? 0.5;
        a.n += e.w;
        a.base += e.w * ll(e.y, pb);
        a.curve += e.w * ll(e.y, pc);
        W.forEach((w, j) => (a.grid[j] += e.w * ll(e.y, e.base === undefined ? pc : blendLogit(pb, pc, w))));
      }
    }
    const out: Record<string, unknown> = {};
    for (const [key, a] of Object.entries(acc)) {
      if (a.n < 30) continue;
      let bj = 0;
      a.grid.forEach((v, j) => {
        if (v < a.grid[bj]) bj = j;
      });
      out[key] = { n: Math.round(a.n), noCurve: Math.round(a.noCurve), llBase: +(a.base / a.n).toFixed(4), llCurve: +(a.curve / a.n).toFixed(4), bestW: W[bj], llBest: +(a.grid[bj] / a.n).toFixed(4), gainPct: +(((a.base - a.grid[bj]) / a.base) * 100).toFixed(2) };
    }
    return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
  };
  const train = sorted.filter((e) => e.at < cut);
  const test = sorted.filter((e) => e.at >= cut);
  return {
    lines: evals.length,
    kTrain,
    kAll,
    train: score(train, kTrain, 1, false),
    test: score(test, kTrain, 1, false),
    testLoo: score(test, kTrain, 1, true),
  };
}
