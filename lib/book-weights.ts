// Learned book weights (1.27.0).
//
// How much each sportsbook counts in the market's no-vig chance was fixed in
// 1.19.0 from the first graded week (Kalshi/Polymarket 3x; Novig, ProphetX,
// Pinnacle 2x). Two weeks later the line archive says Kalshi is far sharper
// than the rest of the board (log loss .488 vs .523 on the same props), while
// Pinnacle, ProphetX and Novig are no sharper than average on props. So the
// weights are now re-learned nightly from every graded line:
//
//   d_b = book b's log loss minus the rest of the board's on the same lines
//         (only lines 3+ books priced), shrunk by n/(n+2000)
//   w_b = exp(-kappa * d_b), kept to 0.25-8
//
// kappa is chosen by cross-fitting: d fitted on one half of the dates and
// the consensus scored on the other, both ways round.
import { db } from "@/db";
import { lineArchive } from "@/db/schema";
import { and, eq, gt, inArray, isNotNull } from "drizzle-orm";
import { americanToImpliedProb, isPlaceholderLine } from "./props-model";

const clampP = (p: number) => Math.min(0.995, Math.max(0.005, p));
const ll = (y: number, p: number) => -(y ? Math.log(clampP(p)) : Math.log(1 - clampP(p)));

export interface BookRow {
  key: string; // game|player|stat|line
  pg: string; // game|player|stat (one vote per player-game)
  book: string;
  p: number; // no-vig Over chance
  y: 0 | 1;
  at: number;
}

export const BOOK_PRIOR_N = 2000;
export const BOOK_W_MIN = 0.25;
export const BOOK_W_MAX = 8;
const KAPPAS = [0, 10, 20, 30, 40, 60, 80, 100, 150, 200, 300];

/** Graded two-sided prop lines (last 60 days), one row per book per line. */
export async function bookRows(): Promise<BookRow[]> {
  const rows = await db
    .select({ gameKey: lineArchive.gameKey, player: lineArchive.player, statType: lineArchive.statType, line: lineArchive.line, side: lineArchive.side, book: lineArchive.book, closePrice: lineArchive.closePrice, closeAt: lineArchive.closeAt, result: lineArchive.result })
    .from(lineArchive)
    .where(and(eq(lineArchive.market, "prop"), inArray(lineArchive.result, ["hit", "miss"]), isNotNull(lineArchive.closePrice), gt(lineArchive.closeAt, new Date(Date.now() - 60 * 86_400_000))));
  const pairs = new Map<string, { o?: (typeof rows)[number]; u?: (typeof rows)[number] }>();
  for (const r of rows) {
    if (r.line == null || !r.player || !r.statType) continue;
    const k = `${r.gameKey}|${r.player}|${r.statType}|${r.line}|${r.book}`;
    const e = pairs.get(k) ?? {};
    if (r.side === "Over") e.o = r;
    else if (r.side === "Under") e.u = r;
    pairs.set(k, e);
  }
  const out: BookRow[] = [];
  for (const { o, u } of pairs.values()) {
    if (!o || !u || o.closePrice == null || u.closePrice == null) continue;
    if (isPlaceholderLine(o.book, o.closePrice, u.closePrice)) continue;
    const io = americanToImpliedProb(o.closePrice);
    const iu = americanToImpliedProb(u.closePrice);
    if (io + iu < 0.98 || io + iu > 1.3) continue;
    out.push({ key: `${o.gameKey}|${o.player}|${o.statType}|${o.line}`, pg: `${o.gameKey}|${o.player}|${o.statType}`, book: o.book, p: io / (io + iu), y: o.result === "hit" ? 1 : 0, at: o.closeAt?.getTime() ?? 0 });
  }
  return out;
}

function groups(rows: BookRow[]): BookRow[][] {
  const g = new Map<string, BookRow[]>();
  for (const r of rows) (g.get(r.key) ?? g.set(r.key, []).get(r.key)!).push(r);
  return [...g.values()].filter((l) => l.length >= 3);
}

/** Each book's log loss minus the rest of the board's (leave-one-out average), shrunk. */
export function bookEdges(rows: BookRow[]): Record<string, { d: number; raw: number; n: number }> {
  const acc = new Map<string, { s: number; n: number }>();
  for (const l of groups(rows)) {
    const sum = l.reduce((a, r) => a + r.p, 0);
    for (const r of l) {
      const rest = (sum - r.p) / (l.length - 1);
      const a = acc.get(r.book) ?? { s: 0, n: 0 };
      a.s += ll(r.y, r.p) - ll(r.y, rest);
      a.n++;
      acc.set(r.book, a);
    }
  }
  const out: Record<string, { d: number; raw: number; n: number }> = {};
  for (const [b, a] of acc) {
    const raw = a.s / a.n;
    out[b] = { raw: +raw.toFixed(5), d: +((raw * a.n) / (a.n + BOOK_PRIOR_N)).toFixed(5), n: a.n };
  }
  return out;
}

export const weightsFrom = (edges: Record<string, { d: number }>, kappa: number): Record<string, number> =>
  Object.fromEntries(Object.entries(edges).map(([b, e]) => [b, +Math.min(BOOK_W_MAX, Math.max(BOOK_W_MIN, Math.exp(-kappa * e.d))).toFixed(3)]));

/** Weighted-consensus log loss, one vote per player-game. */
export function consensusLogLoss(rows: BookRow[], weightOf: (book: string) => number): number {
  const g = groups(rows);
  const size = new Map<string, number>();
  for (const l of g) size.set(l[0].pg, (size.get(l[0].pg) ?? 0) + 1);
  let s = 0;
  let n = 0;
  for (const l of g) {
    let ws = 0;
    let ps = 0;
    for (const r of l) {
      const w = weightOf(r.book);
      ws += w;
      ps += w * r.p;
    }
    const v = 1 / size.get(l[0].pg)!;
    s += v * ll(l[0].y, ps / ws);
    n += v;
  }
  return n ? s / n : 0;
}

export interface BookWeightFit {
  kappa: number;
  weights: Record<string, number>;
  edges: Record<string, { d: number; raw: number; n: number }>;
  /** Cross-fitted log loss: equal weights, the coded 1.19.0 weights, learned. */
  llEqual: number;
  llCoded: number;
  llLearned: number;
  n: number;
}

export function fitBookWeights(rows: BookRow[], coded: (book: string) => number): BookWeightFit {
  const sorted = [...rows].sort((a, b) => a.at - b.at);
  const cut = sorted[Math.floor(sorted.length / 2)]?.at ?? 0;
  const A = sorted.filter((r) => r.at < cut);
  const B = sorted.filter((r) => r.at >= cut);
  const eA = bookEdges(A);
  const eB = bookEdges(B);
  const cross = (k: number) => {
    const wA = weightsFrom(eA, k);
    const wB = weightsFrom(eB, k);
    return (consensusLogLoss(B, (b) => wA[b] ?? 1) + consensusLogLoss(A, (b) => wB[b] ?? 1)) / 2;
  };
  let best = { k: 0, v: cross(0) };
  for (const k of KAPPAS) {
    const v = cross(k);
    if (v < best.v - 1e-9) best = { k, v };
  }
  const edges = bookEdges(sorted);
  return {
    kappa: best.k,
    weights: weightsFrom(edges, best.k),
    edges,
    llEqual: +cross(0).toFixed(5),
    llCoded: +((consensusLogLoss(A, coded) + consensusLogLoss(B, coded)) / 2).toFixed(5),
    llLearned: +best.v.toFixed(5),
    n: new Set(sorted.map((r) => r.pg)).size,
  };
}
