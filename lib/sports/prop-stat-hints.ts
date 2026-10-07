// Suggested stat-label strings for the Props page's "make your own pick"
// form, per sport — offered in a <datalist> so typing is guided, not
// required (the user can type anything; see db/schema.ts's userPropPicks
// comment for why this stays a hint list rather than a validated enum).
// These are best guesses at ESPN's actual box-score labels, same
// unverified-until-a-live-sync caveat as the rest of lib/sports/espn.ts —
// check an actual sport_player_game_stats row (or a graded pick) to confirm
// the real strings and adjust this list if they differ.
import type { SportKey } from "./types";

export const PROP_STAT_HINTS: Record<SportKey, string[]> = {
  nba: ["PTS", "REB", "AST", "STL", "BLK", "3PM"],
  wnba: ["PTS", "REB", "AST", "STL", "BLK", "3PM"],
  nhl: ["G", "A", "P", "SOG", "PIM"],
  mlb: ["H", "HR", "RBI", "R", "SO", "BB"],
  ncaaf: ["YDS", "TD", "REC", "CAR"],
  ncaab: ["PTS", "REB", "AST", "STL", "BLK"],
};
