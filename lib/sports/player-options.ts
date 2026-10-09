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

type Role = "batter" | "pitcher" | "skater" | "goalie" | string | null;

// Book stat names (lib/sports/odds.ts) -> box-score key, and which kind of
// player it applies to (MLB "K" means different things for a pitcher and a
// batter; college "YDS" depends on passing/rushing/receiving).
const BOOK_TO_KEY: Record<string, { key: string; role?: Role }> = {
  Points: { key: "PTS" },
  Rebounds: { key: "REB" },
  Assists: { key: "AST" },
  "3-Pointers Made": { key: "3PT" },
  Steals: { key: "STL" },
  Blocks: { key: "BLK" },
  Goals: { key: "G" },
  "Shots on Goal": { key: "SOG" },
  Saves: { key: "SV" },
  Hits: { key: "H", role: "batter" },
  "Home Runs": { key: "HR", role: "batter" },
  RBIs: { key: "RBI", role: "batter" },
  "Runs Scored": { key: "R", role: "batter" },
  Walks: { key: "BB", role: "batter" },
  "Strikeouts (Batter)": { key: "K", role: "batter" },
  "Strikeouts (Pitcher)": { key: "K", role: "pitcher" },
  "Hits Allowed": { key: "H", role: "pitcher" },
  "Walks Allowed": { key: "BB", role: "pitcher" },
  "Earned Runs": { key: "ER", role: "pitcher" },
  Receptions: { key: "REC", role: "receiving" },
  "Rec Yds": { key: "YDS", role: "receiving" },
  "Rush Yds": { key: "YDS", role: "rushing" },
  "Pass Yds": { key: "YDS", role: "passing" },
};

// Per-role stat menus where the sport-wide list doesn't fit.
const ROLE_CHOICES: Record<string, [string, string][]> = {
  pitcher: [
    ["K", "Strikeouts (pitching)"],
    ["IP", "Innings pitched"],
    ["H", "Hits allowed"],
    ["ER", "Earned runs allowed"],
    ["BB", "Walks allowed"],
    ["HR", "Home runs allowed"],
  ],
  batter: [
    ["H", "Hits"],
    ["HR", "Home runs"],
    ["RBI", "RBIs"],
    ["R", "Runs"],
    ["BB", "Walks"],
    ["K", "Strikeouts (batting)"],
  ],
  goalie: [
    ["SV", "Saves"],
    ["GA", "Goals against"],
  ],
  skater: [
    ["SOG", "Shots on goal"],
    ["G", "Goals"],
    ["A", "Assists"],
    ["BS", "Blocked shots"],
    ["HT", "Hits"],
    ["PIM", "Penalty minutes"],
  ],
};
// College groups that never get props.
const SKIP_GROUPS = new Set(["punting", "kicking", "kickReturns", "puntReturns"]);

function roleOf(sport: SportKey, stats: Record<string, string>): Role {
  if (sport === "mlb") return "IP" in stats ? "pitcher" : "batter";
  if (sport === "nhl") return stats.group === "goalies" ? "goalie" : "skater";
  if (sport === "ncaaf") return stats.group ?? null;
  return null;
}

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
  role: string | null;
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
  const bookLines = new Map<string, { line: number; book: string }>(); // player|key|role
  if (lw?.week != null) {
    const lines = await db
      .select({ player: sportPropLinesRaw.player, statType: sportPropLinesRaw.statType, line: sportPropLinesRaw.line, book: sportPropLinesRaw.book })
      .from(sportPropLinesRaw)
      .where(and(eq(sportPropLinesRaw.sport, sport), eq(sportPropLinesRaw.season, season), eq(sportPropLinesRaw.week, lw.week)));
    // Most common (main) line per player/stat, FanDuel preferred.
    const counts = new Map<string, Map<number, { n: number; book: string }>>();
    for (const l of lines) {
      const map = BOOK_TO_KEY[l.statType];
      if (!map) continue;
      const k = `${l.player}|${map.key}|${map.role ?? ""}`;
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
    const latestStats = list[0].stats as Record<string, string>;
    const role = roleOf(sport, latestStats);
    if (sport === "ncaaf" && role && SKIP_GROUPS.has(role)) continue;
    const recent = list.filter((r) => r.team === team && roleOf(sport, r.stats as Record<string, string>) === role).slice(0, 10);
    if (recent.length === 0) continue;
    const stats: PlayerStatOption[] = [];
    const menu = (role && ROLE_CHOICES[role]) || choices;
    for (const [key, label] of menu) {
      const vals = recent
        .map((r) => (r.stats as Record<string, string>)[key])
        .filter((v) => v !== undefined)
        .map(num)
        .filter((v): v is number => v !== null);
      if (vals.length === 0) continue;
      const group = (recent[0].stats as Record<string, string>).group ?? null;
      stats.push({
        key,
        label: group && sport === "ncaaf" && key === "YDS" ? `${group[0].toUpperCase()}${group.slice(1)} yards` : label,
        group,
        avg: vals.reduce((s, v) => s + v, 0) / vals.length,
        last5: vals.slice(0, 5),
        bookLine:
          bookLines.get(`${player}|${key}|${role ?? ""}`) ??
          (sport === "nba" || sport === "wnba" || sport === "ncaab" || sport === "nhl"
            ? (bookLines.get(`${player}|${key}|`) ?? null)
            : null),
      });
    }
    if (stats.length === 0) continue;
    (out[team] ??= []).push({ player, position: recent[0].position, games: recent.length, stats, role: role ?? null });
  }
  // Biggest producers first (highest average in the sport's main stat).
  for (const team of Object.keys(out)) {
    // Batters/skaters before pitchers/goalies, then by the main stat.
    const back = (p: PlayerOption) => (p.role === "pitcher" || p.role === "goalie" ? 1 : 0);
    out[team].sort((a, b) => back(a) - back(b) || (b.stats[0]?.avg ?? 0) - (a.stats[0]?.avg ?? 0) || b.games - a.games);
    out[team] = out[team].slice(0, sport === "ncaaf" ? 45 : 30);
  }
  return out;
}
