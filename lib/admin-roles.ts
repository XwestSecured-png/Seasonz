// Seasonz admin roles.
//
//   Regular admin — unlimited count. Can manage users, invite codes, and
//                   give the FIRST approval on a promo code.
//   Legacy admin  — at most MAX_LEGACY_ADMINS (5) at a time. Everything a
//                   regular admin can do, plus: the SECOND (final) approval
//                   on a promo code, revoking an active promo code,
//                   appointing/removing legacy admins, and protection from
//                   being demoted, banned, or deleted by a non-legacy admin.
import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { getCurrentUser, type CurrentUser } from "@/lib/current-user";

export const MAX_LEGACY_ADMINS = 5;

export async function countLegacyAdmins(): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.isLegacyAdmin, true), eq(users.isBanned, false)));
  return count;
}

type Guard = { user: CurrentUser; res: null } | { user: null; res: NextResponse };

/** API-route guard: signed-in admin (regular or legacy). */
export async function requireAdmin(): Promise<Guard> {
  const user = await getCurrentUser();
  if (!user) return { user: null, res: NextResponse.json({ error: "Sign in required" }, { status: 401 }) };
  if (!user.isAdmin) return { user: null, res: NextResponse.json({ error: "Admin only" }, { status: 403 }) };
  return { user, res: null };
}

/** API-route guard: signed-in legacy admin. */
export async function requireLegacyAdmin(): Promise<Guard> {
  const g = await requireAdmin();
  if (g.res) return g;
  if (!g.user.isLegacyAdmin) {
    return { user: null, res: NextResponse.json({ error: "Legacy admin only" }, { status: 403 }) };
  }
  return g;
}
