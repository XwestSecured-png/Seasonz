// Game lines (moneyline, spread, total) from the main US books plus the
// sharp, low-margin books (Pinnacle, BetOnline, LowVig) through the same
// rotating odds-key pool as everything else (lib/odds-provider.ts). One
// request per sport covers the whole board; up to 10 books cost the same as
// one. FanDuel/BetMGM stay the books shown and linked; every book feeds the
// market consensus the model blends with (lib/sports/game-model.ts).
import { oddsApiGet, hasOddsApiKey } from "../odds-provider";
import { ODDS_API_SPORT_KEY } from "./odds";
import type { SportKey } from "./types";
import { simulateGame, SIM } from "./game-sim";

export interface BookLine {
  mlHome: number | null;
  mlAway: number | null;
  spreadHome: number | null; // home team's spread, e.g. -4.5
  spreadHomePrice: number | null;
  spreadAwayPrice: number | null;
  total: number | null;
  overPrice: number | null;
  underPrice: number | null;
  /** Every spread / total pair the book listed (alternate and period lines included), so the sync can pick the full-game one against ESPN's posted number. Not stored. */
  spreadAlts?: SpreadPair[];
  totalAlts?: TotalPair[];
}
export type SpreadPair = { home: number; homePrice: number; awayPrice: number };
export type TotalPair = { line: number; overPrice: number; underPrice: number };

export interface BoardGame {
  homeTeam: string; // full name, as the book lists it
  awayTeam: string;
  commenceTime: string;
  books: Partial<Record<GameBook, BookLine>>;
}

export const GAME_BOOKS = ["fanduel", "betmgm", "draftkings", "williamhill_us", "pinnacle", "betonlineag", "lowvig"] as const;
export type GameBook = (typeof GAME_BOOKS)[number];
const isGameBook = (k: string): k is GameBook => (GAME_BOOKS as readonly string[]).includes(k);

interface Raw {
  home_team: string;
  away_team: string;
  commence_time: string;
  bookmakers?: {
    key: string;
    markets?: { key: string; outcomes?: { name: string; price: number; point?: number }[] }[];
  }[];
}

type Outcome = { name: string; price: number; point?: number };
const impl = (a: number) => (a < 0 ? -a / (-a + 100) : 100 / (a + 100));

/**
 * Some feeds list alternate and period (half, quarter, first-5-innings)
 * spreads in the same market as the full-game line. With the moneyline
 * known, the full-game spread is the one whose price agrees with it: the
 * pair whose no-vig cover chance is closest to what the moneyline implies
 * at that number (lib/sports/game-sim.ts). Without a moneyline, the pair
 * priced closest to even.
 */
const normName = (n: string) => n.toLowerCase().replace(/\bst\b\.?/g, "state").replace(/[^a-z0-9]/g, "");
/**
 * The names a book uses for the home and away side. Feeds sometimes spell a
 * team one way in the event ("Mississippi State Bulldogs") and another in
 * the outcomes ("Mississippi St Bulldogs"); exact matching then dropped the
 * home side, and with it the whole moneyline and spread (1.21.1: 20+
 * college games a Saturday). Exact match first, then the same name once
 * punctuation and "St"/"State" are ignored, then "the other one" when a
 * market has exactly two teams and one side matched.
 */
export function sideNames(outs: Outcome[], home: string, away: string): { home: string; away: string } {
  const names = [...new Set(outs.map((o) => o.name).filter((n) => n !== "Over" && n !== "Under" && n !== "Draw"))];
  const find = (t: string) => names.find((n) => n === t) ?? names.find((n) => normName(n) === normName(t));
  let h = find(home);
  let a = find(away);
  if (names.length === 2) {
    if (h && !a) a = names.find((n) => n !== h);
    if (a && !h) h = names.find((n) => n !== a);
  }
  return { home: h ?? home, away: a ?? away };
}

export function spreadPairs(outs: Outcome[], homeIn: string, awayIn: string): SpreadPair[] {
  const { home, away } = sideNames(outs, homeIn, awayIn);
  const out: SpreadPair[] = [];
  for (const h of outs) {
    if (h.name !== home || h.point == null) continue;
    const a = outs.find((o) => o.name === away && o.point != null && Math.abs(o.point + h.point!) < 1e-9);
    if (a) out.push({ home: h.point, homePrice: h.price, awayPrice: a.price });
  }
  return out;
}

export function mainSpread(
  outs: Outcome[],
  home: string,
  away: string,
  ctx?: { sport: SportKey | "nfl"; homePct: number | null; anchor?: number | null }
): SpreadPair | null {
  return pickSpread(spreadPairs(outs, home, away), ctx);
}

/**
 * The full-game spread among a book's pairs: ESPN's posted number when
 * known (closest point wins); otherwise, among pairs whose price agrees
 * with the moneyline (period lines don't), the one priced closest to even.
 */
export function pickSpread(pairs: SpreadPair[], ctx?: { sport: SportKey | "nfl"; homePct: number | null; anchor?: number | null }): SpreadPair | null {
  if (pairs.length === 0) return null;
  const balance = (p: SpreadPair) => Math.abs(impl(p.homePrice) - impl(p.awayPrice));
  if (ctx?.anchor != null) {
    const a = ctx.anchor;
    return [...pairs].sort((x, y) => Math.abs(x.home - a) - Math.abs(y.home - a) || balance(x) - balance(y))[0];
  }
  let pool = pairs;
  if (ctx?.homePct != null) {
    const agree = pairs.filter((p) => {
      const cover = impl(p.homePrice) / (impl(p.homePrice) + impl(p.awayPrice));
      return Math.abs(cover - (simulateGame(ctx.sport, { homePct: ctx.homePct!, spreadHome: p.home }).coverHome ?? 0.5)) < 0.1;
    });
    if (agree.length) pool = agree;
  }
  return [...pool].sort((x, y) => balance(x) - balance(y))[0];
}

/**
 * Totals: only numbers in a full-game range for the sport (60-160% of its
 * average total, which rules out half / quarter / period totals), then the
 * Over/Under pair priced closest to even.
 */
export function totalPairs(outs: Outcome[]): TotalPair[] {
  const out: TotalPair[] = [];
  for (const o of outs) {
    if (o.name !== "Over" || o.point == null) continue;
    const u = outs.find((x) => x.name === "Under" && x.point === o.point);
    if (u) out.push({ line: o.point, overPrice: o.price, underPrice: u.price });
  }
  return out;
}

export function mainTotal(outs: Outcome[], sport?: SportKey | "nfl", anchor?: number | null): TotalPair | null {
  return pickTotal(totalPairs(outs), sport, anchor);
}

/** ESPN's posted total when known (closest wins); else numbers in a full-game range, priced closest to even. */
export function pickTotal(pairs: TotalPair[], sport?: SportKey | "nfl", anchor?: number | null): TotalPair | null {
  const balance = (p: TotalPair) => Math.abs(impl(p.overPrice) - impl(p.underPrice));
  if (pairs.length === 0) return null;
  if (anchor != null) return [...pairs].sort((x, y) => Math.abs(x.line - anchor) - Math.abs(y.line - anchor) || balance(x) - balance(y))[0];
  const avg = sport ? SIM[sport].avgTotal : null;
  const pool = avg != null ? pairs.filter((p) => p.line >= 0.6 * avg && p.line <= 1.6 * avg) : pairs;
  return [...(pool.length ? pool : pairs)].sort((x, y) => balance(x) - balance(y))[0] ?? null;
}

export async function fetchGameOddsForSport(sport: SportKey): Promise<BoardGame[]> {
  if (!hasOddsApiKey()) return [];
  let data: Raw[];
  const get = (bookmakers: string) =>
    oddsApiGet<Raw[]>(`/sports/${ODDS_API_SPORT_KEY[sport]}/odds`, {
      regions: "us",
      markets: "h2h,spreads,totals",
      bookmakers,
      oddsFormat: "american",
    });
  try {
    data = await get(GAME_BOOKS.join(","));
    if (!data.some((e) => (e.bookmakers ?? []).length > 0)) data = await get("fanduel,betmgm");
  } catch {
    // A provider that doesn't carry one of the extra books: fall back to the two main ones.
    try {
      data = await get("fanduel,betmgm");
    } catch {
      return [];
    }
  }
  return data.map((e) => {
    const books: BoardGame["books"] = {};
    for (const b of e.bookmakers ?? []) {
      if (!isGameBook(b.key)) continue;
      const line: BookLine = {
        mlHome: null,
        mlAway: null,
        spreadHome: null,
        spreadHomePrice: null,
        spreadAwayPrice: null,
        total: null,
        overPrice: null,
        underPrice: null,
      };
      // The moneyline first: it identifies the full-game spread below.
      for (const m of b.markets ?? [])
        if (m.key === "h2h") {
          const side = sideNames(m.outcomes ?? [], e.home_team, e.away_team);
          for (const o of m.outcomes ?? []) {
            if (o.name === side.home) line.mlHome = o.price;
            else if (o.name === side.away) line.mlAway = o.price;
          }
        }
      const mlPct =
        line.mlHome != null && line.mlAway != null ? impl(line.mlHome) / (impl(line.mlHome) + impl(line.mlAway)) : null;
      for (const m of b.markets ?? []) {
        const outs = m.outcomes ?? [];
        if (m.key === "spreads") {
          line.spreadAlts = spreadPairs(outs, e.home_team, e.away_team);
          const sp = pickSpread(line.spreadAlts, { sport, homePct: mlPct });
          if (sp) {
            line.spreadHome = sp.home;
            line.spreadHomePrice = sp.homePrice;
            line.spreadAwayPrice = sp.awayPrice;
          }
        } else if (m.key === "totals") {
          line.totalAlts = totalPairs(outs);
          const t = pickTotal(line.totalAlts, sport);
          if (t) {
            line.total = t.line;
            line.overPrice = t.overPrice;
            line.underPrice = t.underPrice;
          }
        }
      }
      books[b.key] = line;
    }
    return { homeTeam: e.home_team, awayTeam: e.away_team, commenceTime: e.commence_time, books };
  });
}
