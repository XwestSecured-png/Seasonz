// Sort options for the prop lists. "Biggest edge" (default, 1.32.0) ranks by
// how far our chance is above the market's own no-vig chance. "Most confident" ranks by the trust tier
// first (High, then Medium, then Low), then by the trust score's backtested
// hit chance (or our chance when there's no trust score yet), then our chance.
// Client-safe: no server imports.

export type PropSort = "edge" | "confidence" | "chance" | "price" | "team";

export const PROP_SORTS: { value: PropSort; label: string }[] = [
  { value: "edge", label: "Biggest edge vs market" },
  { value: "confidence", label: "Most confident" },
  { value: "chance", label: "Highest chance" },
  { value: "price", label: "Best payout" },
  { value: "team", label: "Team (A-Z)" },
];

const TIER_RANK: Record<string, number> = { High: 3, Medium: 2, Low: 1 };

export interface Sortable {
  trust?: { tier: string; adj?: number } | null;
  chance?: number | null;
  price?: number | null;
  /** The market's no-vig chance for the side (null when unknown). */
  market?: number | null;
}

/** Higher = shown first. */
export function sortScore(sort: PropSort, r: Sortable): number {
  switch (sort) {
    case "edge":
      // Our chance minus the market's: where graded picks have returned most
      // (+14% at 10+ points over the market vs +2-7% when close to it).
      return r.chance != null && r.market != null ? r.chance - r.market : -1 + (r.chance ?? 0) * 0.01;
    case "confidence":
      // Ties (same tier and trust score) go to the higher chance.
      return (r.trust ? (TIER_RANK[r.trust.tier] ?? 0) * 10 : 0) + (r.trust?.adj ?? r.chance ?? 0) + (r.chance ?? 0) * 0.01;
    case "chance":
      return r.chance ?? -1;
    case "price":
      return r.price ?? -100000;
    default:
      return 0;
  }
}
