// Every football player-prop market the odds feeds offer (The Odds API /
// PropLine market keys, shared by NFL and college football), with the stat
// name shown in the app. Client-safe: no server imports.
//
// CORE markets are the four yardage/reception props the model projects.
// The rest are fetched so the parlay builder can offer every prop a book
// posts; if a provider ever rejects one of them, the fetch falls back to
// CORE only (see lib/odds.ts / lib/sports/odds.ts).
export const FOOTBALL_CORE_MARKETS: Record<string, string> = {
  player_pass_yds: "Pass Yds",
  player_rush_yds: "Rush Yds",
  player_reception_yds: "Rec Yds",
  player_receptions: "Receptions",
};

export const FOOTBALL_EXTENDED_MARKETS: Record<string, string> = {
  // Touchdowns
  player_anytime_td: "Anytime TD", // Yes/No
  player_tds_over: "TDs", // Over only: 0.5 = 1+, 1.5 = 2+, 2.5 = 3+
  player_1st_td: "First TD", // Yes/No
  player_last_td: "Last TD", // Yes/No
  player_pass_tds: "Pass TDs",
  player_rush_tds: "Rush TDs",
  player_reception_tds: "Rec TDs",
  player_rush_reception_tds: "Rush + Rec TDs",
  // Quarterback
  player_pass_attempts: "Pass Attempts",
  player_pass_completions: "Completions",
  player_pass_interceptions: "INTs Thrown",
  player_pass_longest_completion: "Longest Completion",
  player_pass_rush_yds: "Pass + Rush Yds",
  // Rushing / receiving
  player_rush_attempts: "Rush Attempts",
  player_rush_longest: "Longest Rush",
  player_reception_longest: "Longest Reception",
  player_rush_reception_yds: "Rush + Rec Yds",
  // Defense (pass rush and coverage)
  player_sacks: "Sacks",
  player_solo_tackles: "Solo Tackles",
  player_tackles_assists: "Tackles + Assists",
  player_defensive_interceptions: "Def INTs",
  // Kicking
  player_field_goals: "Field Goals",
  player_kicking_points: "Kicking Points",
  player_pats: "Extra Points",
};

export const FOOTBALL_ALL_MARKETS: Record<string, string> = { ...FOOTBALL_CORE_MARKETS, ...FOOTBALL_EXTENDED_MARKETS };

/** Book name used for the model's own fair-priced props (no sportsbook posts these). */
export const MODEL_FAIR_BOOK = "Seasonz model (fair price)";

/** A raw outcome -> side + line, for Over/Under, Over-only and Yes/No markets. Null when it isn't a usable player outcome. */
export function readPropOutcome(o: { name: string; point?: number | null; description?: string }): { side: string; line: number } | null {
  if (!o.description) return null;
  if (o.name === "Over" || o.name === "Under") {
    if (o.point == null) return null;
    return { side: o.name, line: o.point };
  }
  if (o.name === "Yes" || o.name === "No") return { side: o.name, line: o.point ?? 0.5 };
  return null;
}

/** How a prop reads on a bet slip: "Josh Allen Anytime TD", "Derrick Henry 2+ TDs", "Lamar Jackson Over 1.5 Pass TDs". */
export function propLegLabel(player: string, statType: string, side: string, line: number): string {
  if (statType === "TDs" && side === "Over") return `${player} ${Math.ceil(line)}+ TDs`;
  if (side === "Yes") return `${player} ${statType}`;
  if (side === "No") return `${player} No ${statType}`;
  return `${player} ${side} ${line} ${statType}`;
}

/** Fair (no-margin) American odds for a probability. */
export function fairAmerican(p: number): number {
  const q = Math.min(0.99, Math.max(0.01, p));
  return q >= 0.5 ? -Math.round((q / (1 - q)) * 100) : Math.round(((1 - q) / q) * 100);
}
