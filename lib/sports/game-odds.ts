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
 * Some feeds list alternate and period (half, quarter, first-5-innings)
 * spreads in the same market as the full-game line. With the moneyline
 * known, the full-game spread is the one whose price agrees with it: the
 * pair whose no-vig cover chance is closest to what the moneyline implies
 * at that number (lib/sports/game-sim.ts). Without a moneyline, the pair
 * priced closest to even.
 */
export function mainSpread(
  outs: Outcome[],
  home: string,
  away: string,
  ctx?: { sport: SportKey | "nfl"; homePct: number | null }
): { home: number; homePrice: number; awayPrice: number } | null {
  let best: { home: number; homePrice: number; awayPrice: number; gap: number } | null = null;
  for (const h of outs) {
    if (h.name !== home || h.point == null) continue;
    const a = outs.find((o) => o.name === away && o.point != null && Math.abs(o.point + h.point!) < 1e-9);
    if (!a) continue;
    const cover = impl(h.price) / (impl(h.price) + impl(a.price));
    const gap =
      ctx?.homePct != null
        ? Math.abs(cover - (simulateGame(ctx.sport, { homePct: ctx.homePct, spreadHome: h.point }).coverHome ?? 0.5))
        : Math.abs(impl(h.price) - impl(a.price));
    if (!best || gap < best.gap) best = { home: h.point, homePrice: h.price, awayPrice: a.price, gap };
  }
  return best && { home: best.home, homePrice: best.homePrice, awayPrice: best.awayPrice };
}

/**
 * Totals: only numbers in a full-game range for the sport (60-160% of its
 * average total, which rules out half / quarter / period totals), then the
 * Over/Under pair priced closest to even.
 */
export function mainTotal(outs: Outcome[], sport?: SportKey | "nfl"): { line: number; overPrice: number; underPrice: number } | null {
  const avg = sport ? SIM[sport].avgTotal : null;
  let best: { line: number; overPrice: number; underPrice: number; gap: number } | null = null;
  for (const o of outs) {
    if (o.name !== "Over" || o.point == null) continue;
    if (avg != null && (o.point < 0.6 * avg || o.point > 1.6 * avg)) continue;
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
        if (m.key === "h2h")
          for (const o of m.outcomes ?? []) {
            if (o.name === e.home_team) line.mlHome = o.price;
            else if (o.name === e.away_team) line.mlAway = o.price;
          }
      const mlPct =
        line.mlHome != null && line.mlAway != null ? impl(line.mlHome) / (impl(line.mlHome) + impl(line.mlAway)) : null;
      for (const m of b.markets ?? []) {
        const outs = m.outcomes ?? [];
        if (m.key === "spreads") {
          const sp = mainSpread(outs, e.home_team, e.away_team, { sport, homePct: mlPct });
          if (sp) {
            line.spreadHome = sp.home;
            line.spreadHomePrice = sp.homePrice;
            line.spreadAwayPrice = sp.awayPrice;
          }
        } else if (m.key === "totals") {
          const t = mainTotal(outs, sport);
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
