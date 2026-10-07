// What each tier actually unlocks — the one place every gated page/button
// reads, so a future tier change (a new limit, a different cutoff) only
// means editing the function here rather than hunting down every call site.
import { tierAtLeast, type Tier, type AppLimits } from "./tiers";
import type { SportsbookCategory } from "./sportsbooks";

/** Factor Performance, Injury Impact, and Elo Ratings — Pro and up only. */
export function canViewAdvancedAnalytics(tier: Tier): boolean {
  return tierAtLeast(tier, "pro");
}

/** TD Picks builder's leg cap — Free is capped at limits.freeTdPicksMaxLegs (3), Pro/Super Pro always get the full 5-leg builder. */
export function tdPicksMaxLegs(tier: Tier, limits: AppLimits): number {
  return tierAtLeast(tier, "pro") ? 5 : limits.freeTdPicksMaxLegs;
}

/** How many of the Model's Top 5 Anytime-TD picks to show — Free sees limits.freeTopPicksCount (3), Pro/Super Pro see all 5. */
export function topPicksCount(tier: Tier, limits: AppLimits): number {
  return tierAtLeast(tier, "pro") ? 5 : limits.freeTopPicksCount;
}

/** Which Sportsbook platform categories (lib/sportsbooks.ts) this tier can push bet slips to — Free is restricted to regular Sportsbooks (one of their choice); Pro/Super Pro also unlock prediction markets and Underdog. */
export function allowedPlatformCategories(tier: Tier): SportsbookCategory[] {
  return tierAtLeast(tier, "pro")
    ? ["Sportsbooks", "Prediction markets", "Daily fantasy"]
    : ["Sportsbooks"];
}
