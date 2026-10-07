// Shared, client-safe betting-platform data (no next/headers import here,
// unlike lib/sportsbook-pref.ts — this file gets pulled into client bundles
// by sportsbook-picker.tsx and push-bet-button.tsx). The type/cookie name
// "Sportsbook" predates this file growing to cover prediction markets and
// daily-fantasy pick'em apps too — kept as-is rather than renamed, since
// renaming it would mean touching every file that imports the type for no
// functional gain.
export type Sportsbook =
  | "draftkings"
  | "fanduel"
  | "betmgm"
  | "caesars"
  | "kalshi"
  | "polymarket"
  | "draftkings_predictions"
  | "fanduel_predicts"
  | "robinhood"
  | "forecastex"
  | "underdog";

export type SportsbookCategory = "Sportsbooks" | "Prediction markets" | "Daily fantasy";

export interface SportsbookInfo {
  label: string;
  webUrl: string;
  category: SportsbookCategory;
}

// Plain web URLs rather than app-specific custom URL schemes. These apps
// register as the handler for their own https:// domain on a phone (so
// opening the normal website hands off to the installed app there), and
// there's no publicly documented custom scheme to target directly for a
// third-party deep link the way Spotify's "spotify:" scheme is — guessing
// one would just fail silently instead of degrading to the website.
//
// A couple of researched-but-unconfirmed platforms were deliberately left
// out rather than guessed: ProphetX and Fanatics Markets are both real,
// live prediction-market apps, but neither has a confirmed official web
// domain (their own sites weren't findable — these are mobile-app-first
// products) — add them once a verified URL is in hand instead of risking a
// dead/wrong link. Robinhood's prediction markets live inside the main
// Robinhood app with no separate marketing domain found, so it points at
// the root site rather than a specific predictions path that may move.
// PredictIt was left off entirely — it's politics/economics-only, with no
// NFL or sports contracts, so it has nothing to push an NFL bet slip to.
//
// Polymarket note: as of 2026 it relaunched as a CFTC-regulated exchange
// (via its acquisition of QCX) and is open to US users with KYC, though a
// few states are still contesting that in court — availability may vary.
export const SPORTSBOOKS: Record<Sportsbook, SportsbookInfo> = {
  draftkings: { label: "DraftKings", webUrl: "https://sportsbook.draftkings.com", category: "Sportsbooks" },
  fanduel: { label: "FanDuel", webUrl: "https://sportsbook.fanduel.com", category: "Sportsbooks" },
  betmgm: { label: "BetMGM", webUrl: "https://sports.betmgm.com", category: "Sportsbooks" },
  caesars: { label: "Caesars Sportsbook", webUrl: "https://sportsbook.caesars.com", category: "Sportsbooks" },
  kalshi: { label: "Kalshi", webUrl: "https://kalshi.com", category: "Prediction markets" },
  polymarket: { label: "Polymarket", webUrl: "https://polymarket.com", category: "Prediction markets" },
  draftkings_predictions: {
    label: "DraftKings Predictions",
    webUrl: "https://www.draftkings.com/predictions",
    category: "Prediction markets",
  },
  fanduel_predicts: {
    label: "FanDuel Predicts",
    webUrl: "https://www.fanduel.com/predicts",
    category: "Prediction markets",
  },
  robinhood: { label: "Robinhood Predictions", webUrl: "https://robinhood.com", category: "Prediction markets" },
  forecastex: { label: "ForecastEx", webUrl: "https://forecastex.com", category: "Prediction markets" },
  underdog: { label: "Underdog", webUrl: "https://underdogfantasy.com", category: "Daily fantasy" },
};

export const SPORTSBOOK_KEYS = Object.keys(SPORTSBOOKS) as Sportsbook[];

/**
 * The cookie behind both of these is a comma-separated list of Sportsbook
 * keys (e.g. "draftkings,kalshi") — the user's own saved set of "my
 * platforms" (see app/(app)/sportsbook-picker.tsx), pushed to all at once by
 * PushBetButton. Kept here (rather than only in lib/sportsbook-pref.ts)
 * because client components need to parse/serialize it too without pulling
 * in next/headers.
 */
export function parseSportsbookPrefs(raw: string): Sportsbook[] {
  const seen = new Set<string>();
  const result: Sportsbook[] = [];
  for (const part of raw.split(",")) {
    const key = part.trim();
    if (key && !seen.has(key) && (SPORTSBOOK_KEYS as readonly string[]).includes(key)) {
      seen.add(key);
      result.push(key as Sportsbook);
    }
  }
  return result;
}

export function serializeSportsbookPrefs(books: Sportsbook[]): string {
  return Array.from(new Set(books)).join(",");
}

export const SPORTSBOOK_CATEGORIES: SportsbookCategory[] = [
  "Sportsbooks",
  "Prediction markets",
  "Daily fantasy",
];

/**
 * Each platform's own small site icon (favicon), fetched live from a
 * neutral favicon-lookup service by domain — the same "icon" a browser tab
 * or bookmark list shows for that site, not an app-icon/logo Claude drew or
 * stored. This app never bundles or redraws any of these companies' marks;
 * <PlatformIcon> (app/(app)/platform-icon.tsx) just points an <img> at the
 * real one and falls back to a plain initial if it fails to load.
 */
export function getPlatformIconUrl(book: Sportsbook): string {
  const hostname = new URL(SPORTSBOOKS[book].webUrl).hostname;
  return `https://www.google.com/s2/favicons?sz=64&domain=${hostname}`;
}
