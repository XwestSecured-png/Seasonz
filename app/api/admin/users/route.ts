import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { and, eq, ilike, ne } from "drizzle-orm";
import { hashPassword } from "@/lib/auth";
import { isTier } from "@/lib/tiers";
import { MAX_LEGACY_ADMINS, countLegacyAdmins, requireAdmin } from "@/lib/admin-roles";

/** GET /api/admin/users?q=search — lists accounts, optionally filtered by username substring. Never returns passwordHash. */
export async function GET(req: NextRequest) {
  const { res } = await requireAdmin();
  if (res) return res;

  const q = req.nextUrl.searchParams.get("q")?.trim();
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      tier: users.tier,
      tierUpdatedAt: users.tierUpdatedAt,
      subscriptionStatus: users.subscriptionStatus,
      isAdmin: users.isAdmin,
      isLegacyAdmin: users.isLegacyAdmin,
      isBanned: users.isBanned,
      createdAt: users.createdAt,
      stripeSubscriptionId: users.stripeSubscriptionId,
      identityStatus: users.identityStatus,
      promoTier: users.promoTier,
      promoExpiresAt: users.promoExpiresAt,
      signupPlatform: users.signupPlatform,
    })
    .from(users)
    .where(q ? ilike(users.username, `%${q}%`) : undefined)
    .orderBy(users.id);

  return NextResponse.json({ users: rows, legacyCount: await countLegacyAdmins(), legacyMax: MAX_LEGACY_ADMINS });
}

interface PatchBody {
  userId: number;
  tier?: string;
  isAdmin?: boolean;
  isLegacyAdmin?: boolean;
  isBanned?: boolean;
  newPassword?: string;
}

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/**
 * PATCH /api/admin/users — change a user's tier, admin/legacy-admin flags,
 * ban state, or password.
 *
 * Legacy-admin rules (lib/admin-roles.ts):
 *  - Only a legacy admin can appoint or remove a legacy admin.
 *  - At most MAX_LEGACY_ADMINS (5) legacy admins at once.
 *  - At least one legacy admin must always remain.
 *  - A regular admin can't change anything on a legacy admin's account.
 */
export async function PATCH(req: NextRequest) {
  const { user: actor, res } = await requireAdmin();
  if (res) return res;

  const body = (await req.json()) as PatchBody;
  if (!body.userId || typeof body.userId !== "number") return bad("userId is required");

  const [target] = await db.select().from(users).where(eq(users.id, body.userId));
  if (!target) return bad("User not found", 404);

  if (target.isLegacyAdmin && !actor.isLegacyAdmin) {
    return bad("Only a legacy admin can change a legacy admin's account.", 403);
  }

  const patch: Partial<typeof users.$inferInsert> = {};
  const isSelf = body.userId === actor.id;

  if (body.tier !== undefined) {
    if (!isTier(body.tier)) return bad("Invalid tier");
    patch.tier = body.tier;
    patch.tierUpdatedAt = new Date();
  }

  // Removing admin also removes legacy admin.
  let removingLegacy = false;

  if (body.isAdmin !== undefined) {
    if (typeof body.isAdmin !== "boolean") return bad("isAdmin must be a boolean");
    if (isSelf && body.isAdmin === false) return bad("You can't remove your own admin access");
    patch.isAdmin = body.isAdmin;
    if (body.isAdmin === false && target.isLegacyAdmin) {
      patch.isLegacyAdmin = false;
      removingLegacy = true;
    }
  }

  if (body.isLegacyAdmin !== undefined) {
    if (typeof body.isLegacyAdmin !== "boolean") return bad("isLegacyAdmin must be a boolean");
    if (!actor.isLegacyAdmin) return bad("Only a legacy admin can appoint or remove legacy admins.", 403);
    if (body.isLegacyAdmin && !target.isLegacyAdmin) {
      if (target.isBanned) return bad("Unban this account before making it a legacy admin.");
      if ((await countLegacyAdmins()) >= MAX_LEGACY_ADMINS) {
        return bad(`All ${MAX_LEGACY_ADMINS} legacy admin slots are full. Remove one first.`);
      }
      patch.isLegacyAdmin = true;
      patch.isAdmin = true;
    } else if (!body.isLegacyAdmin && target.isLegacyAdmin) {
      patch.isLegacyAdmin = false;
      removingLegacy = true;
    }
  }

  if (body.isBanned !== undefined) {
    if (typeof body.isBanned !== "boolean") return bad("isBanned must be a boolean");
    if (isSelf && body.isBanned) return bad("You can't ban your own account");
    patch.isBanned = body.isBanned;
    if (body.isBanned && target.isLegacyAdmin) {
      patch.isLegacyAdmin = false;
      removingLegacy = true;
    }
  }

  if (removingLegacy && (await countLegacyAdmins()) <= 1) {
    return bad("At least one legacy admin must remain. Appoint another legacy admin first.");
  }

  if (body.newPassword !== undefined) {
    if (typeof body.newPassword !== "string" || body.newPassword.length < 8) {
      return bad("Password must be at least 8 characters");
    }
    patch.passwordHash = hashPassword(body.newPassword);
  }

  if (Object.keys(patch).length === 0) return bad("Nothing to update");

  await db.update(users).set(patch).where(eq(users.id, body.userId));
  return NextResponse.json({ ok: true });
}

/** DELETE /api/admin/users?userId=123 — removes an account. Not your own; a legacy admin only by another legacy admin, and never the last one. */
export async function DELETE(req: NextRequest) {
  const { user: actor, res } = await requireAdmin();
  if (res) return res;

  const userId = Number(req.nextUrl.searchParams.get("userId"));
  if (!Number.isFinite(userId)) return bad("userId is required");
  if (userId === actor.id) return bad("You can't delete your own account");

  const [target] = await db.select({ isLegacyAdmin: users.isLegacyAdmin }).from(users).where(eq(users.id, userId));
  if (target?.isLegacyAdmin) {
    if (!actor.isLegacyAdmin) return bad("Only a legacy admin can delete a legacy admin.", 403);
    if ((await countLegacyAdmins()) <= 1) return bad("At least one legacy admin must remain.");
  }

  await db.delete(users).where(and(eq(users.id, userId), ne(users.id, actor.id)));
  return NextResponse.json({ ok: true });
}
