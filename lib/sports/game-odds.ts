// Game lines (moneyline, spread, total) from the main US books plus the
// sharp, low-margin books (Pinnacle, BetOnline, LowVig) through the same
// rotating odds-key pool as everything else (lib/odds-provider.ts). One
// request per sport covers the whole board; up to 10 books cost the same as
// one. FanDuel/BetMGM stay the books shown and linked; every book feeds the
// market consensus the model blends with (lib/sports/game-model.ts).
import { oddsApiGet, hasOddsApiKey } from "../odds-provider";
import { ODDS_API_SPORT_KEY } from "./odds";
import type { SportKey } from "./types";

export interface BookLine {
  mlHome: number | null;
  mlAway: number | null;
  spreadHome: number | null; // home team's spread, e.g. -4.5
  spreadHomePrice: number | null;
  spreadAwayPrice: number | null;
  total: number | null;
  overPrice: number | null;
  underPrice: number | null;
}

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
 * Some feeds list alternate spreads in the same market as the main one.
 * The main line is the matching pair (home -x / away +x) priced closest
 * to even, which is how books set it.
 */
export function mainSpread(outs: Outcome[], home: string, away: string): { home: number; homePrice: number; awayPrice: number } | null {
  let best: { home: number; homePrice: number; awayPrice: number; gap: number } | null = null;
  for (const h of outs) {
    if (h.name !== home || h.point == null) continue;
    const a = outs.find((o) => o.name === away && o.point != null && Math.abs(o.point + h.point!) < 1e-9);
    if (!a) continue;
    const gap = Math.abs(impl(h.price) - impl(a.price));
    if (!best || gap < best.gap) best = { home: h.point, homePrice: h.price, awayPrice: a.price, gap };
  }
  return best && { home: best.home, homePrice: best.homePrice, awayPrice: best.awayPrice };
}

/** Same for totals: the Over/Under pair at one number priced closest to even. */
export function mainTotal(outs: Outcome[]): { line: number; overPrice: number; underPrice: number } | null {
  let best: { line: number; overPrice: number; underPrice: number; gap: number } | null = null;
  for (const o of outs) {
    if (o.name !== "Over" || o.point == null) continue;
    const u = outs.find((x) => x.name === "Under" && x.point === o.point);
    if (!u) continue;
    const gap = Math.abs(impl(o.price) - impl(u.price));
    if (!best || gap < best.gap) best = { line: o.point, overPrice: o.price, underPrice: u.price, gap };
  }
  return best && { line: best.line, overPrice: best.overPrice, underPrice: best.underPrice };
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
      for (const m of b.markets ?? []) {
        const outs = m.outcomes ?? [];
        if (m.key === "h2h") {
          for (const o of outs) {
            if (o.name === e.home_team) line.mlHome = o.price;
            else if (o.name === e.away_team) line.mlAway = o.price;
          }
        } else if (m.key === "spreads") {
          const sp = mainSpread(outs, e.home_team, e.away_team);
          if (sp) {
            line.spreadHome = sp.home;
            line.spreadHomePrice = sp.homePrice;
            line.spreadAwayPrice = sp.awayPrice;
          }
        } else if (m.key === "totals") {
          const t = mainTotal(outs);
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
