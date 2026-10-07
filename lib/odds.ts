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
export { hasOddsApiKey, oddsApiKeyStatus };

const SPORT = "americanfootball_nfl";

// Keep this list small and yardage/reception-focused — these are the markets
// we can actually project from nflverse's weekly counting stats (see
// lib/props-model.ts). Add more once there's a matching projection for them.
const MARKET_LABELS: Record<string, string> = {
  player_pass_yds: "Pass Yds",
  player_rush_yds: "Rush Yds",
  player_reception_yds: "Rec Yds",
  player_receptions: "Receptions",
};
const MARKETS = Object.keys(MARKET_LABELS);

export interface OddsEvent {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
}

export interface PropOutcome {
  player: string;
  statType: string; // "Pass Yds" | "Rush Yds" | "Rec Yds" | "Receptions"
  line: number;
  side: "Over" | "Under";
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
    title: string;
    markets?: {
      key: string;
      outcomes?: { name: string; price: number; point?: number }[];
    }[];
  }[];
}

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
      const data = await oddsApiGet<RawOddsListResponse[]>(`/sports/${SPORT}/odds`, {
        regions: "us",
        markets: "h2h,spreads,totals",
        oddsFormat: "american",
      });

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
          moneylines.push({
            homeTeam: event.home_team,
            awayTeam: event.away_team,
            book: chosen.title,
            homePriceAmerican: homeMl.price,
            awayPriceAmerican: awayMl.price,
          });
        }

        const spread = chosen.markets?.find((m) => m.key === "spreads");
        const homeSp = spread?.outcomes?.find((o) => o.name === event.home_team);
        const awaySp = spread?.outcomes?.find((o) => o.name === event.away_team);
        if (homeSp?.point != null && awaySp) {
          spreads.push({
            homeTeam: event.home_team,
            awayTeam: event.away_team,
            book: chosen.title,
            spreadHomeLine: homeSp.point,
            homePriceAmerican: homeSp.price,
            awayPriceAmerican: awaySp.price,
          });
        }

        const total = chosen.markets?.find((m) => m.key === "totals");
        const overOutcome = total?.outcomes?.find((o) => o.name === "Over");
        const underOutcome = total?.outcomes?.find((o) => o.name === "Under");
        if (overOutcome?.point != null && underOutcome) {
          totals.push({
            homeTeam: event.home_team,
            awayTeam: event.away_team,
            book: chosen.title,
            totalLine: overOutcome.point,
            overPriceAmerican: overOutcome.price,
            underPriceAmerican: underOutcome.price,
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
      const data = await oddsApiGet<RawOddsEventResponse>(`/sports/${SPORT}/events/${eventId}/odds`, {
        regions: "us",
        markets: MARKETS.join(","),
        oddsFormat: "american",
      });

      const out: PropOutcome[] = [];
      for (const bookmaker of data.bookmakers ?? []) {
        for (const market of bookmaker.markets ?? []) {
          const label = MARKET_LABELS[market.key];
          if (!label) continue;
          for (const outcome of market.outcomes ?? []) {
            if (outcome.name !== "Over" && outcome.name !== "Under") continue;
            if (outcome.point == null || !outcome.description) continue;
            out.push({
              player: outcome.description,
              statType: label,
              line: outcome.point,
              side: outcome.name,
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
