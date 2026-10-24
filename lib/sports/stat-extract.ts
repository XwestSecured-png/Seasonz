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

/** Every combined key: the basketball sums plus college football's rushing + receiving yards. */
export const COMBO_KEYS = new Set([...Object.keys(COMBO_STATS), "RRY"]);

/** Rushing + receiving yards from a college row's stat groups; null when neither was recorded. */
function rushRecYards(s: Record<string, unknown>): number | null {
  const r = statGroup(s, "rushing");
  const c = statGroup(s, "receiving");
  const rv = r ? firstNumber(r.YDS) : null;
  const cv = c ? firstNumber(c.YDS) : null;
  return rv === null && cv === null ? null : (rv ?? 0) + (cv ?? 0);
}

/** A box-score value by key, adding up combo keys (PRA, PR, RA, RRY). Null when any part is missing. */
export function comboStat(s: Record<string, string>, key: string): number | null {
  if (key.toUpperCase() === "RRY") return rushRecYards(s);
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
/** One stat group of a college box-score row (rows saved since the multi-group fix carry every group under stats.groups). */
export function statGroup(s: Record<string, unknown>, name: string): Record<string, string> | null {
  const groups = s.groups as Record<string, Record<string, string>> | undefined;
  if (groups && groups[name]) return groups[name];
  return s.group === name ? (s as Record<string, string>) : null;
}
/** Completions (i=0) or attempts (i=1) from passing "C/ATT" ("21/30"). */
const cAtt = (s: Record<string, string>, i: 0 | 1) => {
  const g = statGroup(s, "passing");
  const parts = g?.["C/ATT"]?.split("/");
  const v = parts && parts.length === 2 ? Number(parts[i]) : NaN;
  return Number.isFinite(v) ? v : null;
};
/** Sum of several groups' values; null when the player has none of the groups. */
const sumGroups = (s: Record<string, string>, keys: [string, string][]) => {
  let any = false;
  let t = 0;
  for (const [g, k] of keys) {
    const grp = statGroup(s, g);
    if (!grp) continue;
    any = true;
    t += firstNumber(grp[k]) ?? 0;
  }
  return any ? t : null;
};
const fromGroup = (name: string, key: string) => (s: Record<string, string>) => {
  const g = statGroup(s, name);
  return g ? firstNumber(g[key]) : null;
};
const NCAAF_STATS: StatExtractor[] = [
  { statType: "Pass Yds", extract: fromGroup("passing", "YDS") },
  { statType: "Rush Yds", extract: fromGroup("rushing", "YDS") },
  { statType: "Rec Yds", extract: fromGroup("receiving", "YDS") },
  { statType: "Receptions", extract: fromGroup("receiving", "REC") },
  // Rushing + receiving yards; a player with neither line didn't record it.
  { statType: "Rush + Rec Yds", extract: (s) => rushRecYards(s) },
  // 1.23.0: the rest of the books' college menu.
  { statType: "Completions", extract: (s) => cAtt(s, 0) },
  { statType: "Pass Attempts", extract: (s) => cAtt(s, 1) },
  { statType: "Pass TDs", extract: fromGroup("passing", "TD") },
  { statType: "INTs Thrown", extract: fromGroup("passing", "INT") },
  { statType: "Rush Attempts", extract: fromGroup("rushing", "CAR") },
  { statType: "Rush TDs", extract: fromGroup("rushing", "TD") },
  { statType: "Rec TDs", extract: fromGroup("receiving", "TD") },
  { statType: "Anytime TD", extract: (s) => sumGroups(s, [["rushing", "TD"], ["receiving", "TD"]]) },
  { statType: "Pass + Rush Yds", extract: (s) => (statGroup(s, "passing") ? sumGroups(s, [["passing", "YDS"], ["rushing", "YDS"]]) : null) },
  { statType: "Longest Reception", extract: fromGroup("receiving", "LONG") },
  { statType: "Longest Rush", extract: fromGroup("rushing", "LONG") },
  { statType: "Kicking Points", extract: fromGroup("kicking", "PTS") },
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
