// Subscription tiers — shared, client-safe constants (no DB/next/headers
// imports here; lib/app-settings.ts and lib/entitlements.ts build on top of
// this for the server-only pieces). Kept as a plain string union rather
// than a Postgres enum (see db/schema.ts's users.tier comment) so adding a
// tier later never needs a migration.
export type Tier = "free" | "pro" | "super_pro";

export const TIER_ORDER: Tier[] = ["free", "pro", "super_pro"];

export const TIER_LABELS: Record<Tier, string> = {
  free: "Free",
  pro: "Pro",
  super_pro: "Super Pro",
};

/** True when `tier` is at least as high as `min` in TIER_ORDER (e.g. tierAtLeast("super_pro", "pro") === true). */
export function tierAtLeast(tier: Tier, min: Tier): boolean {
  return TIER_ORDER.indexOf(tier) >= TIER_ORDER.indexOf(min);
}

export function isTier(value: string): value is Tier {
  return (TIER_ORDER as string[]).includes(value);
}

// The Free-tier caps and the two paid tiers' displayed monthly prices —
// admin-editable at runtime (see lib/app-settings.ts), these are just the
// defaults a fresh install (or a row-less app_settings table) falls back
// to. Changing proPriceUsd/superProPriceUsd here only changes what the
// Upgrade page SHOWS — it does not change what Stripe actually charges
// an existing subscriber, since that's set by the Stripe Price itself
// (STRIPE_PRICE_ID_PRO / STRIPE_PRICE_ID_SUPER_PRO — see lib/stripe.ts) in
// the Stripe Dashboard. Keep these in sync with the real Price by hand.
export interface AppLimits {
  proPriceUsd: number;
  superProPriceUsd: number;
  // TD Picks builder's max legs for Free (Pro/Super Pro always get the
  // full 5 — see lib/entitlements.ts's tdPicksMaxLegs).
  freeTdPicksMaxLegs: number;
  // How many of the Model's Top 5 Anytime-TD picks a Free user sees (Pro/
  // Super Pro always see all 5 — see lib/entitlements.ts's topPicksCount).
  freeTopPicksCount: number;
}

export const DEFAULT_LIMITS: AppLimits = {
  proPriceUsd: 50,
  superProPriceUsd: 100,
  freeTdPicksMaxLegs: 3,
  freeTopPicksCount: 3,
};
