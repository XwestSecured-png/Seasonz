import { cookies } from "next/headers";

// Same cookie name used by app/(app)/music-launcher.tsx — kept here as the
// single source of truth, same pattern as FAV_TEAM_COOKIE in
// lib/favorite-team.ts.
export const MUSIC_PREF_COOKIE = "nfl_music_pref";

export type MusicService = "spotify" | "apple";

const VALID_SERVICES: readonly MusicService[] = ["spotify", "apple"];

function isMusicService(value: string): value is MusicService {
  return (VALID_SERVICES as readonly string[]).includes(value);
}

/**
 * The signed-in browser's preferred music app ("spotify" | "apple"), or null
 * if none picked yet. Used to show the one-tap "open my music" launcher in
 * the header / bottom-nav "More" sheet.
 *
 * There's no browser API that lets a website silently auto-play whatever is
 * in a visitor's default device music player, or launch it without a tap —
 * both iOS and Android block that outside a real user gesture. This is the
 * closest equivalent: remember which service the user wants, then hand off
 * to it (app deep link, falling back to the web player) on a single tap.
 */
export async function getMusicPref(): Promise<MusicService | null> {
  const cookieStore = await cookies();
  const value = cookieStore.get(MUSIC_PREF_COOKIE)?.value ?? "";
  return isMusicService(value) ? value : null;
}
