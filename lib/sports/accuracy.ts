// The model's scorecard for every sport besides NFL: how often its pick won
// this week and this season, how well calibrated its percentages were
// (Brier score), and how the sportsbook favorite did on the same games.
//
// Grades the number the model showed BEFORE each game started (the
// "locked" snapshot written by lib/sports/model-sync.ts), so later model
// updates never rewrite the record. Games from before locking existed fall
// back to the stored pre-game number.
import { db } from "@/db";
import { sportGames } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { SPORTS, type SportKey } from "./types";
import { currentSeasonYear } from "./espn";
import { etWeekWindow, inWindow } from "../week-window";
import { noVigHome } from "./game-model";

export interface ScoreLine {
  correct: number;
  graded: number;
  pct: number | null;
  brier: number | null; // lower is better; 0.25 = coin flip
  bookCorrect: number; // book favorite's record on games that had a line
  bookGraded: number;
}

export interface SportAccuracy {
  sportKey: SportKey;
  sportLabel: string;
  correct: number;
  graded: number;
  pct: number | null;
  week: ScoreLine;
  season: ScoreLine;
}

const OTHER_SPORTS: SportKey[] = ["nba", "wnba", "nhl", "mlb", "ncaaf", "ncaab"];

type Row = typeof sportGames.$inferSelect;
interface Extra {
  locked?: { pct: number; market: number | null };
  odds?: { fanduel?: { mlHome: number | null; mlAway: number | null }; betmgm?: { mlHome: number | null; mlAway: number | null } };
  oddsUpdatedAt?: string;
  preview?: { espnOdds?: { mlHome: number; mlAway: number } | null; espnOddsAt?: string | null };
}

/** The home win chance the model showed before the game started. */
export function pregamePct(g: Row): number | null {
  const ex = (g.extra ?? {}) as Extra;
  return ex.locked?.pct ?? g.homeWinPctPre;
}

function bookPct(g: Row): number | null {
  const ex = (g.extra ?? {}) as Extra;
  if (ex.locked?.market != null) return ex.locked.market;
  // Only lines captured before the game started.
  const start = g.kickoffAt?.getTime() ?? 0;
  const pre = (at: string | null | undefined) => !!at && Date.parse(at) < start;
  const b = pre(ex.oddsUpdatedAt) ? (ex.odds?.fanduel ?? ex.odds?.betmgm) : undefined;
  return (
    noVigHome(b?.mlHome ?? null, b?.mlAway ?? null) ??
    (pre(ex.preview?.espnOddsAt) ? noVigHome(ex.preview?.espnOdds?.mlHome, ex.preview?.espnOdds?.mlAway) : null)
  );
}

export function scoreGames(rows: Row[]): ScoreLine {
  let correct = 0;
  let graded = 0;
  let brier = 0;
  let bookCorrect = 0;
  let bookGraded = 0;
  for (const g of rows) {
    if (g.homeScore === null || g.awayScore === null || g.homeScore === g.awayScore) continue;
    const p = pregamePct(g);
    if (p === null) continue;
    const homeWon = g.homeScore > g.awayScore ? 1 : 0;
    graded++;
    if ((p > 0.5 ? 1 : 0) === homeWon) correct++;
    brier += (p - homeWon) ** 2;
    const b = bookPct(g);
    if (b !== null && b !== 0.5) {
      bookGraded++;
      if ((b > 0.5 ? 1 : 0) === homeWon) bookCorrect++;
    }
  }
  return {
    correct,
    graded,
    pct: graded ? (correct / graded) * 100 : null,
    brier: graded ? brier / graded : null,
    bookCorrect,
    bookGraded,
  };
}

export async function otherSportsAccuracy(): Promise<SportAccuracy[]> {
  const w = etWeekWindow();
  const out: SportAccuracy[] = [];
  for (const sportKey of OTHER_SPORTS) {
    const season = currentSeasonYear(sportKey);
    const finals = await db
      .select()
      .from(sportGames)
      .where(and(eq(sportGames.sport, sportKey), eq(sportGames.season, season), eq(sportGames.isFinal, true)));
    const seasonLine = scoreGames(finals);
    const weekLine = scoreGames(finals.filter((g) => inWindow(g.kickoffAt, w)));
    out.push({
      sportKey,
      sportLabel: SPORTS[sportKey].label,
      correct: seasonLine.correct,
      graded: seasonLine.graded,
      pct: seasonLine.pct,
      week: weekLine,
      season: seasonLine,
    });
  }
  return out;
}
