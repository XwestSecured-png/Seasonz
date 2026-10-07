import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/current-user";
import { getStripeClient, priceIdForTier, randomIntegrationSuffix } from "@/lib/stripe";
import { isTier } from "@/lib/tiers";

/**
 * POST { tier: "pro" | "super_pro" } — creates (or reuses) this user's
 * Stripe customer and starts a subscription Checkout Session, returning its
 * hosted URL for the client to redirect to. No Stripe.js on this page at
 * all — Checkout Sessions in redirect mode need nothing but the URL.
 *
 * Per Stripe's current guidance we never pass `payment_method_types` —
 * omitting it lets Stripe show the best eligible payment methods per
 * customer (including Apple Pay automatically, once that's set up on the
 * Stripe side) with no code change needed here when methods change.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { tier?: string } | null;
  const tier = body?.tier;
  if (tier !== "pro" && tier !== "super_pro") {
    return NextResponse.json({ error: "tier must be \"pro\" or \"super_pro\"" }, { status: 400 });
  }
  if (!isTier(tier)) {
    return NextResponse.json({ error: "Invalid tier" }, { status: 400 });
  }

  let stripe;
  let priceId: string;
  try {
    stripe = getStripeClient();
    priceId = priceIdForTier(tier);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Billing isn't configured yet" },
      { status: 500 }
    );
  }

  const [row] = await db
    .select({ stripeCustomerId: users.stripeCustomerId })
    .from(users)
    .where(eq(users.id, user.id));

  let customerId = row?.stripeCustomerId ?? null;
  if (!customerId) {
    const customer = await stripe.customers.create({
      name: user.username,
      metadata: { appUserId: String(user.id) },
    });
    customerId = customer.id;
    await db.update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, user.id));
  }

  const origin = req.nextUrl.origin;
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/upgrade?success=1`,
    cancel_url: `${origin}/upgrade?canceled=1`,
    integration_identifier: `seasonz_${randomIntegrationSuffix()}`,
    subscription_data: {
      metadata: { appUserId: String(user.id) },
    },
    metadata: { appUserId: String(user.id) },
  });

  if (!session.url) {
    return NextResponse.json({ error: "Stripe did not return a Checkout URL" }, { status: 500 });
  }
  return NextResponse.json({ url: session.url });
}
