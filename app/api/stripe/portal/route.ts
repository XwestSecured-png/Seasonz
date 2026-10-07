import { NextResponse, NextRequest } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/current-user";
import { getStripeClient } from "@/lib/stripe";

/**
 * POST — creates a Stripe Billing Portal session for the signed-in user and
 * returns its hosted URL. This is the self-service surface Stripe
 * recommends over building our own cancel/upgrade/payment-method-update
 * UI: from here the customer can cancel, change plans, or update their
 * card, and it all flows back through the webhook handler the same as any
 * other Stripe-initiated change.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const [row] = await db
    .select({ stripeCustomerId: users.stripeCustomerId })
    .from(users)
    .where(eq(users.id, user.id));

  if (!row?.stripeCustomerId) {
    return NextResponse.json(
      { error: "No billing account yet — subscribe to a paid tier first" },
      { status: 400 }
    );
  }

  let stripe;
  try {
    stripe = getStripeClient();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Billing isn't configured yet" },
      { status: 500 }
    );
  }

  const origin = req.nextUrl.origin;
  const session = await stripe.billingPortal.sessions.create({
    customer: row.stripeCustomerId,
    return_url: `${origin}/upgrade`,
  });

  return NextResponse.json({ url: session.url });
}
