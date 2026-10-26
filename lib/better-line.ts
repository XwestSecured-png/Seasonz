// "A better line is up" alerts for saved prop picks (1.26.0).
//
// A saved prop pick (My Picks / Make your own pick) records the player, the
// box-score stat (ESPN's label: PTS, REB, HR, SOG...) and the number. When a
// sportsbook later posts that prop at an easier number (a lower line for an
// Over, a higher one for an Under) at a fair price, the user is told once.
import { STAT_EXTRACTORS } from "./sports/stat-extract";
import { PICKEM_BOOKS } from "./props-model";
import { nameKey } from "./player-names";
import type { SportKey } from "./sports/types";

/**
 * Book stat types for a box-score label ("PTS" -> ["Points"]; MLB "K" ->
 * batter and pitcher strikeouts), by running each extractor on just that label.
 */
export function statTypesForLabel(sport: SportKey, label: string): string[] {
  const key = label.trim();
  const probe = (stats: Record<string, string>) =>
    (STAT_EXTRACTORS[sport] ?? []).filter((e) => {
      try {
        return e.extract(stats) === 7;
      } catch {
        return false;
      }
    });
  // Rows are probed the way each sport's box scores look: a skater group for
  // hockey, an at-bat (hitter) or innings-pitched (pitcher) column for baseball.
  const contexts: Record<string, string>[] = [{}, { group: "forwards" }, { group: "defenses" }, { group: "goalies" }, { AB: "4" }, { IP: "6" }];
  // Other columns set to 1, so a combo stat (Points = G + A) reads 8 and only
  // the single stat still reads 7.
  const filler = Object.fromEntries(["G", "A", "PTS", "REB", "AST", "STL", "BLK", "H", "R", "RBI", "S"].filter((k) => k !== key).map((k) => [k, "1"]));
  const found = new Set<string>();
  for (const ctx of contexts) {
    for (const k of new Set([key, key.toUpperCase()])) {
      let hits = probe({ ...ctx, [k]: "7" });
      if (hits.length > 1) hits = hits.filter((e) => e.extract({ ...ctx, ...filler, [k]: "7" }) === 7);
      if (hits.length === 1) found.add(hits[0].statType);
    }
  }
  return [...found];
}

/** Worst price still counted as a fair number to move to. */
export const BETTER_LINE_MIN_PRICE = -150;

export interface BetterLine {
  book: string;
  line: number;
  priceAmerican: number;
}

/**
 * The easiest number now posted for a pick, if it beats the user's by at
 * least a half point (or 3% of the line for big lines like yards).
 */
export function betterLine(
  pick: { player: string; side: "over" | "under"; threshold: number },
  lines: { player: string; line: number; side: string; book: string; priceAmerican: number }[]
): BetterLine | null {
  const who = nameKey(pick.player);
  const want = pick.side === "over" ? "Over" : "Under";
  const gap = Math.max(0.5, Math.abs(pick.threshold) * 0.03);
  let best: BetterLine | null = null;
  for (const l of lines) {
    if (l.side !== want || PICKEM_BOOKS.has(l.book) || l.priceAmerican < BETTER_LINE_MIN_PRICE || l.priceAmerican > 1000) continue;
    if (nameKey(l.player) !== who) continue;
    const better = want === "Over" ? pick.threshold - l.line : l.line - pick.threshold;
    if (better < gap - 1e-9) continue;
    if (
      !best ||
      (want === "Over" ? l.line < best.line : l.line > best.line) ||
      (l.line === best.line && l.priceAmerican > best.priceAmerican)
    )
      best = { book: l.book, line: l.line, priceAmerican: l.priceAmerican };
  }
  return best;
}
