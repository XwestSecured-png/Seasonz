// Seasonz platform invite codes.
//
// Admins keep a set list of invite codes for each platform. Every time the
// admin page loads, nextCodeForPlatform() hands out the least-recently-
// shown active code for each platform and stamps it as shown, so the code
// on screen rotates to a different one on every load (as long as that
// platform has at least 2 active codes).
//
// A new user signs up with any active code. With INVITE_CODE_STRICT_PLATFORM
// set to "true", the code's platform must also match the device the signup
// comes from (detected from the browser's user agent).
import { randomInt } from "crypto";
import { db } from "@/db";
import { inviteCodes } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";

export const PLATFORMS = ["ios", "android", "desktop"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_LABELS: Record<Platform, string> = {
  ios: "iPhone / iPad",
  android: "Android",
  desktop: "Desktop / web",
};

export function isPlatform(v: string): v is Platform {
  return (PLATFORMS as readonly string[]).includes(v);
}

/** Best-effort device platform from a User-Agent header. iPadOS often reports as a Mac, so it lands on "desktop". */
export function platformFromUserAgent(ua: string | null | undefined): Platform {
  const s = (ua ?? "").toLowerCase();
  if (/iphone|ipad|ipod/.test(s)) return "ios";
  if (/android/.test(s)) return "android";
  return "desktop";
}

// No 0/O/1/I/L — codes get read aloud and typed on phones.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const PREFIX: Record<Platform, string> = { ios: "IOS", android: "AND", desktop: "WEB" };

export function generateCode(platform: Platform): string {
  let body = "";
  for (let i = 0; i < 8; i++) body += ALPHABET[randomInt(ALPHABET.length)];
  return `${PREFIX[platform]}-${body.slice(0, 4)}-${body.slice(4)}`;
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * Picks the next code to display for `platform` — the active code shown
 * longest ago (never-shown first) — and marks it shown, in one atomic
 * statement so two admins loading at once don't get the same code.
 */
export async function nextCodeForPlatform(platform: Platform): Promise<{ id: number; code: string; uses: number } | null> {
  const rows = await db.execute<{ id: number; code: string; uses: number }>(sql`
    UPDATE invite_codes SET last_shown_at = now()
    WHERE id = (
      SELECT id FROM invite_codes
      WHERE platform = ${platform} AND is_active = true
      ORDER BY last_shown_at ASC NULLS FIRST, id ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, code, uses
  `);
  const row = (rows as unknown as { id: number; code: string; uses: number }[])[0];
  return row ?? null;
}

/** Looks up an active invite code. Returns null if it doesn't exist or is turned off. */
export async function findActiveInviteCode(code: string) {
  const [row] = await db
    .select()
    .from(inviteCodes)
    .where(and(eq(inviteCodes.code, normalizeCode(code)), eq(inviteCodes.isActive, true)));
  return row ?? null;
}

export async function recordInviteUse(id: number): Promise<void> {
  await db.update(inviteCodes).set({ uses: sql`${inviteCodes.uses} + 1` }).where(eq(inviteCodes.id, id));
}

export function strictPlatformMatching(): boolean {
  return process.env.INVITE_CODE_STRICT_PLATFORM?.trim().toLowerCase() === "true";
}
