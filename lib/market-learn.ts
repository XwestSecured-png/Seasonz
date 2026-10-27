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
import { and, eq, gt, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import { bookWeight, isPlaceholderLine, americanToImpliedProb, setLearnedBookWeights } from "./props-model";

export const MKT_MIN_N = 300;
export const MKT_PRIOR_N = 1500;
/** Line-move continuation is noisier (first week: helped on one half, hurt on the other), so it waits for more graded player-games. */
export const MKT_MOVE_MIN_N = 1500;

const clampP = (p: number) => Math.min(0.995, Math.max(0.005, p));
const logit = (p: number) => Math.log(clampP(p) / (1 - clampP(p)));
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export interface MarketRow {
  /** The model's own Over chance when the line was archived (1.22.0), if known. */
  model?: number;
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
  modelOver?: number | null;
}

/** Weighted no-vig Over chance per prop line, at open and at close. */
export function consensusRows(rows: ArchRow[], opts: { graded?: boolean } = {}): MarketRow[] {
  const graded = opts.graded ?? true;
  const pairs = new Map<string, { o?: ArchRow; u?: ArchRow }>();
  for (const r of rows) {
    if (r.line == null || !r.player || !r.statType) continue;
    const k = `${r.gameKey}|${r.player}|${r.statType}|${r.line}|${r.book}`;
    const p = pairs.get(k) ?? {};
    if (r.side === "Over") p.o = r;
    else if (r.side === "Under") p.u = r;
    pairs.set(k, p);
  }
  const lines = new Map<string, { sc: number; so: number; w: number; y: 0 | 1; at: number; pk: string; model?: number }>();
  for (const { o, u } of pairs.values()) {
    if (!o || !u) continue;
    if (graded && (o.result == null || !["hit", "miss"].includes(o.result))) continue;
    if (o.closePrice == null || u.closePrice == null || o.openPrice == null || u.openPrice == null) continue;
    if (isPlaceholderLine(o.book, o.closePrice, u.closePrice)) continue;
    const co = americanToImpliedProb(o.closePrice);
    const cu = americanToImpliedProb(u.closePrice);
    const oo = americanToImpliedProb(o.openPrice);
    const ou = americanToImpliedProb(u.openPrice);
    if (co + cu < 0.98 || co + cu > 1.3 || oo + ou < 0.98 || oo + ou > 1.3) continue;
    const w = bookWeight(o.book);
    const k = `${o.gameKey}|${o.player}|${o.statType}|${o.line}`;
    const e = lines.get(k) ?? { sc: 0, so: 0, w: 0, y: (o.result === "hit" ? 1 : 0) as 0 | 1, at: o.closeAt?.getTime() ?? 0, pk: `${o.gameKey}|${o.player}|${o.statType}` };
    e.sc += w * (co / (co + cu));
    e.so += w * (oo / (oo + ou));
    e.w += w;
    if (o.modelOver != null && e.model === undefined) e.model = o.modelOver;
    lines.set(k, e);
  }
  const size = new Map<string, number>();
  for (const e of lines.values()) size.set(e.pk, (size.get(e.pk) ?? 0) + 1);
  return [...lines.values()].map((e) => ({ key: e.pk, close: e.sc / e.w, open: e.so / e.w, y: e.y, w: 1 / size.get(e.pk)!, at: e.at, model: e.model }));
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
      modelOver: lineArchive.modelOver,
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

/**
 * Market sharpness (1.30.0): the books' no-vig chances are too timid at the
 * extremes. On the archive's graded lines, NBA props priced 15% hit 9.6% and
 * 85% hit 88%; NHL 15% hit 11%, 76% hit 82%. A log-odds scale t > 1 spreads
 * them back out: sigmoid(t * logit(close) + bias + move...). Fitted with the
 * sport's bias and move held, and used only when the scale fitted on the older
 * half of dates also beats t = 1 on the newer half.
 */
export function marketTempLogLoss(rows: MarketRow[], t: number, bias: number, move: number): number {
  let s = 0;
  let n = 0;
  for (const r of rows) {
    const q = clampP(sigmoid(t * logit(r.close) + bias + move * (logit(r.close) - logit(r.open))));
    s -= r.w * (r.y ? Math.log(q) : Math.log(1 - q));
    n += r.w;
  }
  return s / Math.max(1e-9, n);
}
const TEMPS = [0.8, 0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3, 1.4, 1.5];
export function fitMarketTemp(rows: MarketRow[], bias: number, move: number) {
  let best = { t: 1, v: marketTempLogLoss(rows, 1, bias, move) };
  for (const t of TEMPS) {
    const v = marketTempLogLoss(rows, t, bias, move);
    if (v < best.v - 1e-12) best = { t, v };
  }
  return best;
}
export function marketTempHoldout(rows: MarketRow[], bias: number, move: number) {
  const sorted = [...rows].sort((a, b) => a.at - b.at);
  const cut = sorted[Math.floor(sorted.length / 2)]?.at ?? 0;
  const train = sorted.filter((r) => r.at < cut);
  const test = sorted.filter((r) => r.at >= cut);
  const fitT = fitMarketTemp(train, bias, move).t;
  const all = fitMarketTemp(sorted, bias, move);
  const n = new Set(sorted.map((r) => r.key)).size;
  const llTest1 = marketTempLogLoss(test, 1, bias, move);
  const llTestFit = marketTempLogLoss(test, fitT, bias, move);
  const helps = n >= MKT_MIN_N && test.length > 0 && llTestFit < llTest1 - 1e-4;
  // Shrunk toward 1 by n/(n+PRIOR_N), like bias.
  const t = helps ? +(1 + ((all.t - 1) * n) / (n + MKT_PRIOR_N)).toFixed(3) : 1;
  return { t, fitT: all.t, trainT: fitT, n, llTest1: +llTest1.toFixed(4), llTestFit: +llTestFit.toFixed(4), helps };
}

/** Opening weighted no-vig Over chance per "player|stat|line" for this week's props (from the archive). */
export async function openingMarket(sport: string, season: number, week: number): Promise<Map<string, number>> {
  const rows = await db
    .select({ player: lineArchive.player, statType: lineArchive.statType, line: lineArchive.line, side: lineArchive.side, book: lineArchive.book, openPrice: lineArchive.openPrice, gameKey: lineArchive.gameKey })
    .from(lineArchive)
    // Only lines still open and seen in the last 36 hours (games not played
    // yet): reading the whole week's archive took 25-40s on busy nights.
    .where(and(eq(lineArchive.sport, sport), eq(lineArchive.season, season), eq(lineArchive.week, week), eq(lineArchive.market, "prop"), isNotNull(lineArchive.openPrice), isNull(lineArchive.result), gt(lineArchive.closeAt, new Date(Date.now() - 36 * 3600_000))));
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
  // Learned book weights (lib/book-weights.ts), stored "book:<name>".
  const bw: Record<string, number> = {};
  for (const [k, v] of Object.entries(store)) if (k.startsWith("book:") && typeof v.weight === "number" && v.weight >= 0.25 && v.weight <= 8) bw[k.slice(5)] = v.weight;
  setLearnedBookWeights(Object.keys(bw).length ? bw : null);
  const os = store[`mkt:${sport}:oneSided`]?.weight;
  const tempW = store[`mkt:${sport}:temp`]?.weight;
  const ce = store[`curve:${sport}:exact`]?.weight;
  const co = store[`curve:${sport}:one`]?.weight;
  const share = (w: number | undefined) => (typeof w === "number" && w >= 0 && w <= 1 ? w : undefined);
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
    temp: typeof tempW === "number" && tempW >= 0.8 && tempW <= 1.5 ? tempW : undefined,
    benched: (() => {
      const pre = `bench:${sport}:`;
      const set = new Set<string>();
      for (const [k, v] of Object.entries(store)) if (k.startsWith(pre) && v.weight === 1) set.add(k.slice(pre.length).replace(/:(Over|Under)$/, "|$1"));
      return set.size ? set : undefined;
    })(),
    modelCalByStat: (() => {
      const pre = `modelcal:${sport}:stat:`;
      const m: Record<string, { t: number; b: number }> = {};
      for (const [k, v] of Object.entries(store)) {
        if (!k.startsWith(pre) || !k.endsWith(":t")) continue;
        const stat = k.slice(pre.length, -2);
        const t = v.weight;
        const b = store[`${pre}${stat}:b`]?.weight;
        if (typeof t === "number" && typeof b === "number" && t >= 0.2 && t <= 1.3 && Math.abs(b) <= 0.5) m[stat] = { t, b };
      }
      return Object.keys(m).length ? m : undefined;
    })(),
    modelCal: (() => {
      const t = store[`modelcal:${sport}:t`]?.weight;
      const b = store[`modelcal:${sport}:b`]?.weight;
      return typeof t === "number" && typeof b === "number" && t >= 0.4 && t <= 1.3 && Math.abs(b) <= 0.5 ? { t, b } : undefined;
    })(),
    side: {
      Over: Math.max(-0.6, Math.min(0.6, Number(store[`side:${sport}:Over`]?.weight ?? 0) || 0)),
      Under: Math.max(-0.6, Math.min(0.6, Number(store[`side:${sport}:Under`]?.weight ?? 0) || 0)),
    },
    curveExact: share(ce),
    curveOne: share(co),
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

export const ARCHIVE_W_MIN_N = 200;
export const ARCHIVE_W_PRIOR_N = 400;
/**
 * Model share per stat from every graded archived line (1.22.0): the
 * model's own chance (stored when the line was archived) blended with the
 * market's, grid-searched for the best log loss, one vote per player-game,
 * moved from the sport's share by n/(n+400) once a stat has 200+ graded
 * player-games. Picks alone gave 60-370 graded player-games per sport; the
 * archive gives thousands.
 */
export function fitArchiveWeights(
  rows: MarketRow[],
  sportW: number,
  /** Where each stat's share starts before its own graded lines move it (closing-line evidence, fitClv). */
  priorOf: (stat: string) => number = () => sportW,
  /** The model calibration in use (fitModelCal), applied before blending, per stat. */
  calOf: (stat: string) => { t: number; b: number } = () => ({ t: 1, b: 0 })
): Record<string, { weight: number; best: number; n: number; llCurrent: number; llBest: number }> {
  const byStat = new Map<string, MarketRow[]>();
  for (const r of rows) {
    if (r.model === undefined) continue;
    const stat = r.key.split("|")[2];
    (byStat.get(stat) ?? byStat.set(stat, []).get(stat)!).push(r);
  }
  const ll = (l: MarketRow[], w: number) => {
    let s = 0;
    let n = 0;
    for (const r of l) {
      const cal = calOf(r.key.split("|")[2]);
      const q = clampP(sigmoid(w * (cal.t * logit(r.model!) + cal.b) + (1 - w) * logit(r.close)));
      s -= r.w * (r.y ? Math.log(q) : Math.log(1 - q));
      n += r.w;
    }
    return s / Math.max(1e-9, n);
  };
  const out: Record<string, { weight: number; best: number; n: number; llCurrent: number; llBest: number }> = {};
  for (const [stat, l] of byStat) {
    const n = new Set(l.map((r) => r.key)).size;
    if (n < ARCHIVE_W_MIN_N) continue;
    const prior = priorOf(stat);
    let best = { w: prior, v: ll(l, prior) };
    for (let w = 0; w <= 0.8001; w += 0.05) {
      const v = ll(l, w);
      if (v < best.v - 1e-12) best = { w: +w.toFixed(2), v };
    }
    out[stat] = { weight: +(prior + ((best.w - prior) * n) / (n + ARCHIVE_W_PRIOR_N)).toFixed(3), best: best.w, n, llCurrent: ll(l, prior), llBest: best.v };
  }
  return out;
}

/**
 * Closing-line evidence (1.26.0): of the gap between the model's chance and
 * a line's opening price, how much the market closes before game time
 * (beta, in log-odds, through the origin). Positive = the market later moves
 * toward the model, i.e. the model knows something; zero = it doesn't. Every
 * archived line counts (no need to wait for many results), one vote per
 * player-game. First check (Oct 2026): ~0.035 in the NFL, NBA, NHL and WNBA,
 * 0.003 in college football (matching its near-zero best share on results),
 * and ~0 on NFL Rush + Rec Yds, Rush Attempts and Longest Rush.
 */
export function fitClv(rows: MarketRow[]): { beta: number; n: number; sxy: number; sxx: number; stats: Record<string, { beta: number; n: number }> } {
  const acc = new Map<string, { sxy: number; sxx: number; keys: Set<string> }>();
  const all = { sxy: 0, sxx: 0, keys: new Set<string>() };
  for (const r of rows) {
    if (r.model === undefined) continue;
    const x = logit(r.model) - logit(r.open);
    if (Math.abs(x) >= 3) continue;
    const y = logit(r.close) - logit(r.open);
    const stat = r.key.split("|")[2];
    const a = acc.get(stat) ?? acc.set(stat, { sxy: 0, sxx: 0, keys: new Set() }).get(stat)!;
    for (const t of [a, all]) {
      t.sxy += r.w * x * y;
      t.sxx += r.w * x * x;
      t.keys.add(r.key);
    }
  }
  const stats: Record<string, { beta: number; n: number }> = {};
  for (const [stat, a] of acc) if (a.sxx > 0) stats[stat] = { beta: +(a.sxy / a.sxx).toFixed(4), n: a.keys.size };
  return { beta: all.sxx > 0 ? +(all.sxy / all.sxx).toFixed(4) : 0, n: all.keys.size, sxy: all.sxy, sxx: all.sxx, stats };
}

export const CLV_SPORT_PRIOR_N = 5000;
export const CLV_STAT_PRIOR_N = 2000;
/**
 * Multiplier on a stat's model share from closing-line evidence: its beta
 * (shrunk toward its sport's, which is shrunk toward the all-sports beta)
 * over the all-sports beta, kept to 0.25-1.5.
 */
export function clvFactor(stat: { beta: number; n: number } | undefined, sport: { beta: number; n: number }, ref: number): number {
  if (!(ref > 0)) return 1;
  const sb = (sport.n * sport.beta + CLV_SPORT_PRIOR_N * ref) / (sport.n + CLV_SPORT_PRIOR_N);
  const b = stat ? (stat.n * stat.beta + CLV_STAT_PRIOR_N * sb) / (stat.n + CLV_STAT_PRIOR_N) : sb;
  return +Math.max(0.25, Math.min(1.5, b / ref)).toFixed(3);
}

/**
 * Lines for the closing-line fit: every prop line with a model chance that
 * books stopped updating 3+ hours ago (the game started; close_at is the last
 * time its price was seen), graded or not, since the close is known at
 * kickoff, long before every result is graded.
 */
export async function clvRows(sport: string): Promise<MarketRow[]> {
  const now = new Date();
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
      modelOver: lineArchive.modelOver,
    })
    .from(lineArchive)
    .where(and(eq(lineArchive.sport, sport), eq(lineArchive.market, "prop"), isNotNull(lineArchive.modelOver), isNotNull(lineArchive.closePrice), lt(lineArchive.closeAt, new Date(now.getTime() - 3 * 3600_000)), gt(lineArchive.closeAt, new Date(now.getTime() - 75 * 86_400_000))));
  return consensusRows(rows, { graded: false });
}

export const MODELCAL_MIN_N = 300;
export const MODELCAL_PRIOR_N = 600;
/**
 * Model calibration (1.28.0): the model's own Over chance re-scaled in
 * log-odds, sigmoid(t * logit(p) + b), before it's blended with the market.
 * t < 1 = the model is overconfident, b < 0 = it leans Over too often. Fit on
 * every graded archived line with a stored model chance (one vote per
 * player-game) and moved in from (1, 0) by n/(n+1000) once a sport has 300+.
 * First look (college football): Overs the model rated 25-55% hit ~8 points
 * less often.
 */
export function fitModelCal(
  rows: MarketRow[],
  /** What to shrink toward (the sport's calibration, for a stat) and from how many player-games it's trusted. */
  prior: { t: number; b: number; minN?: number; priorN?: number } = { t: 1, b: 0 }
): { t: number; b: number; fitT: number; fitB: number; n: number; llRaw: number; llFit: number } {
  const use = rows.filter((r) => r.model !== undefined);
  const n = new Set(use.map((r) => r.key)).size;
  const ll = (t: number, b: number) => {
    let s = 0;
    let w = 0;
    for (const r of use) {
      const q = clampP(sigmoid(t * logit(r.model!) + b));
      s -= r.w * (r.y ? Math.log(q) : Math.log(1 - q));
      w += r.w;
    }
    return w ? s / w : 0;
  };
  let best = { t: 1, b: 0, v: ll(1, 0) };
  const llRaw = best.v;
  for (let t = 0.2; t <= 1.3001; t += 0.05)
    for (let b = -0.5; b <= 0.5001; b += 0.05) {
      const v = ll(t, b);
      if (v < best.v - 1e-12) best = { t: +t.toFixed(2), b: +b.toFixed(2), v };
    }
  const minN = prior.minN ?? MODELCAL_MIN_N;
  const pn = prior.priorN ?? MODELCAL_PRIOR_N;
  const k = n >= minN ? n / (n + pn) : 0;
  return { t: +(prior.t + (best.t - prior.t) * k).toFixed(3), b: +(prior.b + (best.b - prior.b) * k).toFixed(3), fitT: best.t, fitB: best.b, n, llRaw: +llRaw.toFixed(4), llFit: +best.v.toFixed(4) };
}

/**
 * Per-stat model calibration (1.29.0), shrunk toward the sport's: in college
 * football the raw model was worse than a coin flip on Rush Attempts (rated
 * 35%, hit 50%), Longest Reception (56% vs 51%) and Receptions, while Pass Yds
 * and Anytime TD were fine, so one correction per sport can't fix both.
 */
export const MODELCAL_STAT_MIN_N = 100;
export const MODELCAL_STAT_PRIOR_N = 300;
export function fitModelCalByStat(rows: MarketRow[], sport: { t: number; b: number }): Record<string, ReturnType<typeof fitModelCal>> {
  const by = new Map<string, MarketRow[]>();
  for (const r of rows) {
    if (r.model === undefined) continue;
    const stat = r.key.split("|")[2];
    (by.get(stat) ?? by.set(stat, []).get(stat)!).push(r);
  }
  const out: Record<string, ReturnType<typeof fitModelCal>> = {};
  for (const [stat, l] of by) {
    const f = fitModelCal(l, { ...sport, minN: MODELCAL_STAT_MIN_N, priorN: MODELCAL_STAT_PRIOR_N });
    if (f.n >= MODELCAL_STAT_MIN_N) out[stat] = f;
  }
  return out;
}

/** Held-out check (insights ?modelcal=<sport>): fit on the older half of dates, score the newer half. */
export function modelCalHoldout(rows: MarketRow[]) {
  const use = rows.filter((r) => r.model !== undefined).sort((a, b) => a.at - b.at);
  const cut = use[Math.floor(use.length / 2)]?.at ?? 0;
  const tr = use.filter((r) => r.at < cut);
  const te = use.filter((r) => r.at >= cut);
  const sport = fitModelCal(tr);
  const byStat = fitModelCalByStat(tr, { t: sport.t, b: sport.b });
  const score = (cal: (r: MarketRow) => { t: number; b: number }) => {
    let s = 0;
    let w = 0;
    for (const r of te) {
      const c = cal(r);
      const q = clampP(sigmoid(c.t * logit(r.model!) + c.b));
      s -= r.w * (r.y ? Math.log(q) : Math.log(1 - q));
      w += r.w;
    }
    return w ? +(s / w).toFixed(4) : 0;
  };
  return {
    train: tr.length,
    test: te.length,
    sport: { t: sport.t, b: sport.b, n: sport.n },
    stats: Object.fromEntries(Object.entries(byStat).map(([k, f]) => [k, { t: f.t, b: f.b, n: f.n }])),
    llRaw: score(() => ({ t: 1, b: 0 })),
    llSport: score(() => sport),
    llStat: score((r) => byStat[r.key.split("|")[2]] ?? sport),
  };
}
