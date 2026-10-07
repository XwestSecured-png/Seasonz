import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/current-user";
import { getStripeClient } from "@/lib/stripe";

/**
 * POST — starts a Stripe Identity verification session for the signed-in
 * user and returns its hosted URL. Stripe's hosted flow handles document
 * capture and the selfie match; the outcome comes back asynchronously via
 * the identity.verification_session.* webhook events (see
 * app/api/stripe/webhook/route.ts), not on this request — don't treat a
 * successful redirect here as "verified".
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  let stripe;
  try {
    stripe = getStripeClient();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Identity verification isn't configured yet" },
      { status: 500 }
    );
  }

  const origin = req.nextUrl.origin;
  const session = await stripe.identity.verificationSessions.create({
    type: "document",
    metadata: { appUserId: String(user.id) },
    return_url: `${origin}/upgrade?identity=done`,
  });

  await db
    .update(users)
    .set({ stripeIdentitySessionId: session.id, identityStatus: "pending" })
    .where(eq(users.id, user.id));

  if (!session.url) {
    return NextResponse.json({ error: "Stripe did not return a verification URL" }, { status: 500 });
  }
  return NextResponse.json({ url: session.url });
}
