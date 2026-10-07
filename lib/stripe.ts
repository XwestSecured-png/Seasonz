// Stripe integration — Billing (subscriptions via Checkout Sessions +
// Customer Portal) and Identity (verification sessions). Replaced the
// earlier Braintree integration outright (see the project history if you
// need it — db/migrations/0017_stripe_billing_and_identity.sql is the
// migration that drops the Braintree columns and adds these).
//
// Required env vars (same pattern as DATABASE_URL — add to .env.local for
// local dev, and to the hosting provider's env vars for production):
//   STRIPE_SECRET_KEY            starts with sk_test_ or sk_live_
//   STRIPE_WEBHOOK_SECRET        starts with whsec_ — from the webhook
//                                 endpoint you create in the Stripe
//                                 Dashboard (Developers -> Webhooks),
//                                 pointed at /api/stripe/webhook
//   STRIPE_PRICE_ID_PRO          the recurring monthly Price id for the
//   STRIPE_PRICE_ID_SUPER_PRO    Pro / Super Pro Product in the Stripe
//                                 Dashboard — this is what actually sets
//                                 the billed price, NOT lib/tiers.ts's
//                                 displayed proPriceUsd/superProPriceUsd.
//
// Stripe's own best practice is a restricted API key (rk_...) scoped to
// just Checkout Sessions, Billing Portal, Subscriptions, Customers, and
// Identity VerificationSessions, rather than a full secret key — worth
// doing before going live (Dashboard -> Developers -> API keys -> Create
// restricted key).
import Stripe from "stripe";
import type { Tier } from "./tiers";

let client: Stripe | null = null;

/** The shared Stripe client — created once per server instance (same lazy-singleton pattern as db/index.ts's postgres client and the old lib/braintree.ts's gateway). */
export function getStripeClient(): Stripe {
  if (client) return client;

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set. Add it to .env.local (or your hosting provider's env vars)."
    );
  }

  client = new Stripe(key);
  return client;
}

/** The Stripe Price id billed for a given paid tier — one Product (with one recurring monthly Price) per tier, set up in the Stripe Dashboard. Throws for a tier whose env var isn't set. */
export function priceIdForTier(tier: Exclude<Tier, "free">): string {
  const envVar = tier === "pro" ? "STRIPE_PRICE_ID_PRO" : "STRIPE_PRICE_ID_SUPER_PRO";
  const priceId = process.env[envVar];
  if (!priceId) {
    throw new Error(
      `${envVar} isn't set — create a Product + recurring monthly Price for this tier in the Stripe Dashboard and add the Price id as ${envVar}.`
    );
  }
  return priceId;
}

/** The reverse of priceIdForTier — which tier a Stripe Price id bills for, used by the webhook handler to read a subscription's tier back out. Returns null for a price that doesn't match either configured tier (shouldn't happen for a subscription this app created, but webhooks can't be trusted to only ever reflect our own Checkout Sessions). */
export function tierForPriceId(priceId: string | null | undefined): Tier | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_ID_PRO) return "pro";
  if (priceId === process.env.STRIPE_PRICE_ID_SUPER_PRO) return "super_pro";
  return null;
}

/** An 8-random-lowercase-letter suffix for `integration_identifier` on Checkout Sessions, per Stripe's current best practice for tagging/comparing checkout flows in the Dashboard. */
export function randomIntegrationSuffix(): string {
  let s = "";
  for (let i = 0; i < 8; i++) {
    s += String.fromCharCode(97 + Math.floor(Math.random() * 26));
  }
  return s;
}
