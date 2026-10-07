import { getCurrentUser } from "@/lib/current-user";
import { getAppLimits } from "@/lib/app-settings";
import { TIER_LABELS, tierAtLeast } from "@/lib/tiers";
import { PageInfo } from "../page-info";
import { StripeCheckoutButton } from "./stripe-checkout-button";
import { ManageBillingButton } from "./manage-billing-button";
import { IdentityVerifyCard } from "./identity-verify-card";
import { PromoRedeemCard } from "./promo-redeem-card";

export const dynamic = "force-dynamic";

const FREE_FEATURES = [
  "Picks, props, game props, and the model's win-probability for every game",
  "Parlays and Bet Tracker, with a payout calculator",
  "TD Picks builder (3-leg) and Model's Top 3 Anytime-TD picks",
  "Push a bet slip to one sportsbook of your choice",
];

const PRO_FEATURES = [
  "Everything in Free",
  "Factor Performance, Injury Impact, and Elo Ratings pages",
  "Full 3-to-5-leg TD Picks builder and Model's Top 5 picks",
  "Push bet slips to prediction markets (Kalshi, Polymarket, and more) and Underdog too",
];

const SUPER_PRO_FEATURES = ["Everything in Pro", "Priority support", "Early access to new features"];

export default async function UpgradePage() {
  const user = await getCurrentUser();
  const tier = user?.tier ?? "free";
  // Billing buttons follow the PAID tier; promo time is shown separately.
  const paidTier = user?.baseTier ?? "free";
  const activePromo =
    user?.promoTier && user.promoExpiresAt && user.promoExpiresAt > new Date()
      ? { label: TIER_LABELS[user.promoTier], until: user.promoExpiresAt.toLocaleDateString("en-US") }
      : null;
  const limits = await getAppLimits();

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div>
          <h1 className="text-lg font-semibold">Upgrade</h1>
          <p className="max-w-2xl text-sm text-neutral-400">
            Free covers the core of the app. Pro unlocks the advanced analytics pages, the full
            TD Picks builder, and pushing to every platform.
          </p>
        </div>
        <PageInfo>
          <p>
            Subscriptions run through Stripe Checkout — card, Apple Pay, and whatever else Stripe
            shows as eligible for your location — and renew monthly until you cancel from the
            billing portal below. Canceling there takes effect per the portal&rsquo;s own setting
            (immediately, or at period end); nothing here overrides that.
          </p>
          <p>
            If you ever charge sales tax, VAT, or GST, that&rsquo;s a separate Stripe Tax setup
            step (an active registration per jurisdiction) — Stripe collects none of it
            automatically just because Checkout is live.
          </p>
        </PageInfo>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <PlanCard
          name="Free"
          price="$0"
          features={FREE_FEATURES}
          isCurrent={tier === "free"}
          action={
            paidTier !== "free" ? (
              <ManageBillingButton />
            ) : (
              <span className="text-xs text-neutral-600">Your current plan</span>
            )
          }
        />
        <PlanCard
          name={TIER_LABELS.pro}
          price={`$${limits.proPriceUsd}/mo`}
          features={PRO_FEATURES}
          isCurrent={tier === "pro"}
          highlighted
          action={
            paidTier === "pro" ? (
              <ManageBillingButton />
            ) : tierAtLeast(paidTier, "pro") ? (
              <span className="text-xs text-neutral-600">Included in your plan</span>
            ) : (
              <StripeCheckoutButton tier="pro" label={TIER_LABELS.pro} />
            )
          }
        />
        <PlanCard
          name={TIER_LABELS.super_pro}
          price={`$${limits.superProPriceUsd}/mo`}
          features={SUPER_PRO_FEATURES}
          isCurrent={tier === "super_pro"}
          action={
            paidTier === "super_pro" ? (
              <ManageBillingButton />
            ) : (
              <StripeCheckoutButton tier="super_pro" label={TIER_LABELS.super_pro} />
            )
          }
        />
      </div>

      <PromoRedeemCard activePromo={activePromo} />

      <IdentityVerifyCard initialStatus={user?.identityStatus ?? "unverified"} />
    </div>
  );
}

function PlanCard({
  name,
  price,
  features,
  isCurrent,
  highlighted = false,
  action,
}: {
  name: string;
  price: string;
  features: string[];
  isCurrent: boolean;
  highlighted?: boolean;
  action: React.ReactNode;
}) {
  return (
    <div
      className={`flex flex-col gap-3 rounded-md border p-4 ${
        highlighted ? "border-blue-700 bg-blue-950/20" : "border-neutral-800"
      }`}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-200">{name}</h2>
        {isCurrent && (
          <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-300">
            Current
          </span>
        )}
      </div>
      <div className="text-2xl font-semibold">{price}</div>
      <ul className="flex-1 space-y-1.5 text-xs text-neutral-400">
        {features.map((f) => (
          <li key={f} className="flex gap-1.5">
            <span className="text-neutral-600">•</span>
            {f}
          </li>
        ))}
      </ul>
      <div>{action}</div>
    </div>
  );
}
