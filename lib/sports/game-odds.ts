// Game lines (moneyline, spread, total) from FanDuel and BetMGM, through
// the same rotating odds-key pool as everything else (lib/odds-provider.ts).
// One request per sport covers the whole board.
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
  books: { fanduel?: BookLine; betmgm?: BookLine };
}

interface Raw {
  home_team: string;
  away_team: string;
  commence_time: string;
  bookmakers?: {
    key: string;
    markets?: { key: string; outcomes?: { name: string; price: number; point?: number }[] }[];
  }[];
}

export async function fetchGameOddsForSport(sport: SportKey): Promise<BoardGame[]> {
  if (!hasOddsApiKey()) return [];
  let data: Raw[];
  try {
    data = await oddsApiGet<Raw[]>(`/sports/${ODDS_API_SPORT_KEY[sport]}/odds`, {
      regions: "us",
      markets: "h2h,spreads,totals",
      bookmakers: "fanduel,betmgm",
      oddsFormat: "american",
    });
  } catch {
    return [];
  }
  return data.map((e) => {
    const books: BoardGame["books"] = {};
    for (const b of e.bookmakers ?? []) {
      if (b.key !== "fanduel" && b.key !== "betmgm") continue;
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
        for (const o of m.outcomes ?? []) {
          const isHome = o.name === e.home_team;
          if (m.key === "h2h") {
            if (isHome) line.mlHome = o.price;
            else if (o.name === e.away_team) line.mlAway = o.price;
          } else if (m.key === "spreads") {
            if (isHome) {
              line.spreadHome = o.point ?? null;
              line.spreadHomePrice = o.price;
            } else if (o.name === e.away_team) line.spreadAwayPrice = o.price;
          } else if (m.key === "totals") {
            if (o.name === "Over") {
              line.total = o.point ?? null;
              line.overPrice = o.price;
            } else if (o.name === "Under") line.underPrice = o.price;
          }
        }
      }
      books[b.key] = line;
    }
    return { homeTeam: e.home_team, awayTeam: e.away_team, commenceTime: e.commence_time, books };
  });
}
