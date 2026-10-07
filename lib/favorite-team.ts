import { cookies } from "next/headers";
import { getTeam, type Team } from "./team-colors";

// Same cookie name used by app/(app)/team-picker.tsx and app/(app)/layout.tsx
// — kept here as the single source of truth so every page reads it the same
// way instead of re-typing the string.
export const FAV_TEAM_COOKIE = "nfl_fav_team";

/** The signed-in browser's chosen favorite team (or null if none picked yet), for highlighting that team wherever it shows up across the app. */
export async function getFavoriteTeam(): Promise<Team | null> {
  const cookieStore = await cookies();
  const code = cookieStore.get(FAV_TEAM_COOKIE)?.value ?? null;
  return getTeam(code);
}
