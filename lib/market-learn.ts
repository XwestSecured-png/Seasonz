// What the betting market itself teaches us, re-learned every day from the
// line archive (lib/line-archive.ts), where every prop line the app sees is
// kept with its opening and closing price and then graded.
//
//  1. Sharper books (BOOK_WEIGHT in lib/props-model.ts): prediction markets
//     and exchanges (Kalshi, Polymarket, Novig, ProphetX) and Pinnacle
//     beat the rest of the board on the same props, so they count more in
//     the market's no-vig chance.
//  2. Line movement: when a prop's price moves between open and now, part of
//     that move keeps going (news the market hasn't fully priced, usually a
//     role or minutes change). `move` = how much of the move (in log-odds)
//     to add again.
//  3. Over bias: bettors like Overs, so books shade them; `bias` is the
//     log-odds shift that lines the market's Over chance up with results.
// Both are fitted per sport by maximum likelihood on graded props (one vote
// per player-game, alternate lines split it), and moved in gradually: the
// value used is the fitted one x n/(n+PRIOR_N), and nothing is used before
// MIN_N player-games.
import { db } from "@/db";
import { lineArchive } from "@/db/schema";
import { and, eq, gt, inArray, isNotNull } from "drizzle-orm";
import { bookWeight, isPlaceholderLine, americanToImpliedProb } from "./props-model";

export const MKT_MIN_N = 300;
export const MKT_PRIOR_N = 1500;
/** Line-move continuation is noisier (first week: helped on one half, hurt on the other), so it waits for more graded player-games. */
export const MKT_MOVE_MIN_N = 1500;

const clampP = (p: number) => Math.min(0.995, Math.max(0.005, p));
const logit = (p: number) => Math.log(clampP(p) / (1 - clampP(p)));
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export interface MarketRow {
  key: string; // game|player|stat (one vote per player-game)
  close: number; // weighted no-vig Over chance at close
  open: number; // same at open
  y: 0 | 1;
  w: number;
  at: number;
}

interface ArchRow {
  gameKey: string;
  player: string | null;
  statType: string | null;
  line: number | null;
  side: string;
  book: string;
  openPrice: number | null;
  closePrice: number | null;
  closeAt: Date | null;
  result: string | null;
}

/** Weighted no-vig Over chance per prop line, at open and at close. */
export function consensusRows(rows: ArchRow[]): MarketRow[] {
  const pairs = new Map<string, { o?: ArchRow; u?: ArchRow }>();
  for (const r of rows) {
    if (r.line == null || !r.player || !r.statType) continue;
    const k = `${r.gameKey}|${r.player}|${r.statType}|${r.line}|${r.book}`;
    const p = pairs.get(k) ?? {};
    if (r.side === "Over") p.o = r;
    else if (r.side === "Under") p.u = r;
    pairs.set(k, p);
  }
  const lines = new Map<string, { sc: number; so: number; w: number; y: 0 | 1; at: number; pk: string }>();
  for (const { o, u } of pairs.values()) {
    if (!o || !u || o.result == null || !["hit", "miss"].includes(o.result)) continue;
    if (o.closePrice == null || u.closePrice == null || o.openPrice == null || u.openPrice == null) continue;
    if (isPlaceholderLine(o.book, o.closePrice, u.closePrice)) continue;
    const co = americanToImpliedProb(o.closePrice);
    const cu = americanToImpliedProb(u.closePrice);
    const oo = americanToImpliedProb(o.openPrice);
    const ou = americanToImpliedProb(u.openPrice);
    if (co + cu < 0.98 || co + cu > 1.3 || oo + ou < 0.98 || oo + ou > 1.3) continue;
    const w = bookWeight(o.book);
    const k = `${o.gameKey}|${o.player}|${o.statType}|${o.line}`;
    const e = lines.get(k) ?? { sc: 0, so: 0, w: 0, y: o.result === "hit" ? 1 : 0, at: o.closeAt?.getTime() ?? 0, pk: `${o.gameKey}|${o.player}|${o.statType}` };
    e.sc += w * (co / (co + cu));
    e.so += w * (oo / (oo + ou));
    e.w += w;
    lines.set(k, e);
  }
  const size = new Map<string, number>();
  for (const e of lines.values()) size.set(e.pk, (size.get(e.pk) ?? 0) + 1);
  return [...lines.values()].map((e) => ({ key: e.pk, close: e.sc / e.w, open: e.so / e.w, y: e.y, w: 1 / size.get(e.pk)!, at: e.at }));
}

export async function marketRows(sport: string): Promise<MarketRow[]> {
  const rows = await db
    .select({
      gameKey: lineArchive.gameKey,
      player: lineArchive.player,
      statType: lineArchive.statType,
      line: lineArchive.line,
      side: lineArchive.side,
      book: lineArchive.book,
      openPrice: lineArchive.openPrice,
      closePrice: lineArchive.closePrice,
      closeAt: lineArchive.closeAt,
      result: lineArchive.result,
    })
    .from(lineArchive)
    .where(and(eq(lineArchive.sport, sport), eq(lineArchive.market, "prop"), inArray(lineArchive.result, ["hit", "miss"]), isNotNull(lineArchive.closePrice), gt(lineArchive.closeAt, new Date(Date.now() - 75 * 86_400_000))));
  return consensusRows(rows);
}

/** Log loss of the adjusted market chance. */
export function marketLogLoss(rows: MarketRow[], bias: number, move: number): number {
  let s = 0;
  let n = 0;
  for (const r of rows) {
    const q = clampP(sigmoid(logit(r.close) + bias + move * (logit(r.close) - logit(r.open))));
    s -= r.w * (r.y ? Math.log(q) : Math.log(1 - q));
    n += r.w;
  }
  return s / Math.max(1e-9, n);
}

export interface MarketFit {
  n: number;
  bias: number;
  move: number;
  fitBias: number;
  fitMove: number;
  llBase: number;
  llFit: number;
}

/** Grid fit of bias and move, shrunk toward 0 by n/(n+PRIOR_N). */
export function fitMarket(rows: MarketRow[]): MarketFit {
  const n = new Set(rows.map((r) => r.key)).size;
  const llBase = marketLogLoss(rows, 0, 0);
  let best = { b: 0, m: 0, v: llBase };
  for (let b = -0.4; b <= 0.4001; b += 0.02)
    for (let m = -0.5; m <= 1.5001; m += 0.1) {
      const v = marketLogLoss(rows, b, m);
      if (v < best.v - 1e-12) best = { b: +b.toFixed(2), m: +m.toFixed(1), v };
    }
  const s = n >= MKT_MIN_N ? n / (n + MKT_PRIOR_N) : 0;
  const sm = n >= MKT_MOVE_MIN_N ? s : 0;
  return { n, bias: +(best.b * s).toFixed(3), move: +(best.m * sm).toFixed(3), fitBias: best.b, fitMove: best.m, llBase, llFit: best.v };
}

/** Train on the older half (by game time), score both settings on the newer half. */
export function marketHoldout(rows: MarketRow[]) {
  const sorted = [...rows].sort((a, b) => a.at - b.at);
  const cut = sorted[Math.floor(sorted.length / 2)]?.at ?? 0;
  const train = sorted.filter((r) => r.at < cut);
  const test = sorted.filter((r) => r.at >= cut);
  const fit = fitMarket(train);
  return {
    trainN: fit.n,
    testN: new Set(test.map((r) => r.key)).size,
    fitted: { bias: fit.fitBias, move: fit.fitMove },
    trainGainPct: +(((fit.llBase - fit.llFit) / fit.llBase) * 100).toFixed(2),
    testBase: +marketLogLoss(test, 0, 0).toFixed(4),
    testFitted: +marketLogLoss(test, fit.fitBias, fit.fitMove).toFixed(4),
    testShrunk: +marketLogLoss(test, fit.bias, fit.move).toFixed(4),
    testBiasOnly: +marketLogLoss(test, fit.fitBias, 0).toFixed(4),
    testMoveOnly: +marketLogLoss(test, 0, fit.fitMove).toFixed(4),
  };
}

/** Opening weighted no-vig Over chance per "player|stat|line" for this week's props (from the archive). */
export async function openingMarket(sport: string, season: number, week: number): Promise<Map<string, number>> {
  const rows = await db
    .select({ player: lineArchive.player, statType: lineArchive.statType, line: lineArchive.line, side: lineArchive.side, book: lineArchive.book, openPrice: lineArchive.openPrice, gameKey: lineArchive.gameKey })
    .from(lineArchive)
    .where(and(eq(lineArchive.sport, sport), eq(lineArchive.season, season), eq(lineArchive.week, week), eq(lineArchive.market, "prop"), isNotNull(lineArchive.openPrice)));
  const pairs = new Map<string, { o?: number; u?: number; book: string; k: string }>();
  for (const r of rows) {
    if (r.line == null || !r.player || !r.statType || r.openPrice == null) continue;
    const pk = `${r.gameKey}|${r.player}|${r.statType}|${r.line}|${r.book}`;
    const p = pairs.get(pk) ?? { book: r.book, k: `${r.player}|${r.statType}|${r.line}` };
    if (r.side === "Over") p.o = r.openPrice;
    else if (r.side === "Under") p.u = r.openPrice;
    pairs.set(pk, p);
  }
  const acc = new Map<string, { s: number; w: number }>();
  for (const p of pairs.values()) {
    if (p.o === undefined || p.u === undefined || isPlaceholderLine(p.book, p.o, p.u)) continue;
    const o = americanToImpliedProb(p.o);
    const u = americanToImpliedProb(p.u);
    if (o + u < 0.98 || o + u > 1.3) continue;
    const w = bookWeight(p.book);
    const a = acc.get(p.k) ?? { s: 0, w: 0 };
    a.s += w * (o / (o + u));
    a.w += w;
    acc.set(p.k, a);
  }
  return new Map([...acc].map(([k, a]) => [k, a.s / a.w]));
}

export { adjustMarket, type MarketLearn } from "./market-adjust";

/** Live market adjustments for a sport (stored "mkt:<sport>:bias" / ":move"), with this week's opening prices. */
export async function liveMarketLearn(store: Record<string, { weight: number; applied?: boolean }>, sport: string, season: number, week: number): Promise<import("./market-adjust").MarketLearn | undefined> {
  const bias = store[`mkt:${sport}:bias`]?.weight ?? 0;
  const move = store[`mkt:${sport}:move`]?.weight ?? 0;
  const os = store[`mkt:${sport}:oneSided`]?.weight;
  const biasByStat: Record<string, number> = {};
  const pre = `mkt:${sport}:bias:`;
  for (const [k, v] of Object.entries(store)) if (k.startsWith(pre) && typeof v.weight === "number") biasByStat[k.slice(pre.length)] = Math.max(-0.4, Math.min(0.4, v.weight));
  const open = move ? await openingMarket(sport, season, week).catch(() => new Map<string, number>()) : undefined;
  return {
    bias: Math.max(-0.3, Math.min(0.3, bias)),
    move: Math.max(-0.5, Math.min(1, move)),
    open,
    biasByStat: Object.keys(biasByStat).length ? biasByStat : undefined,
    oneSided: typeof os === "number" && os >= -1.5 && os <= 0.3 ? os : undefined,
  };
}

export const STAT_BIAS_MIN_N = 100;
export const STAT_BIAS_PRIOR_N = 800;
/** Per-stat Over bias (move held at the sport's), shrunk toward the sport's bias. */
export function fitStatBias(rows: MarketRow[], sportBias: number, move: number): Record<string, { bias: number; fit: number; n: number }> {
  const byStat = new Map<string, MarketRow[]>();
  for (const r of rows) {
    const stat = r.key.split("|")[2];
    (byStat.get(stat) ?? byStat.set(stat, []).get(stat)!).push(r);
  }
  const out: Record<string, { bias: number; fit: number; n: number }> = {};
  for (const [stat, l] of byStat) {
    const n = new Set(l.map((r) => r.key)).size;
    if (n < STAT_BIAS_MIN_N) continue;
    let best = { b: 0, v: marketLogLoss(l, 0, move) };
    for (let b = -0.5; b <= 0.5001; b += 0.02) {
      const v = marketLogLoss(l, b, move);
      if (v < best.v - 1e-12) best = { b: +b.toFixed(2), v };
    }
    out[stat] = { bias: +(sportBias + ((best.b - sportBias) * n) / (n + STAT_BIAS_PRIOR_N)).toFixed(3), fit: best.b, n };
  }
  return out;
}

/** Graded lines a book posted on one side only: implied chance of that side and whether it hit. */
export async function oneSidedRows(sport: string): Promise<{ key: string; imp: number; y: 0 | 1; w: number; at: number }[]> {
  const rows = await db
    .select({ gameKey: lineArchive.gameKey, player: lineArchive.player, statType: lineArchive.statType, line: lineArchive.line, side: lineArchive.side, book: lineArchive.book, closePrice: lineArchive.closePrice, closeAt: lineArchive.closeAt, result: lineArchive.result })
    .from(lineArchive)
    .where(and(eq(lineArchive.sport, sport), eq(lineArchive.market, "prop"), inArray(lineArchive.result, ["hit", "miss"]), isNotNull(lineArchive.closePrice), gt(lineArchive.closeAt, new Date(Date.now() - 75 * 86_400_000))));
  const sides = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = `${r.gameKey}|${r.player}|${r.statType}|${r.line}|${r.book}`;
    (sides.get(k) ?? sides.set(k, []).get(k)!).push(r);
  }
  const out: { key: string; imp: number; y: 0 | 1; w: number; at: number; pk: string }[] = [];
  for (const l of sides.values()) {
    if (l.length !== 1) continue;
    const r = l[0];
    if (isPlaceholderLine(r.book, r.closePrice!, undefined) || (r.side !== "Over" && r.side !== "Under")) continue;
    out.push({ key: r.side, imp: americanToImpliedProb(r.closePrice!), y: r.result === "hit" ? 1 : 0, w: 1, at: r.closeAt?.getTime() ?? 0, pk: `${r.gameKey}|${r.player}|${r.statType}` });
  }
  const size = new Map<string, number>();
  for (const r of out) size.set(r.pk, (size.get(r.pk) ?? 0) + 1);
  return out.map((r) => ({ key: r.pk, imp: r.imp, y: r.y, w: 1 / size.get(r.pk)!, at: r.at }));
}

export const ONE_SIDED_MIN_N = 100;
export const ONE_SIDED_PRIOR_N = 500;
/** Log-odds shift on one-sided prices, shrunk toward the coded default. */
export function fitOneSided(rows: { key: string; imp: number; y: 0 | 1; w: number }[], def: number) {
  const ll = (a: number) => {
    let s = 0;
    let n = 0;
    for (const r of rows) {
      const q = clampP(sigmoid(logit(r.imp) + a));
      s -= r.w * (r.y ? Math.log(q) : Math.log(1 - q));
      n += r.w;
    }
    return s / Math.max(1e-9, n);
  };
  const n = new Set(rows.map((r) => r.key)).size;
  let best = { a: def, v: ll(def) };
  for (let a = -1.5; a <= 0.3001; a += 0.05) {
    const v = ll(a);
    if (v < best.v - 1e-12) best = { a: +a.toFixed(2), v };
  }
  const used = n >= ONE_SIDED_MIN_N ? +(def + ((best.a - def) * n) / (n + ONE_SIDED_PRIOR_N)).toFixed(3) : def;
  return { n, used, fit: best.a, llDefault: ll(def), llOld: ll(Math.log(1 / 1.045)), llFit: best.v };
}
