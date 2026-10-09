import { cookies } from "next/headers";
import { db } from "@/db";
import { users } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { isTier, tierAtLeast, type Tier } from "@/lib/tiers";

export interface CurrentUser {
  id: number;
  username: string;
  bankrollUsd: number | null;
  /** Effective tier: the higher of the paid/comped tier and any unexpired promo-code tier. */
  tier: Tier;
  /** The paid/comped tier alone (users.tier), ignoring promo time. */
  baseTier: Tier;
  promoTier: Tier | null;
  promoExpiresAt: Date | null;
  isAdmin: boolean;
  isLegacyAdmin: boolean;
  subscriptionStatus: string | null;
  stripeCustomerId: string | null;
  identityStatus: string;
  lastSeenUpdate: string | null;
}

/**
 * ADMIN_USERNAMES is a one-time bootstrap knob, not an ongoing admin list —
 * it solves the chicken-and-egg problem of granting the very first admin,
 * since the admin dashboard's "Make admin" button only works if someone is
 * already an admin. Set it to a comma-separated list of usernames (case-
 * insensitive) in your hosting provider's env vars; the next time any of
 * those usernames logs in (or loads a page), getCurrentUser below promotes
 * them and writes isAdmin = true to the database — a one-way door, after
 * which the admin dashboard is the normal way to manage admin access.
 * NOTE: because this check runs on every request, removing a username from
 * ADMIN_USERNAMES does NOT revoke admin by itself — revoke it from the
 * admin dashboard ("Remove admin"), and also drop it from this env var so
 * it doesn't get silently re-promoted next time that account logs in.
 *
 * Seasonz: a username on this list is also made a LEGACY admin (see
 * lib/admin-roles.ts) the first time it loads a page, as long as one of
 * the 5 legacy slots is free. Legacy admins can't be demoted, banned, or
 * deleted by a regular admin.
 */
export function isBootstrapAdminUsername(username: string): boolean {
  const raw = process.env.ADMIN_USERNAMES;
  if (!raw) return false;
  return raw
    .split(",")
    .map((u) => u.trim().toLowerCase())
    .filter(Boolean)
    .includes(username.toLowerCase());
}

/**
 * Promotes `userId` to admin when its username is on the ADMIN_USERNAMES
 * bootstrap list, and also to legacy admin if one of the 5 legacy slots is
 * free. Returns the admin/legacy flags the caller should use.
 */
async function maybeBootstrapAdmin(
  userId: number,
  username: string,
  isAdmin: boolean,
  isLegacyAdmin: boolean
): Promise<{ isAdmin: boolean; isLegacyAdmin: boolean }> {
  if (!isBootstrapAdminUsername(username) || (isAdmin && isLegacyAdmin)) {
    return { isAdmin, isLegacyAdmin };
  }
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.isLegacyAdmin, true), eq(users.isBanned, false)));
  const makeLegacy = isLegacyAdmin || count < 5;
  await db.update(users).set({ isAdmin: true, isLegacyAdmin: makeLegacy }).where(eq(users.id, userId));
  return { isAdmin: true, isLegacyAdmin: makeLegacy };
}

function effectiveTier(base: Tier, promoTier: string | null, promoExpiresAt: Date | null): Tier {
  if (!promoTier || !isTier(promoTier) || !promoExpiresAt || promoExpiresAt.getTime() <= Date.now()) {
    return base;
  }
  return tierAtLeast(promoTier, base) ? promoTier : base;
}

/**
 * Looks up the signed-in user for a server component. Pages under
 * app/(app) are only ever rendered once proxy.ts has already confirmed a
 * valid session cookie, so this should normally find a user — but callers
 * still get `null` back (rather than throwing) for the rare edge case of a
 * user deleted mid-session, so pages can fail soft.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const userId = verifySessionToken(token);
  if (userId === null) return null;

  // Seasonz runs every migration (0000-0024) on a fresh database, so the
  // NFL app's missing-column fallback isn't needed here.
  const [user] = await db.select().from(users).where(eq(users.id, userId));

  // A banned account is treated as signed out everywhere — pages that gate
  // on `!user` behave exactly as if this cookie belonged to no one.
  if (!user || user.isBanned) return null;
  // Defensive fallback to "free" for a row whose tier value somehow isn't
  // one of the known tiers — never let a bad value silently grant paid features.
  const baseTier: Tier = isTier(user.tier) ? user.tier : "free";
  const flags = await maybeBootstrapAdmin(user.id, user.username, user.isAdmin, user.isLegacyAdmin);
  // Legacy admins get the full app (Super Pro) at no charge.
  const isLegacy = flags.isAdmin && flags.isLegacyAdmin;
  return {
    id: user.id,
    username: user.username,
    bankrollUsd: user.bankrollUsd,
    tier: isLegacy ? "super_pro" : effectiveTier(baseTier, user.promoTier, user.promoExpiresAt),
    baseTier,
    promoTier: user.promoTier && isTier(user.promoTier) ? user.promoTier : null,
    promoExpiresAt: user.promoExpiresAt,
    isAdmin: flags.isAdmin,
    isLegacyAdmin: flags.isAdmin && flags.isLegacyAdmin,
    subscriptionStatus: user.subscriptionStatus,
    stripeCustomerId: user.stripeCustomerId,
    identityStatus: user.identityStatus,
    lastSeenUpdate: user.lastSeenUpdate,
  };
}
