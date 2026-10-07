// SportsGameOdds (https://sportsgameodds.com) — a second, optional odds
// provider. It's used only as a FALLBACK: when lib/odds.ts's primary
// provider (The Odds API) isn't configured, or fails (most commonly because
// its monthly pull quota ran out), the functions in lib/odds.ts reach for
// this instead. Its free "Amateur" tier covers NFL moneylines and the same
// four yardage/reception player-prop markets we already project from
// nflverse stats (see lib/props-model.ts), so results map directly onto the
// existing PropOutcome / MoneylineOdds shapes — nothing downstream needs to
// know which provider actually served the data.
//
// Unlike The Odds API's two-step flow (list events, then fetch props per
// event), SportsGameOdds returns every event's full odds — moneylines and
// player props together — from one /events call. So this file exposes a
// single fetch (fetchSgoEvents, memoized for a few minutes) plus two pure
// extractors; lib/odds.ts's fallback branches call fetchSgoEvents() once per
// sync run and slice what each of its three functions needs out of the same
// result, instead of spending the free tier's small monthly quota on
// multiple calls.
//
// Field names below (byBookmaker.<book>.{odds,overUnder,available}, the
// oddID segment layout, the exact statID strings, and the players dict
// shape) were verified directly against https://sportsgameodds.com/docs
// rather than guessed — the same discipline used elsewhere in this app for
// nflverse's CSV columns, to avoid a silently-empty feature from a wrong
// field name.

import type { OddsEvent, MoneylineOdds, PropOutcome, SpreadOdds, TotalOdds } from "./odds";

const SGO_BASE = "https://api.sportsgameodds.com/v2";

// The only player-prop markets we can project — see lib/props-model.ts.
// These map 1:1 onto the MARKET_LABELS values in lib/odds.ts.
const SGO_MARKET_LABELS: Record<string, string> = {
  passing_yards: "Pass Yds",
  rushing_yards: "Rush Yds",
  receiving_yards: "Rec Yds",
  receiving_receptions: "Receptions",
};

const BOOK_DISPLAY_NAMES: Record<string, string> = {
  draftkings: "DraftKings",
  fanduel: "FanDuel",
  betmgm: "BetMGM",
  caesars: "Caesars",
  pointsbetus: "PointsBet",
  pointsbet: "PointsBet",
  bet365: "Bet365",
  espnbet: "ESPN BET",
  wynnbet: "WynnBET",
  betrivers: "BetRivers",
  unibet: "Unibet",
};

function bookDisplayName(bookmakerId: string): string {
  return (
    BOOK_DISPLAY_NAMES[bookmakerId] ??
    bookmakerId.charAt(0).toUpperCase() + bookmakerId.slice(1)
  );
}

function getSgoKey(): string | undefined {
  return process.env.SPORTSGAMEODDS_API_KEY?.trim() || undefined;
}

/** Whether a SportsGameOdds API key is configured at all. */
export function hasSportsGameOddsKey(): boolean {
  return !!getSgoKey();
}

interface SgoByBookmaker {
  odds?: string;
  overUnder?: string; // the O/U line, for betTypeID "ou" entries
  spread?: string; // the spread/handicap number, for betTypeID "sp" entries
  available?: boolean;
}

interface SgoOddsEntry {
  oddID: string;
  statID: string;
  statEntityID: string;
  periodID: string;
  betTypeID: string; // "ml" | "sp" | "ou" (verified against sportsgameodds.com/docs/data-types/odds)
  sideID: string; // "home" | "away" | "over" | "under" | ...
  bookOdds?: string;
  bookOverUnder?: string;
  bookSpread?: string;
  byBookmaker?: Record<string, SgoByBookmaker>;
}

interface SgoPlayer {
  playerID: string;
  teamID?: string;
  firstName?: string;
  lastName?: string;
  name: string;
}

interface SgoTeam {
  teamID: string;
  names?: { long?: string; medium?: string; short?: string };
}

export interface SgoEvent {
  eventID: string;
  teams?: { home?: SgoTeam; away?: SgoTeam };
  players?: Record<string, SgoPlayer>;
  odds?: Record<string, SgoOddsEntry>;
}

interface SgoEventsResponse {
  success: boolean;
  data?: SgoEvent[];
  nextCursor?: string | null;
}

// A week's worth of NFL events easily fits in one page, and the free tier's
// quota is precious, so this fetches a single page (never chases
// nextCursor) and memoizes the result briefly so the "gameOdds" and "props"
// sync stages — which both want the full event list — share one call
// instead of two.
let cachedEvents: { data: SgoEvent[]; at: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

let sgoFallbackUsed = false;
/** Call once before a sync run's odds stages, so didUseSportsGameOddsFallback() reflects only this run rather than a previous one. */
export function resetOddsProviderTracking(): void {
  sgoFallbackUsed = false;
}
/** Whether the SportsGameOdds fallback actually served data since the last reset — surfaced in sync logs so a fallback happening is visible, not silent. */
export function didUseSportsGameOddsFallback(): boolean {
  return sgoFallbackUsed;
}

/** Every NFL event SportsGameOdds currently has odds for (moneylines + the four player-prop markets we use), memoized briefly. Throws if no key is configured or the request fails — callers (lib/odds.ts) treat that as "fallback unavailable" and handle it gracefully. */
export async function fetchSgoEvents(): Promise<SgoEvent[]> {
  if (cachedEvents && Date.now() - cachedEvents.at < CACHE_TTL_MS) {
    sgoFallbackUsed = true;
    return cachedEvents.data;
  }
  const key = getSgoKey();
  if (!key) {
    throw new Error("No SportsGameOdds API key is set (SPORTSGAMEODDS_API_KEY)");
  }

  const url = new URL(`${SGO_BASE}/events`);
  url.searchParams.set("leagueID", "NFL");
  url.searchParams.set("oddsAvailable", "true");
  url.searchParams.set("limit", "100");

  const res = await fetch(url.toString(), { headers: { "X-Api-Key": key } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `SportsGameOdds /events failed: ${res.status} ${res.statusText} ${body.slice(0, 200)}`
    );
  }
  const json: SgoEventsResponse = await res.json();
  if (!json.success) {
    throw new Error("SportsGameOdds /events responded with success: false");
  }

  const data = json.data ?? [];
  cachedEvents = { data, at: Date.now() };
  sgoFallbackUsed = true;
  return data;
}

/** Maps a SportsGameOdds event into the same shape fetchUpcomingEvents() (lib/odds.ts) returns, so downstream code (team matching in lib/sync.ts) never needs to know which provider supplied it. commence_time is left blank — nothing reads it. */
export function sgoEventToOddsEvent(e: SgoEvent): OddsEvent {
  return {
    id: e.eventID,
    commence_time: "",
    home_team: e.teams?.home?.names?.long ?? e.teams?.home?.teamID ?? "",
    away_team: e.teams?.away?.names?.long ?? e.teams?.away?.teamID ?? "",
  };
}

function bestBookEntry(
  entry: SgoOddsEntry
): { book: string; price: number } | null {
  const books = entry.byBookmaker ?? {};

  // Prefer DraftKings when it has a price posted, so the stored line stays
  // consistent with the Odds API path's own book preference. Otherwise take
  // the first book with an available price.
  let bookId: string | undefined;
  let chosen: SgoByBookmaker | undefined;
  if (books["draftkings"]?.available && books["draftkings"]?.odds) {
    bookId = "draftkings";
    chosen = books["draftkings"];
  } else {
    const found = Object.entries(books).find(([, b]) => b.available && b.odds);
    if (found) {
      bookId = found[0];
      chosen = found[1];
    }
  }

  if (bookId && chosen?.odds) {
    const price = Number(chosen.odds);
    if (Number.isFinite(price)) return { book: bookDisplayName(bookId), price };
  }

  // No per-book breakdown available (can happen on restricted responses) —
  // fall back to the entry's own consensus price.
  if (entry.bookOdds) {
    const price = Number(entry.bookOdds);
    if (Number.isFinite(price)) return { book: "SportsGameOdds", price };
  }

  return null;
}

/** Same book-preference logic as bestBookEntry, but also returns the entry's line value (spread number or O/U total) from whichever book was chosen — needed since the price and the line must come from the SAME book's quote. */
function bestBookEntryWithLine(
  entry: SgoOddsEntry,
  lineField: "overUnder" | "spread"
): { book: string; price: number; line: number } | null {
  const books = entry.byBookmaker ?? {};

  let bookId: string | undefined;
  let chosen: SgoByBookmaker | undefined;
  if (books["draftkings"]?.available && books["draftkings"]?.odds && books["draftkings"]?.[lineField]) {
    bookId = "draftkings";
    chosen = books["draftkings"];
  } else {
    const found = Object.entries(books).find(([, b]) => b.available && b.odds && b[lineField]);
    if (found) {
      bookId = found[0];
      chosen = found[1];
    }
  }

  if (bookId && chosen?.odds && chosen[lineField]) {
    const price = Number(chosen.odds);
    const line = Number(chosen[lineField]);
    if (Number.isFinite(price) && Number.isFinite(line)) return { book: bookDisplayName(bookId), price, line };
  }

  const fallbackLine = lineField === "overUnder" ? entry.bookOverUnder : entry.bookSpread;
  if (entry.bookOdds && fallbackLine) {
    const price = Number(entry.bookOdds);
    const line = Number(fallbackLine);
    if (Number.isFinite(price) && Number.isFinite(line)) return { book: "SportsGameOdds", price, line };
  }

  return null;
}

/** Point-spread (ATS) odds for every event that has one posted, in the same shape fetchSpreadOdds() (lib/odds.ts) returns. betTypeID "sp" / oddIDs "points-home-game-sp-home" and "points-away-game-sp-away" verified against sportsgameodds.com/docs/data-types/odds. */
export function extractSpreads(events: SgoEvent[]): SpreadOdds[] {
  const out: SpreadOdds[] = [];
  for (const e of events) {
    const homeOdd = e.odds?.["points-home-game-sp-home"];
    const awayOdd = e.odds?.["points-away-game-sp-away"];
    if (!homeOdd || !awayOdd) continue;
    const homeBest = bestBookEntryWithLine(homeOdd, "spread");
    const awayBest = bestBookEntryWithLine(awayOdd, "spread");
    if (!homeBest || !awayBest) continue;
    const homeTeam = e.teams?.home?.names?.long;
    const awayTeam = e.teams?.away?.names?.long;
    if (!homeTeam || !awayTeam) continue;

    out.push({
      homeTeam,
      awayTeam,
      book: homeBest.book,
      spreadHomeLine: homeBest.line,
      homePriceAmerican: homeBest.price,
      awayPriceAmerican: awayBest.price,
    });
  }
  return out;
}

/** Game-total (O/U) odds for every event that has one posted, in the same shape fetchTotalOdds() (lib/odds.ts) returns. Uses the statEntityID "all" game-total oddIDs, not the per-player O/U entries extractPlayerProps() reads. */
export function extractTotals(events: SgoEvent[]): TotalOdds[] {
  const out: TotalOdds[] = [];
  for (const e of events) {
    const overOdd = e.odds?.["points-all-game-ou-over"];
    const underOdd = e.odds?.["points-all-game-ou-under"];
    if (!overOdd || !underOdd) continue;
    const overBest = bestBookEntryWithLine(overOdd, "overUnder");
    const underBest = bestBookEntryWithLine(underOdd, "overUnder");
    if (!overBest || !underBest) continue;
    const homeTeam = e.teams?.home?.names?.long;
    const awayTeam = e.teams?.away?.names?.long;
    if (!homeTeam || !awayTeam) continue;

    out.push({
      homeTeam,
      awayTeam,
      book: overBest.book,
      totalLine: overBest.line,
      overPriceAmerican: overBest.price,
      underPriceAmerican: underBest.price,
    });
  }
  return out;
}

/** Moneyline odds for every event that has one posted, in the same shape fetchMoneylineOdds() (lib/odds.ts) returns. */
export function extractMoneylines(events: SgoEvent[]): MoneylineOdds[] {
  const out: MoneylineOdds[] = [];
  for (const e of events) {
    const homeOdd = e.odds?.["points-home-game-ml-home"];
    const awayOdd = e.odds?.["points-away-game-ml-away"];
    if (!homeOdd || !awayOdd) continue;
    const homeBest = bestBookEntry(homeOdd);
    const awayBest = bestBookEntry(awayOdd);
    if (!homeBest || !awayBest) continue;
    const homeTeam = e.teams?.home?.names?.long;
    const awayTeam = e.teams?.away?.names?.long;
    if (!homeTeam || !awayTeam) continue;

    out.push({
      homeTeam,
      awayTeam,
      book: homeBest.book,
      homePriceAmerican: homeBest.price,
      awayPriceAmerican: awayBest.price,
    });
  }
  return out;
}

/** Player prop outcomes (Over + Under, every book with a line posted) across the given events, restricted to the four markets we can project — in the same shape fetchEventPlayerProps() (lib/odds.ts) returns. */
export function extractPlayerProps(events: SgoEvent[]): PropOutcome[] {
  const out: PropOutcome[] = [];
  for (const e of events) {
    const players = e.players ?? {};
    for (const entry of Object.values(e.odds ?? {})) {
      if (entry.betTypeID !== "ou") continue;
      const label = SGO_MARKET_LABELS[entry.statID];
      if (!label) continue;
      const player = players[entry.statEntityID];
      if (!player?.name) continue;
      const side = entry.sideID === "over" ? "Over" : entry.sideID === "under" ? "Under" : null;
      if (!side) continue;

      const books = entry.byBookmaker ?? {};
      let bookEntries: [string, { odds: string; overUnder: string }][] = Object.entries(books)
        .filter(
          (kv): kv is [string, SgoByBookmaker & { odds: string; overUnder: string }] =>
            !!kv[1].available && !!kv[1].odds && !!kv[1].overUnder
        )
        .map(([id, b]) => [id, { odds: b.odds, overUnder: b.overUnder }]);
      if (bookEntries.length === 0 && entry.bookOdds && entry.bookOverUnder) {
        bookEntries = [["sportsgameodds", { odds: entry.bookOdds, overUnder: entry.bookOverUnder }]];
      }

      for (const [bookId, b] of bookEntries) {
        const price = Number(b.odds);
        const line = Number(b.overUnder);
        if (!Number.isFinite(price) || !Number.isFinite(line)) continue;
        out.push({
          player: player.name,
          statType: label,
          line,
          side,
          book: bookId === "sportsgameodds" ? "SportsGameOdds" : bookDisplayName(bookId),
          priceAmerican: price,
        });
      }
    }
  }
  return out;
}
