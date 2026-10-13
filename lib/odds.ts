// The Odds API (https://the-odds-api.com) — player prop lines. Unlike
// game-level odds, player props are only available per-event (not in the
// bulk /odds listing), so this is a two-step fetch: list this week's events,
// then pull props for each one.
//
// Every exported fetch function below falls back to SportsGameOdds (see
// lib/sportsgameodds.ts) when this provider isn't configured, or when a
// call fails — most commonly because the monthly pull quota ran out. The
// fallback is purely additive: if SPORTSGAMEODDS_API_KEY isn't set either,
// behavior is unchanged from before this provider existed (the original
// error is thrown, and sync.ts's existing stage-skip logic handles it).
import { consensusHome } from "./sports/game-model";
import { mainSpread, mainTotal } from "./sports/game-odds";
import {
  hasSportsGameOddsKey,
  fetchSgoEvents,
  sgoEventToOddsEvent,
  extractMoneylines,
  extractPlayerProps,
  extractSpreads,
  extractTotals,
} from "./sportsgameodds";
// The actual HTTP + multi-key-rotation plumbing now lives in
// lib/odds-provider.ts, shared with lib/sports/odds.ts (every other sport's
// player props). Re-exported below so nothing that already imports
// hasOddsApiKey/oddsApiKeyStatus from "./odds" needs to change.
import { oddsApiGet, hasOddsApiKey, oddsApiKeyStatus } from "./odds-provider";
import { FOOTBALL_ALL_MARKETS, FOOTBALL_CORE_MARKETS, readPropOutcome } from "./football-markets";
export { hasOddsApiKey, oddsApiKeyStatus };

const SPORT = "americanfootball_nfl";

// Every football prop market the feed offers (lib/football-markets.ts). The
// model projects the four CORE yardage/reception markets; the rest are
// stored so the parlay builder can offer every prop a book posts.
const MARKET_LABELS: Record<string, string> = FOOTBALL_ALL_MARKETS;
const MARKETS = Object.keys(MARKET_LABELS);
const CORE_MARKETS = Object.keys(FOOTBALL_CORE_MARKETS);

export interface OddsEvent {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
}

export interface PropOutcome {
  player: string;
  statType: string; // see lib/football-markets.ts
  line: number;
  side: string; // "Over" | "Under" | "Yes" | "No"
  book: string;
  priceAmerican: number;
}

/** Whether EITHER odds provider is configured — The Odds API or its SportsGameOdds fallback. Used to gate the odds-dependent sync stages so a SportsGameOdds-only setup still runs them. */
export function hasAnyOddsProvider(): boolean {
  return hasOddsApiKey() || hasSportsGameOddsKey();
}

/** Every NFL event the Odds API currently has on its board (includes games with no props posted yet). Falls back to SportsGameOdds if The Odds API isn't configured or fails. */
export async function fetchUpcomingEvents(): Promise<OddsEvent[]> {
  if (hasOddsApiKey()) {
    try {
      return await oddsApiGet<OddsEvent[]>(`/sports/${SPORT}/events`, {});
    } catch (err) {
      if (!hasSportsGameOddsKey()) throw err;
    }
  } else if (!hasSportsGameOddsKey()) {
    throw new Error("No odds provider is configured (ODDS_API_KEYS_FREE/PROPLINE_API_KEYS_FREE/PROPLINE_API_KEY or SPORTSGAMEODDS_API_KEY)");
  }

  const events = await fetchSgoEvents();
  return events.map(sgoEventToOddsEvent);
}

export interface MoneylineOdds {
  homeTeam: string; // full franchise name, as the book gives it (e.g. "Kansas City Chiefs")
  awayTeam: string;
  book: string;
  homePriceAmerican: number;
  awayPriceAmerican: number;
  /** Market consensus home chance across every book (no-vig, sharp books double); see lib/sports/game-model.ts. */
  consensusHomePct?: number | null;
}

export interface SpreadOdds {
  homeTeam: string;
  awayTeam: string;
  book: string;
  spreadHomeLine: number; // home-perspective; negative = home favored
  homePriceAmerican: number;
  awayPriceAmerican: number;
}

export interface TotalOdds {
  homeTeam: string;
  awayTeam: string;
  book: string;
  totalLine: number;
  overPriceAmerican: number;
  underPriceAmerican: number;
}

export interface GameOdds {
  moneylines: MoneylineOdds[];
  spreads: SpreadOdds[];
  totals: TotalOdds[];
}

interface RawOddsListResponse {
  home_team: string;
  away_team: string;
  bookmakers?: {
    key?: string;
    title: string;
    markets?: {
      key: string;
      outcomes?: { name: string; price: number; point?: number }[];
    }[];
  }[];
}

// Main US books plus the sharp, low-margin ones (Pinnacle, BetOnline,
// LowVig) for the market consensus. Ten books cost the same as one region.
const NFL_GAME_BOOKS = "draftkings,fanduel,betmgm,williamhill_us,espnbet,betrivers,pinnacle,betonlineag,lowvig,bovada";

// Preferred book when more than one has a line posted — keeps the stored
// line consistent week to week rather than picking whichever book happened
// to respond first.
const PREFERRED_BOOK = "DraftKings";

/**
 * Moneyline, spread, and game-total odds for every upcoming NFL game — one
 * bulk call to The Odds API (all three markets come back per-event in the
 * same response, so this is no more expensive than the old moneyline-only
 * call), falling back to SportsGameOdds (one shared, memoized event fetch)
 * if The Odds API isn't configured or fails.
 */
export async function fetchGameOdds(): Promise<GameOdds> {
  if (hasOddsApiKey()) {
    try {
      const get = (extra: Record<string, string>) =>
        oddsApiGet<RawOddsListResponse[]>(`/sports/${SPORT}/odds`, {
          regions: "us",
          markets: "h2h,spreads,totals",
          oddsFormat: "american",
          ...extra,
        });
      // A provider that rejects the book list falls back to every US book.
      const data = await get({ bookmakers: NFL_GAME_BOOKS }).catch(() => get({}));

      const moneylines: MoneylineOdds[] = [];
      const spreads: SpreadOdds[] = [];
      const totals: TotalOdds[] = [];

      for (const event of data) {
        const books = event.bookmakers ?? [];
        const chosen = books.find((b) => b.title === PREFERRED_BOOK) ?? books[0];
        if (!chosen) continue;

        const h2h = chosen.markets?.find((m) => m.key === "h2h");
        const homeMl = h2h?.outcomes?.find((o) => o.name === event.home_team);
        const awayMl = h2h?.outcomes?.find((o) => o.name === event.away_team);
        if (homeMl && awayMl) {
          const perBook: Record<string, { mlHome: number | null; mlAway: number | null }> = {};
          for (const b of books) {
            const m = b.markets?.find((x) => x.key === "h2h");
            const h = m?.outcomes?.find((o) => o.name === event.home_team)?.price ?? null;
            const a = m?.outcomes?.find((o) => o.name === event.away_team)?.price ?? null;
            perBook[b.key ?? b.title.toLowerCase()] = { mlHome: h, mlAway: a };
          }
          moneylines.push({
            homeTeam: event.home_team,
            awayTeam: event.away_team,
            book: chosen.title,
            homePriceAmerican: homeMl.price,
            awayPriceAmerican: awayMl.price,
            consensusHomePct: consensusHome(perBook)?.pct ?? null,
          });
        }

        // Alternate lines can share the market with the main one; take the
        // pair priced closest to even (lib/sports/game-odds.ts).
        const spread = chosen.markets?.find((m) => m.key === "spreads");
        const sp = mainSpread(spread?.outcomes ?? [], event.home_team, event.away_team);
        if (sp) {
          spreads.push({
            homeTeam: event.home_team,
            awayTeam: event.away_team,
            book: chosen.title,
            spreadHomeLine: sp.home,
            homePriceAmerican: sp.homePrice,
            awayPriceAmerican: sp.awayPrice,
          });
        }

        const total = chosen.markets?.find((m) => m.key === "totals");
        const tl = mainTotal(total?.outcomes ?? []);
        if (tl) {
          totals.push({
            homeTeam: event.home_team,
            awayTeam: event.away_team,
            book: chosen.title,
            totalLine: tl.line,
            overPriceAmerican: tl.overPrice,
            underPriceAmerican: tl.underPrice,
          });
        }
      }
      return { moneylines, spreads, totals };
    } catch (err) {
      if (!hasSportsGameOddsKey()) throw err;
    }
  } else if (!hasSportsGameOddsKey()) {
    throw new Error("No odds provider is configured (ODDS_API_KEYS_FREE/PROPLINE_API_KEYS_FREE/PROPLINE_API_KEY or SPORTSGAMEODDS_API_KEY)");
  }

  const events = await fetchSgoEvents();
  return {
    moneylines: extractMoneylines(events),
    spreads: extractSpreads(events),
    totals: extractTotals(events),
  };
}

/** @deprecated use fetchGameOdds() — kept only in case something still imports the old moneyline-only call. */
export async function fetchMoneylineOdds(): Promise<MoneylineOdds[]> {
  return (await fetchGameOdds()).moneylines;
}

interface RawOddsEventResponse {
  bookmakers?: {
    title: string;
    markets?: {
      key: string;
      outcomes?: {
        name: string; // "Over" | "Under"
        description?: string; // player name, for player-prop markets
        price: number;
        point?: number;
      }[];
    }[];
  }[];
}

/**
 * Player prop outcomes (Over + Under, every book that has a line posted)
 * for one event. `eventId` is whatever fetchUpcomingEvents() returned for
 * this event, from either provider — if it came from the SportsGameOdds
 * fallback, this looks it up in that same (memoized) event list rather than
 * re-querying The Odds API with an id it wouldn't recognize.
 */
export async function fetchEventPlayerProps(eventId: string): Promise<PropOutcome[]> {
  if (hasOddsApiKey()) {
    try {
      const get = (m: string[]) =>
        oddsApiGet<RawOddsEventResponse>(`/sports/${SPORT}/events/${eventId}/odds`, {
          regions: "us",
          markets: m.join(","),
          oddsFormat: "american",
        });
      let data: RawOddsEventResponse;
      try {
        data = await get(MARKETS);
      } catch (e) {
        if (e instanceof Error && /422|404/.test(e.message) && !/INVALID_MARKET|market/i.test(e.message)) throw e;
        // A provider that rejects one of the extra markets still gets the core ones.
        data = await get(CORE_MARKETS);
      }

      const out: PropOutcome[] = [];
      for (const bookmaker of data.bookmakers ?? []) {
        for (const market of bookmaker.markets ?? []) {
          const label = MARKET_LABELS[market.key];
          if (!label) continue;
          for (const outcome of market.outcomes ?? []) {
            const read = readPropOutcome(outcome);
            if (!read) continue;
            out.push({
              player: outcome.description!,
              statType: label,
              line: read.line,
              side: read.side,
              book: bookmaker.title,
              priceAmerican: outcome.price,
            });
          }
        }
      }
      return out;
    } catch (err) {
      // A given event may simply not have props posted yet (too far out) —
      // that's routine, not a failure worth aborting the whole sync for,
      // and not something the SportsGameOdds fallback below would fix.
      if (err instanceof Error && /422|404/.test(err.message)) return [];
      if (!hasSportsGameOddsKey()) throw err;
    }
  } else if (!hasSportsGameOddsKey()) {
    return [];
  }

  const events = await fetchSgoEvents();
  const event = events.find((e) => e.eventID === eventId);
  if (!event) return [];
  return extractPlayerProps([event]);
}
