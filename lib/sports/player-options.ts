// Dropdown data for "Make your own pick" on the Props page: for each team in
// the listed games, its players (from synced ESPN box scores) and, for each
// player, the stats he actually records with his recent averages and any
// sportsbook line posted for this week. Stat keys are ESPN's own box-score
// labels, which is exactly what grading reads back.
import { db } from "@/db";
import { sportGames, sportPlayerGameStats, sportPropLinesRaw } from "@/db/schema";
import { and, eq, inArray, max } from "drizzle-orm";
import type { SportKey } from "./types";
import { currentSeasonYear } from "./espn";

const HOOPS: [string, string][] = [
  ["PTS", "Points"],
  ["REB", "Rebounds"],
  ["AST", "Assists"],
  ["3PT", "3-pointers made"],
  ["STL", "Steals"],
  ["BLK", "Blocks"],
  ["TO", "Turnovers"],
  ["OREB", "Offensive rebounds"],
  ["DREB", "Defensive rebounds"],
  ["FG", "Field goals made"],
  ["FT", "Free throws made"],
  ["PF", "Fouls"],
];
export const STAT_CHOICES: Record<SportKey, [string, string][]> = {
  nba: HOOPS,
  wnba: HOOPS,
  ncaab: HOOPS,
  nhl: [
    ["G", "Goals"],
    ["A", "Assists"],
    ["SOG", "Shots on goal"],
    ["S", "Shots"],
    ["BS", "Blocked shots"],
    ["HT", "Hits"],
    ["PIM", "Penalty minutes"],
    ["SV", "Saves"],
    ["GA", "Goals against"],
  ],
  mlb: [
    ["H", "Hits"],
    ["HR", "Home runs"],
    ["RBI", "RBIs"],
    ["R", "Runs"],
    ["BB", "Walks"],
    ["K", "Strikeouts"],
    ["ER", "Earned runs allowed"],
    ["IP", "Innings pitched"],
  ],
  ncaaf: [
    ["YDS", "Yards"],
    ["TD", "Touchdowns"],
    ["REC", "Receptions"],
    ["CAR", "Carries"],
    ["TOT", "Tackles"],
    ["SACKS", "Sacks"],
    ["INT", "Interceptions"],
  ],
};

// Book stat names (lib/sports/odds.ts) -> box-score keys
const BOOK_TO_KEY: Record<string, string> = {
  Points: "PTS",
  Rebounds: "REB",
  Assists: "AST",
  "3-Pointers Made": "3PT",
  Steals: "STL",
  Blocks: "BLK",
  Goals: "G",
  "Shots on Goal": "SOG",
  Saves: "SV",
  Hits: "H",
  "Home Runs": "HR",
  RBIs: "RBI",
  "Runs Scored": "R",
  Walks: "BB",
  "Strikeouts (Batter)": "K",
  "Strikeouts (Pitcher)": "K",
  "Earned Runs": "ER",
  Receptions: "REC",
};

export interface PlayerStatOption {
  key: string;
  label: string;
  group: string | null;
  avg: number; // last 10 games
  last5: number[]; // most recent first
  bookLine: { line: number; book: string } | null;
}
export interface PlayerOption {
  player: string;
  position: string | null;
  games: number;
  stats: PlayerStatOption[];
}

const num = (v: unknown) => {
  const m = String(v ?? "").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};

export async function getPlayerOptions(sport: SportKey, teams: string[]): Promise<Record<string, PlayerOption[]>> {
  if (teams.length === 0) return {};
  const season = currentSeasonYear(sport);
  const rows = await db
    .select({
      player: sportPlayerGameStats.player,
      team: sportPlayerGameStats.team,
      position: sportPlayerGameStats.position,
      stats: sportPlayerGameStats.stats,
      kickoffAt: sportGames.kickoffAt,
    })
    .from(sportPlayerGameStats)
    .innerJoin(sportGames, eq(sportGames.id, sportPlayerGameStats.gameId))
    .where(
      and(
        eq(sportPlayerGameStats.sport, sport),
        inArray(sportPlayerGameStats.season, [season - 1, season]),
        inArray(sportPlayerGameStats.team, teams)
      )
    );

  // This week's book lines, by player + box-score key.
  const [lw] = await db
    .select({ week: max(sportPropLinesRaw.week) })
    .from(sportPropLinesRaw)
    .where(and(eq(sportPropLinesRaw.sport, sport), eq(sportPropLinesRaw.season, season)));
  const bookLines = new Map<string, { line: number; book: string }>();
  if (lw?.week != null) {
    const lines = await db
      .select({ player: sportPropLinesRaw.player, statType: sportPropLinesRaw.statType, line: sportPropLinesRaw.line, book: sportPropLinesRaw.book })
      .from(sportPropLinesRaw)
      .where(and(eq(sportPropLinesRaw.sport, sport), eq(sportPropLinesRaw.season, season), eq(sportPropLinesRaw.week, lw.week)));
    // Most common (main) line per player/stat, FanDuel preferred.
    const counts = new Map<string, Map<number, { n: number; book: string }>>();
    for (const l of lines) {
      const key = BOOK_TO_KEY[l.statType];
      if (!key) continue;
      const k = `${l.player}|${key}`;
      const m = counts.get(k) ?? new Map();
      const e = m.get(l.line) ?? { n: 0, book: l.book };
      e.n++;
      if (/fanduel/i.test(l.book)) e.book = l.book;
      m.set(l.line, e);
      counts.set(k, m);
    }
    for (const [k, m] of counts) {
      const best = [...m.entries()].sort((a, b) => b[1].n - a[1].n)[0];
      bookLines.set(k, { line: best[0], book: best[1].book });
    }
  }

  // Each player's latest team decides where he's listed.
  const byPlayer = new Map<string, typeof rows>();
  for (const r of rows) byPlayer.set(r.player, [...(byPlayer.get(r.player) ?? []), r]);
  const choices = STAT_CHOICES[sport];
  const out: Record<string, PlayerOption[]> = {};
  for (const [player, list] of byPlayer) {
    list.sort((a, b) => (b.kickoffAt?.getTime() ?? 0) - (a.kickoffAt?.getTime() ?? 0));
    const team = list[0].team;
    const recent = list.filter((r) => r.team === team).slice(0, 10);
    const stats: PlayerStatOption[] = [];
    for (const [key, label] of choices) {
      const vals = recent
        .map((r) => (r.stats as Record<string, string>)[key])
        .filter((v) => v !== undefined)
        .map(num)
        .filter((v): v is number => v !== null);
      if (vals.length === 0) continue;
      const group = (recent[0].stats as Record<string, string>).group ?? null;
      stats.push({
        key,
        label: group && sport === "ncaaf" && key === "YDS" ? `${group} yards` : label,
        group,
        avg: vals.reduce((s, v) => s + v, 0) / vals.length,
        last5: vals.slice(0, 5),
        bookLine: bookLines.get(`${player}|${key}`) ?? null,
      });
    }
    if (stats.length === 0) continue;
    (out[team] ??= []).push({ player, position: recent[0].position, games: recent.length, stats });
  }
  // Biggest producers first (highest average in the sport's main stat).
  for (const team of Object.keys(out)) {
    out[team].sort((a, b) => (b.stats[0]?.avg ?? 0) - (a.stats[0]?.avg ?? 0) || b.games - a.games);
    out[team] = out[team].slice(0, sport === "ncaaf" ? 45 : 30);
  }
  return out;
}
