import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getStripeClient, tierForPriceId } from "@/lib/stripe";

/**
 * Stripe's own guidance is explicit that this handler is NOT optional for a
 * subscription integration: renewals, failed payments, and cancellations
 * all happen asynchronously after Checkout, so an integration that only
 * reads the success page silently misses every one of them. Configure this
 * endpoint's URL (https://<your-domain>/api/stripe/webhook) in the Stripe
 * Dashboard under Developers -> Webhooks, and put its signing secret in
 * STRIPE_WEBHOOK_SECRET (see lib/stripe.ts).
 *
 * Events handled:
 *   checkout.session.completed / .async_payment_succeeded  — a subscription
 *     checkout finished; read the subscription back to set tier + status.
 *   customer.subscription.updated — plan change, renewal, or a status
 *     change (e.g. into "past_due") on an existing subscription.
 *   customer.subscription.deleted — the subscription actually ended
 *     (canceled, or expired after being unpaid) — drop the user to Free.
 *   invoice.payment_failed — logged; customer.subscription.updated also
 *     fires with status "past_due" and is what actually drives the UI.
 *   identity.verification_session.verified / .requires_input — Stripe
 *     Identity verification outcome.
 */
export async function POST(req: NextRequest) {
  const signature = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("STRIPE_WEBHOOK_SECRET is not set — refusing to process an unverifiable webhook.");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  const rawBody = await req.text();
  let event: Stripe.Event;
  try {
    const stripe = getStripeClient();
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.payment_status === "unpaid") break;
        if (session.mode !== "subscription" || !session.subscription) break;
        await syncSubscription(
          typeof session.subscription === "string" ? session.subscription : session.subscription.id,
          session.metadata?.appUserId ?? null,
          typeof session.customer === "string" ? session.customer : session.customer?.id ?? null
        );
        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.created": {
        const subscription = event.data.object as Stripe.Subscription;
        await syncSubscription(
          subscription.id,
          subscription.metadata?.appUserId ?? null,
          typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id
        );
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await dropToFree(
          subscription.metadata?.appUserId ?? null,
          typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
          subscription.status
        );
        break;
      }

      case "invoice.payment_failed": {
        // customer.subscription.updated (status -> "past_due") is what
        // actually drives the UI; this is just a log line for visibility.
        const invoice = event.data.object as Stripe.Invoice;
        console.warn("Stripe invoice payment failed:", invoice.id, invoice.customer);
        break;
      }

      case "identity.verification_session.verified":
      case "identity.verification_session.requires_input": {
        const session = event.data.object as Stripe.Identity.VerificationSession;
        const appUserId = session.metadata?.appUserId ? Number(session.metadata.appUserId) : null;
        if (appUserId && Number.isFinite(appUserId)) {
          await db
            .update(users)
            .set({
              identityStatus: event.type === "identity.verification_session.verified" ? "verified" : "failed",
            })
            .where(eq(users.id, appUserId));
        }
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error(`Error handling Stripe webhook event ${event.type}:`, err);
    return NextResponse.json({ error: "Webhook handler error" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

/** Reads a subscription's current price/status back from Stripe and writes the resulting tier onto whichever user it belongs to (by metadata.appUserId, falling back to a stripeCustomerId lookup for events that don't carry it). */
async function syncSubscription(subscriptionId: string, appUserId: string | null, customerId: string | null) {
  const stripe = getStripeClient();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const priceId = subscription.items.data[0]?.price?.id;
  const tier = tierForPriceId(priceId);
  if (!tier) {
    console.error("Stripe subscription's price doesn't match a known tier:", priceId);
    return;
  }

  const userId = await resolveUserId(appUserId, customerId);
  if (!userId) {
    console.error("Couldn't resolve which user a Stripe subscription event belongs to:", subscriptionId);
    return;
  }

  await db
    .update(users)
    .set({
      tier,
      tierUpdatedAt: new Date(),
      stripeSubscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
    })
    .where(eq(users.id, userId));
}

async function dropToFree(appUserId: string | null, customerId: string | null, status: string) {
  const userId = await resolveUserId(appUserId, customerId);
  if (!userId) {
    console.error("Couldn't resolve which user a Stripe subscription-deleted event belongs to");
    return;
  }
  await db
    .update(users)
    .set({ tier: "free", subscriptionStatus: status, tierUpdatedAt: new Date() })
    .where(eq(users.id, userId));
}

async function resolveUserId(appUserId: string | null, customerId: string | null): Promise<number | null> {
  if (appUserId) {
    const n = Number(appUserId);
    if (Number.isFinite(n)) return n;
  }
  if (customerId) {
    const [row] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.stripeCustomerId, customerId));
    if (row) return row.id;
  }
  return null;
}
