import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { promoCodes, users } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin-roles";
import { generatePromoCode, isPromoMonths, normalizePromoCode, PROMO_MONTHS } from "@/lib/promo";
import { isTier } from "@/lib/tiers";

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** GET — every promo code with who created/approved it. */
export async function GET() {
  const { res } = await requireAdmin();
  if (res) return res;
  const rows = await db.select().from(promoCodes).orderBy(desc(promoCodes.createdAt));
  const people = await db.select({ id: users.id, username: users.username }).from(users);
  const name = new Map(people.map((p) => [p.id, p.username]));
  const who = (id: number | null) => (id == null ? null : name.get(id) ?? `#${id}`);
  return NextResponse.json({
    codes: rows.map((r) => ({
      ...r,
      createdBy: who(r.createdById),
      adminApprovedBy: who(r.adminApprovedById),
      legacyApprovedBy: who(r.legacyApprovedById),
      closedBy: who(r.closedById),
    })),
  });
}

/** POST { months, tier?, maxRedemptions?, note?, code? } — create a promo code. It starts as pending_admin and can't be redeemed until both approvals are in. */
export async function POST(req: NextRequest) {
  const { user, res } = await requireAdmin();
  if (res) return res;
  const body = (await req.json()) as {
    months?: number;
    tier?: string;
    maxRedemptions?: number;
    note?: string;
    code?: string;
  };
  if (!isPromoMonths(body.months)) return bad(`months must be one of ${PROMO_MONTHS.join(", ")}`);
  const tier = body.tier ?? "pro";
  if (!isTier(tier) || tier === "free") return bad("tier must be pro or super_pro");
  const maxRedemptions = Math.floor(body.maxRedemptions ?? 1);
  if (!Number.isFinite(maxRedemptions) || maxRedemptions < 1 || maxRedemptions > 10000) {
    return bad("maxRedemptions must be between 1 and 10000");
  }
  let code = body.code ? normalizePromoCode(body.code) : generatePromoCode(body.months);
  if (!/^[A-Z0-9-]{4,32}$/.test(code)) return bad("Codes are 4-32 letters, numbers, or dashes");

  const [row] = await db
    .insert(promoCodes)
    .values({
      code,
      months: body.months,
      tier,
      maxRedemptions,
      note: body.note?.trim().slice(0, 200) || null,
      createdById: user.id,
    })
    .onConflictDoNothing()
    .returning();
  if (!row) return bad("That code already exists");
  code = row.code;
  return NextResponse.json({ ok: true, code });
}

/**
 * PATCH { id, action } — move a promo code through its approvals.
 *   approve (pending_admin)  -> any admin except the creator
 *   approve (pending_legacy) -> any legacy admin except the first approver
 *   reject  (either pending) -> any admin
 *   revoke  (active)         -> legacy admin
 */
export async function PATCH(req: NextRequest) {
  const { user: actor, res } = await requireAdmin();
  if (res) return res;
  const body = (await req.json()) as { id?: number; action?: string };
  if (typeof body.id !== "number") return bad("id is required");

  const [promo] = await db.select().from(promoCodes).where(eq(promoCodes.id, body.id));
  if (!promo) return bad("Promo code not found", 404);
  const now = new Date();

  // Each update is guarded on the expected status so two admins clicking at once can't double-approve.
  const move = async (from: string, set: Partial<typeof promoCodes.$inferInsert>) => {
    const done = await db
      .update(promoCodes)
      .set(set)
      .where(and(eq(promoCodes.id, promo.id), eq(promoCodes.status, from)))
      .returning({ id: promoCodes.id });
    return done.length > 0
      ? NextResponse.json({ ok: true })
      : bad("Someone else just changed this code. Refresh and try again.", 409);
  };

  switch (body.action) {
    case "approve":
      if (promo.status === "pending_admin") {
        if (promo.createdById === actor.id) {
          return bad("Another admin has to give the first approval. You can't approve a code you created.", 403);
        }
        return move("pending_admin", { status: "pending_legacy", adminApprovedById: actor.id, adminApprovedAt: now });
      }
      if (promo.status === "pending_legacy") {
        if (!actor.isLegacyAdmin) return bad("The final approval has to come from a legacy admin.", 403);
        if (promo.adminApprovedById === actor.id) {
          return bad("A different legacy admin has to give the final approval. You already gave the first one.", 403);
        }
        return move("pending_legacy", { status: "active", legacyApprovedById: actor.id, legacyApprovedAt: now });
      }
      return bad("This code isn't waiting on an approval.");
    case "reject":
      if (promo.status !== "pending_admin" && promo.status !== "pending_legacy") {
        return bad("Only pending codes can be rejected.");
      }
      return move(promo.status, { status: "rejected", closedById: actor.id, closedAt: now });
    case "revoke":
      if (promo.status !== "active") return bad("Only active codes can be revoked.");
      if (!actor.isLegacyAdmin) return bad("Only a legacy admin can revoke an active code.", 403);
      return move("active", { status: "revoked", closedById: actor.id, closedAt: now });
    default:
      return bad("action must be approve, reject, or revoke");
  }
}
