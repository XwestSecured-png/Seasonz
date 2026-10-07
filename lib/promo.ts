// Seasonz free-time promo codes (3, 6, 9, or 12 months).
//
// Lifecycle (promo_codes.status):
//   pending_admin  -> created by any admin; waits for a regular-admin approval
//   pending_legacy -> approved by an admin other than the creator; waits for
//                     a legacy admin other than that first approver
//   active         -> fully approved; users can redeem it
//   rejected       -> turned down by any admin while pending
//   revoked        -> switched off by a legacy admin after going active
//
// Redeeming grants the code's tier (Pro by default) for `months`, stored on
// the user as promoTier/promoExpiresAt. lib/current-user.ts treats the user
// as the higher of their paid tier and an unexpired promo tier, so promo
// time never touches a real Stripe subscription.
import { randomInt } from "crypto";
import { db } from "@/db";
import { promoCodes, promoRedemptions, users } from "@/db/schema";
import { and, eq, lt, sql } from "drizzle-orm";
import { isTier, tierAtLeast, TIER_LABELS, type Tier } from "@/lib/tiers";

export const PROMO_MONTHS = [3, 6, 9, 12] as const;
export type PromoMonths = (typeof PROMO_MONTHS)[number];

export function isPromoMonths(n: unknown): n is PromoMonths {
  return typeof n === "number" && (PROMO_MONTHS as readonly number[]).includes(n);
}

export const PROMO_STATUS_LABELS: Record<string, string> = {
  pending_admin: "Waiting on admin approval",
  pending_legacy: "Waiting on legacy admin approval",
  active: "Active",
  rejected: "Rejected",
  revoked: "Revoked",
};

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generatePromoCode(months: number): string {
  let body = "";
  for (let i = 0; i < 6; i++) body += ALPHABET[randomInt(ALPHABET.length)];
  return `SZN${months}-${body}`;
}

export function normalizePromoCode(code: string): string {
  return code.trim().toUpperCase();
}

/** Calendar-month add (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(from: Date, months: number): Date {
  const d = new Date(from.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

export type RedeemResult =
  | { ok: true; tier: Tier; months: number; expiresAt: Date }
  | { ok: false; error: string };

/** Redeems an active promo code for `userId`. Safe to call concurrently — the redemption count is bumped with a guarded update. */
export async function redeemPromoCode(userId: number, rawCode: string): Promise<RedeemResult> {
  const code = normalizePromoCode(rawCode);
  if (!code) return { ok: false, error: "Enter a promo code." };

  return db.transaction(async (tx) => {
    const [promo] = await tx.select().from(promoCodes).where(eq(promoCodes.code, code));
    if (!promo || promo.status !== "active") {
      return { ok: false as const, error: "That promo code isn't valid or hasn't been approved yet." };
    }
    if (!isTier(promo.tier)) return { ok: false as const, error: "That promo code is misconfigured." };
    const promoTier: Tier = promo.tier;

    const [already] = await tx
      .select({ id: promoRedemptions.id })
      .from(promoRedemptions)
      .where(and(eq(promoRedemptions.promoCodeId, promo.id), eq(promoRedemptions.userId, userId)));
    if (already) return { ok: false as const, error: "You've already used this promo code." };

    const [user] = await tx.select().from(users).where(eq(users.id, userId));
    if (!user) return { ok: false as const, error: "Account not found." };

    const now = new Date();
    const current =
      user.promoTier && isTier(user.promoTier) && user.promoExpiresAt && user.promoExpiresAt > now
        ? { tier: user.promoTier as Tier, expiresAt: user.promoExpiresAt }
        : null;

    let start = now;
    if (current) {
      if (current.tier === promoTier) {
        start = current.expiresAt; // stack onto the time already left
      } else if (tierAtLeast(current.tier, promoTier)) {
        return {
          ok: false as const,
          error: `You already have free ${TIER_LABELS[current.tier]} until ${current.expiresAt.toLocaleDateString("en-US")}. Use this code after that ends.`,
        };
      }
    }
    const expiresAt = addMonths(start, promo.months);

    const bumped = await tx
      .update(promoCodes)
      .set({ redemptions: sql`${promoCodes.redemptions} + 1` })
      .where(
        and(
          eq(promoCodes.id, promo.id),
          eq(promoCodes.status, "active"),
          lt(promoCodes.redemptions, promoCodes.maxRedemptions)
        )
      )
      .returning({ id: promoCodes.id });
    if (bumped.length === 0) return { ok: false as const, error: "That promo code has been used up." };

    await tx.insert(promoRedemptions).values({ promoCodeId: promo.id, userId, expiresAt });
    await tx.update(users).set({ promoTier, promoExpiresAt: expiresAt }).where(eq(users.id, userId));

    return { ok: true as const, tier: promoTier, months: promo.months, expiresAt };
  });
}
