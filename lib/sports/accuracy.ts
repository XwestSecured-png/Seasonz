// How often each other sport's model favorite (home team when homeWinPctPre
// > 0.5, away otherwise) has actually won, among that sport's final games
// this season — the Model Tracker's "all sports" counterpart to its NFL
// AI-accuracy card, which does the same comparison against db/schema.ts's
// NFL-only `games` table.
import { db } from "@/db";
import { sportGames } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { SPORTS, type SportKey } from "./types";
import { currentSeasonYear } from "./espn";

export interface SportAccuracy {
  sportKey: SportKey;
  sportLabel: string;
  correct: number;
  graded: number;
  pct: number | null;
}

const OTHER_SPORTS: SportKey[] = ["nba", "wnba", "nhl", "mlb", "ncaaf", "ncaab"];

export async function otherSportsAccuracy(): Promise<SportAccuracy[]> {
  const rows: SportAccuracy[] = [];

  for (const sportKey of OTHER_SPORTS) {
    const season = currentSeasonYear(sportKey);
    const finalGames = await db
      .select()
      .from(sportGames)
      .where(
        and(eq(sportGames.sport, sportKey), eq(sportGames.season, season), eq(sportGames.isFinal, true))
      );

    let correct = 0;
    let graded = 0;
    for (const g of finalGames) {
      if (g.homeWinPctPre === null || g.homeScore === null || g.awayScore === null) continue;
      if (g.homeScore === g.awayScore) continue; // no ties to grade against in these sports
      const predictedHome = g.homeWinPctPre > 0.5;
      const actualHome = g.homeScore > g.awayScore;
      graded++;
      if (predictedHome === actualHome) correct++;
    }

    rows.push({
      sportKey,
      sportLabel: SPORTS[sportKey].label,
      correct,
      graded,
      pct: graded > 0 ? (correct / graded) * 100 : null,
    });
  }

  return rows;
}
