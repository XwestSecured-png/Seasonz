import { cookies } from "next/headers";
import { parseSportsbookPrefs, type Sportsbook } from "./sportsbooks";

// Same cookie name used by app/(app)/sportsbook-picker.tsx and
// app/(app)/push-bet-button.tsx — kept here as the single source of truth
// for server reads, same pattern as lib/favorite-team.ts / lib/music-pref.ts.
export const SPORTSBOOK_PREF_COOKIE = "nfl_sportsbook_pref";

/**
 * The signed-in browser's saved betting platforms — zero or more of a
 * sportsbook, a prediction market, or Underdog (see lib/sportsbooks.ts's
 * Sportsbook union for the full list). Stored as a comma-separated list in
 * one cookie. PushBetButton pushes a bet slip to every platform in this list
 * at once (one tab + one clipboard copy per platform) rather than picking a
 * single "preferred" one.
 */
export async function getSportsbookPrefs(): Promise<Sportsbook[]> {
  const cookieStore = await cookies();
  return parseSportsbookPrefs(cookieStore.get(SPORTSBOOK_PREF_COOKIE)?.value ?? "");
}
