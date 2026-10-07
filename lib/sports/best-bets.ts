// The Dashboard's "all sports" Best Bets list, for every sport besides NFL.
// These sports don't have real sportsbook odds synced yet (see
// lib/sports/sync.ts's comment on NFL's extra stages not having a
// sport-general equivalent), so there's no real edge% to show for them —
// this surfaces the model's own confidence pick (the Elo + win-prob
// favorite) for each sport's most lopsided upcoming game instead. That's
// the same honest "model favorite" fallback already used elsewhere on the
// Dashboard for an NFL game with no betting line, just generalized across
// sports. Nothing here is a real betting edge — only NFL rows (built
// separately in app/(app)/page.tsx from real odds) carry an edge%.
import { db } from "@/db";
import { sportGames } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { SPORTS, type SportKey } from "./types";
import { currentSeasonYear } from "./espn";
import { confidenceScore, confidenceTier, MIN_MODEL_WIN_PCT, type ConfidenceTier } from "../confidence";
import { probToFairAmerican } from "../fair-odds";

export interface SportBestBetRow {
  sportKey: SportKey;
  sportLabel: string;
  matchup: string;
  pickLabel: string;
  score: number;
  tier: ConfidenceTier;
  href: string;
}

/** One sport's upcoming game, for Parlays — the model's favorite only (never the underdog; picking against your own model isn't a "model pick"), priced with fair (no-vig) odds since these sports have no real sportsbook line synced yet. */
export interface SportPickCandidate {
  id: string; // "sport-<sportKey>-<sportGames.id>"
  sportKey: SportKey;
  sportLabel: string;
  matchup: string;
  pickLabel: string; // "BOS to win"
  priceAmerican: number; // fair/no-vig odds from the model's own win probability
}

const OTHER_SPORTS: SportKey[] = ["nba", "wnba", "nhl", "mlb", "ncaaf", "ncaab"];

/** This "active week" bucket's upcoming games for one sport, with a model win probability — shared by otherSportsBestBets and otherSportsPickCandidates below. */
async function activeWeekUpcoming(sportKey: SportKey) {
  const season = currentSeasonYear(sportKey);
  const upcoming = await db
    .select()
    .from(sportGames)
    .where(and(eq(sportGames.sport, sportKey), eq(sportGames.season, season), eq(sportGames.isFinal, false)));

  if (upcoming.length === 0) return [];
  const activeWeek = Math.min(...upcoming.map((g) => g.week));
  return upcoming.filter((g) => g.week === activeWeek && g.homeWinPctPre !== null);
}

/** Up to `perSport` of each sport's most lopsided upcoming games, by model win probability. */
export async function otherSportsBestBets(perSport = 2): Promise<SportBestBetRow[]> {
  const rows: SportBestBetRow[] = [];

  for (const sportKey of OTHER_SPORTS) {
    const candidates = await activeWeekUpcoming(sportKey);
    if (candidates.length === 0) continue;

    const picks = candidates
      .map((g) => {
        const homeWinPct = g.homeWinPctPre!;
        const favoredHome = homeWinPct >= 0.5;
        return {
          g,
          prob: favoredHome ? homeWinPct : 1 - homeWinPct,
          favoredTeam: favoredHome ? g.homeTeam : g.awayTeam,
        };
      })
      // Same house-wide "only show real confidence" bar as NFL props/
      // parlays (lib/confidence.ts) — a model favorite under 70% just
      // doesn't surface here at all.
      .filter(({ prob }) => prob >= MIN_MODEL_WIN_PCT)
      .sort((a, b) => b.prob - a.prob)
      .slice(0, perSport);

    for (const { g, prob, favoredTeam } of picks) {
      const score = confidenceScore(prob);
      rows.push({
        sportKey,
        sportLabel: SPORTS[sportKey].label,
        matchup: `${g.awayTeam} @ ${g.homeTeam}`,
        pickLabel: `${favoredTeam} to win`,
        score,
        tier: confidenceTier(score),
        href: `/sports/${sportKey}`,
      });
    }
  }

  return rows;
}

/**
 * Every other sport's active-week model favorite, as a Parlays candidate —
 * used by the manual "Other sports" quick-add list and by Ask AI's
 * candidate pool (app/api/parlay-ai/route.ts) so a parlay can mix a real
 * NFL edge pick with, say, an NBA model pick in the same slip. Priced with
 * probToFairAmerican (lib/fair-odds.ts) rather than a real sportsbook
 * price, since none of these sports have odds synced yet — every caller
 * must keep that labeled as a model price, not a book's price.
 */
export async function otherSportsPickCandidates(): Promise<SportPickCandidate[]> {
  const out: SportPickCandidate[] = [];

  for (const sportKey of OTHER_SPORTS) {
    const candidates = await activeWeekUpcoming(sportKey);
    for (const g of candidates) {
      const homeWinPct = g.homeWinPctPre!;
      const favoredHome = homeWinPct >= 0.5;
      const prob = favoredHome ? homeWinPct : 1 - homeWinPct;
      if (prob < MIN_MODEL_WIN_PCT) continue;
      const favoredTeam = favoredHome ? g.homeTeam : g.awayTeam;
      out.push({
        id: `sport-${sportKey}-${g.id}`,
        sportKey,
        sportLabel: SPORTS[sportKey].label,
        matchup: `${g.awayTeam} @ ${g.homeTeam}`,
        pickLabel: `${favoredTeam} to win`,
        priceAmerican: probToFairAmerican(prob),
      });
    }
  }

  return out;
}
