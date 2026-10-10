import { combinedDecimalOdds, computePayout, decimalToAmerican } from "./parlay-math";

export interface BetSlipLeg {
  label: string;
  priceAmerican: number;
}

// Reference stake used only to show an example payout on the slip itself
// (same idea as a sportsbook quoting "$100 to win $X" next to a price) —
// not tied to any stake the user actually places.
const REFERENCE_STAKE = 100;

function formatPrice(priceAmerican: number): string {
  return `${priceAmerican > 0 ? "+" : ""}${priceAmerican}`;
}

function formatUsd(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Builds the plain-text bet-slip summary PushBetButton copies to the
 * clipboard — the user pastes/reads this to search and add each leg
 * themselves in their sportsbook app, since (unlike Gambly, which deep-links
 * straight into a pre-filled slip through private sportsbook partnerships we
 * don't have) no public API lets this app do that. Laid out like an actual
 * slip — numbered legs, a divider, the combined price, and a reference
 * payout — rather than a bare list, so what gets pasted reads the same way
 * a real bet slip does.
 */
export function formatBetSlipText(legs: BetSlipLeg[], title?: string): string {
  if (legs.length === 0) return "";

  const header = `🎯 ${title ?? "Bet slip"}`;
  const legCount = `${legs.length} leg${legs.length === 1 ? "" : "s"}`;
  const legLines = legs.map((l, i) => `${i + 1}. ${l.label}  ${formatPrice(l.priceAmerican)}`);

  const parts = [header, legCount, "", ...legLines];

  if (legs.length >= 2) {
    const combinedAmerican = decimalToAmerican(combinedDecimalOdds(legs));
    const payout = computePayout(REFERENCE_STAKE, legs);
    parts.push("────────────────");
    parts.push(`Combined odds: ${formatPrice(combinedAmerican)}`);
    if (payout) {
      parts.push(
        `${formatUsd(REFERENCE_STAKE)} → ${formatUsd(payout.payout)} (+${formatUsd(payout.profit)})`
      );
    }
  }

  parts.push("");
  parts.push("via Seasonz");

  return parts.join("\n");
}
