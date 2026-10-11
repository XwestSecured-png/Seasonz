// Per-sport stat extraction — turns one ESPN box-score row's raw
// label->value jsonb (sportPlayerGameStats.stats; see db/schema.ts's
// comment and lib/sports/espn.ts's fetchBoxscorePlayers) into a single
// number for one of the stat types this app actually projects (see
// lib/sports/odds.ts's MARKET_LABELS_BY_SPORT — every statType here must
// match a label used there). Field names/groupings below were read
// directly off real synced rows in this app's own database (not guessed),
// the same discipline this app uses elsewhere for any third-party field
// name, since a wrong guess here would silently produce an empty or wrong
// stat instead of a visible error.
//
// Each extractor also decides whether a row even APPLIES — e.g. an NHL
// goalie's row never produces a skater's "Shots on Goal", and an MLB
// pitching line never produces a batter's "Hits" — rather than a
// stat-generic "first numeric token" guess that could silently read the
// wrong field off the wrong kind of row.
import type { SportKey } from "./types";

/** First numeric token in a raw ESPN stat string ("8-12" shooting lines like "3-15" makes-attempts, plain "27") — null if nothing numeric is there. Same parsing lib/sports/prop-grading.ts already uses for user-entered picks. */
function firstNumber(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const match = raw.match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

// Combined basketball stats that books offer as one line. Not box-score
// columns, so they're added up from PTS / REB / AST.
export const COMBO_STATS: Record<string, string[]> = {
  PRA: ["PTS", "REB", "AST"],
  PR: ["PTS", "REB"],
  RA: ["REB", "AST"],
};

/** A box-score value by key, adding up combo keys (PRA, PR, RA). Null when any part is missing. */
export function comboStat(s: Record<string, string>, key: string): number | null {
  const parts = COMBO_STATS[key.toUpperCase()];
  if (!parts) return firstNumber(s[key]);
  let sum = 0;
  for (const k of parts) {
    const v = firstNumber(s[k]);
    if (v === null) return null;
    sum += v;
  }
  return sum;
}

export interface StatExtractor {
  statType: string;
  extract: (stats: Record<string, string>) => number | null;
}

// NBA/WNBA/NCAAB share the exact same ESPN box-score shape (PTS/REB/AST/
// STL/BLK plain integers, "3PT" as an "M-A" makes-attempts string) — one
// config reused by all three.
const BASKETBALL_STATS: StatExtractor[] = [
  { statType: "Points", extract: (s) => firstNumber(s.PTS) },
  { statType: "Rebounds", extract: (s) => firstNumber(s.REB) },
  { statType: "Assists", extract: (s) => firstNumber(s.AST) },
  { statType: "3-Pointers Made", extract: (s) => firstNumber(s["3PT"]) },
  { statType: "Steals", extract: (s) => firstNumber(s.STL) },
  { statType: "Blocks", extract: (s) => firstNumber(s.BLK) },
  { statType: "Turnovers", extract: (s) => firstNumber(s.TO) },
  { statType: "Pts+Reb+Ast", extract: (s) => comboStat(s, "PRA") },
  { statType: "Pts+Reb", extract: (s) => comboStat(s, "PR") },
  { statType: "Reb+Ast", extract: (s) => comboStat(s, "RA") },
];

// NHL: skater stats (G/A/S) only come from forwards/defenses rows, and
// goalie saves (SV) only from goalie rows — stats.group tags which is
// which (lib/sports/espn.ts carries ESPN's own box-score group name
// through verbatim). "Points" is goals+assists, computed rather than read
// (ESPN's box score doesn't carry a combined point total per game).
const SKATER_GROUPS = new Set(["forwards", "defenses"]);
const NHL_STATS: StatExtractor[] = [
  { statType: "Goals", extract: (s) => (SKATER_GROUPS.has(s.group) ? firstNumber(s.G) : null) },
  { statType: "Assists", extract: (s) => (SKATER_GROUPS.has(s.group) ? firstNumber(s.A) : null) },
  {
    statType: "Points",
    extract: (s) => {
      if (!SKATER_GROUPS.has(s.group)) return null;
      const g = firstNumber(s.G);
      const a = firstNumber(s.A);
      return g === null && a === null ? null : (g ?? 0) + (a ?? 0);
    },
  },
  { statType: "Shots on Goal", extract: (s) => (SKATER_GROUPS.has(s.group) ? firstNumber(s.S) : null) },
  { statType: "Saves", extract: (s) => (s.group === "goalies" ? firstNumber(s.SV) : null) },
];

// MLB: ESPN doesn't tag a "group" field here (unlike NHL/NCAAF), so batting
// vs. pitching rows are told apart by which signature field is present — a
// pitching line always carries "IP" (innings pitched), a batting line
// always carries "AB" (at-bats). Several field names (H, BB, R, HR) are
// reused between the two roles with opposite meaning (hits BY a batter vs.
// hits ALLOWED by a pitcher), which is exactly why that row-type check
// comes first in every extractor below rather than a bare field read.
const MLB_STATS: StatExtractor[] = [
  { statType: "Hits", extract: (s) => ("AB" in s ? firstNumber(s.H) : null) },
  { statType: "Home Runs", extract: (s) => ("AB" in s ? firstNumber(s.HR) : null) },
  { statType: "RBIs", extract: (s) => ("AB" in s ? firstNumber(s.RBI) : null) },
  { statType: "Runs Scored", extract: (s) => ("AB" in s ? firstNumber(s.R) : null) },
  { statType: "Walks", extract: (s) => ("AB" in s ? firstNumber(s.BB) : null) },
  { statType: "Strikeouts (Batter)", extract: (s) => ("AB" in s ? firstNumber(s.K) : null) },
  { statType: "Strikeouts (Pitcher)", extract: (s) => ("IP" in s ? firstNumber(s.K) : null) },
  { statType: "Hits Allowed", extract: (s) => ("IP" in s ? firstNumber(s.H) : null) },
  { statType: "Walks Allowed", extract: (s) => ("IP" in s ? firstNumber(s.BB) : null) },
  { statType: "Earned Runs", extract: (s) => ("IP" in s ? firstNumber(s.ER) : null) },
];

// NCAAF: same passing/rushing/receiving group shape NFL's own nflverse-fed
// model already uses the labels for — stats.group disambiguates the
// repeated "YDS" key across the three groups.
const NCAAF_STATS: StatExtractor[] = [
  { statType: "Pass Yds", extract: (s) => (s.group === "passing" ? firstNumber(s.YDS) : null) },
  { statType: "Rush Yds", extract: (s) => (s.group === "rushing" ? firstNumber(s.YDS) : null) },
  { statType: "Rec Yds", extract: (s) => (s.group === "receiving" ? firstNumber(s.YDS) : null) },
  { statType: "Receptions", extract: (s) => (s.group === "receiving" ? firstNumber(s.REC) : null) },
];

export const STAT_EXTRACTORS: Record<SportKey, StatExtractor[]> = {
  nba: BASKETBALL_STATS,
  wnba: BASKETBALL_STATS,
  ncaab: BASKETBALL_STATS,
  nhl: NHL_STATS,
  mlb: MLB_STATS,
  ncaaf: NCAAF_STATS,
};

/** This sport's extractor for one statType, or undefined if that stat isn't configured for this sport. */
export function getExtractor(sport: SportKey, statType: string): StatExtractor | undefined {
  return STAT_EXTRACTORS[sport].find((e) => e.statType === statType);
}
