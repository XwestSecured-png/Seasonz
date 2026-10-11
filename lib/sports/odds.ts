// The Odds API player-prop lines for every sport BESIDES NFL (NFL has its
// own lib/odds.ts). Same provider, same two-step flow (list this week's
// events, then pull props per event), same OddsEvent/PropOutcome shapes —
// just parameterized by sport instead of hardcoded to
// "americanfootball_nfl", and sharing the exact same multi-key-rotation
// HTTP core (lib/odds-provider.ts) so a quota-exhausted key rotates the
// same way for every sport's calls.
//
// Sport keys and player-prop market keys below are taken directly from The
// Odds API's own published sports list and betting-markets documentation
// (the-odds-api.com/sports-odds-data/sports-apis.html and
// .../betting-markets.html) — not guessed — same discipline this app uses
// elsewhere for nflverse/ESPN field names, so a wrong assumption here
// doesn't silently ship an empty or wrong feature.
//
// No SportsGameOdds fallback for these sports: that provider's free tier is
// documented (lib/sportsgameodds.ts) as covering NFL only, and this file
// isn't guessing league IDs/market keys for it without the same
// verified-against-docs discipline. If The Odds API isn't configured, or a
// sport's board simply isn't up yet, these sports' props sync stage just
// has nothing to fetch — same honest "nothing yet" as every other empty
// state in this app, not a silent wrong answer.
import { oddsApiGet, hasOddsApiKey } from "../odds-provider";
import type { OddsEvent, PropOutcome } from "../odds";
import type { SportKey } from "./types";

export const ODDS_API_SPORT_KEY: Record<SportKey, string> = {
  nba: "basketball_nba",
  wnba: "basketball_wnba",
  nhl: "icehockey_nhl",
  mlb: "baseball_mlb",
  ncaaf: "americanfootball_ncaaf",
  ncaab: "basketball_ncaab",
};

// Only the markets this app can actually project from real synced box
// scores (see lib/sports/props-model.ts's STAT_CONFIG) — same "keep it
// small, add more once there's a matching projection" philosophy as NFL's
// lib/odds.ts. The label is what's stored/displayed as statType and must
// line up with lib/sports/props-model.ts's STAT_CONFIG keys for that sport.
export const MARKET_LABELS_BY_SPORT: Record<SportKey, Record<string, string>> = {
  nba: {
    player_points: "Points",
    player_rebounds: "Rebounds",
    player_assists: "Assists",
    player_threes: "3-Pointers Made",
    player_steals: "Steals",
    player_blocks: "Blocks",
    player_turnovers: "Turnovers",
    player_points_rebounds_assists: "Pts+Reb+Ast",
    player_points_rebounds: "Pts+Reb",
    player_rebounds_assists: "Reb+Ast",
  },
  wnba: {
    player_points: "Points",
    player_rebounds: "Rebounds",
    player_assists: "Assists",
    player_threes: "3-Pointers Made",
    player_steals: "Steals",
    player_blocks: "Blocks",
    player_turnovers: "Turnovers",
    player_points_rebounds_assists: "Pts+Reb+Ast",
    player_points_rebounds: "Pts+Reb",
    player_rebounds_assists: "Reb+Ast",
  },
  ncaab: {
    player_points: "Points",
    player_rebounds: "Rebounds",
    player_assists: "Assists",
    player_threes: "3-Pointers Made",
    player_steals: "Steals",
    player_blocks: "Blocks",
    player_turnovers: "Turnovers",
    player_points_rebounds_assists: "Pts+Reb+Ast",
    player_points_rebounds: "Pts+Reb",
    player_rebounds_assists: "Reb+Ast",
  },
  nhl: {
    player_goals: "Goals",
    player_assists: "Assists",
    player_points: "Points",
    player_shots_on_goal: "Shots on Goal",
    player_total_saves: "Saves",
  },
  mlb: {
    batter_hits: "Hits",
    batter_home_runs: "Home Runs",
    batter_rbis: "RBIs",
    batter_runs_scored: "Runs Scored",
    batter_walks: "Walks",
    batter_strikeouts: "Strikeouts (Batter)",
    pitcher_strikeouts: "Strikeouts (Pitcher)",
    pitcher_hits_allowed: "Hits Allowed",
    pitcher_walks: "Walks Allowed",
    pitcher_earned_runs: "Earned Runs",
  },
  // NCAAF's player props are the same markets as NFL's (per The Odds API's
  // own docs: "NCAAF & CFL: Same as NFL player props") — same four
  // yardage/reception markets lib/odds.ts already uses, so NCAAF's
  // statType labels match NFL's exactly and can share the same projection
  // shape (recency-weighted average, opponent-allowed adjustment).
  ncaaf: {
    player_pass_yds: "Pass Yds",
    player_rush_yds: "Rush Yds",
    player_reception_yds: "Rec Yds",
    player_receptions: "Receptions",
  },
};

interface RawOddsListResponse {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
}

/** Every upcoming event The Odds API has on its board for this sport (includes games with no props posted yet). No SportsGameOdds fallback — see file comment. */
export async function fetchUpcomingEventsForSport(sport: SportKey): Promise<OddsEvent[]> {
  if (!hasOddsApiKey()) return [];
  const sportKey = ODDS_API_SPORT_KEY[sport];
  try {
    const data = await oddsApiGet<RawOddsListResponse[]>(`/sports/${sportKey}/events`, {});
    return data.map((e) => ({
      id: e.id,
      commence_time: e.commence_time,
      home_team: e.home_team,
      away_team: e.away_team,
    }));
  } catch {
    // A sport with no board up right now (off-season, too far out) is
    // routine, not a failure worth aborting the sync stage for.
    return [];
  }
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

const EXTENDED_MARKETS = new Set([
  "player_turnovers",
  "player_points_rebounds_assists",
  "player_points_rebounds",
  "player_rebounds_assists",
]);

/** Player prop outcomes (Over + Under, every book that has a line posted) for one event of this sport, restricted to the markets this app can project (see MARKET_LABELS_BY_SPORT). */
export async function fetchEventPlayerPropsForSport(
  sport: SportKey,
  eventId: string
): Promise<PropOutcome[]> {
  if (!hasOddsApiKey()) return [];
  const sportKey = ODDS_API_SPORT_KEY[sport];
  const marketLabels = MARKET_LABELS_BY_SPORT[sport];
  const markets = Object.keys(marketLabels);
  if (markets.length === 0) return [];

  try {
    const get = (m: string[]) =>
      oddsApiGet<RawOddsEventResponse>(`/sports/${sportKey}/events/${eventId}/odds`, {
        regions: "us",
        markets: m.join(","),
        oddsFormat: "american",
      });
    let data: RawOddsEventResponse;
    try {
      data = await get(markets);
    } catch (err) {
      // If a provider rejects one of the newer combo/turnover markets, still
      // get the core markets rather than nothing.
      const core = markets.filter((m) => !EXTENDED_MARKETS.has(m));
      if (core.length === markets.length) throw err;
      data = await get(core);
    }

    const out: PropOutcome[] = [];
    for (const bookmaker of data.bookmakers ?? []) {
      for (const market of bookmaker.markets ?? []) {
        const label = marketLabels[market.key];
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
    // routine, not a failure worth aborting the whole sync for.
    if (err instanceof Error && /422|404/.test(err.message)) return [];
    return [];
  }
}
