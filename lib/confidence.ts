// Turns the model's own win probability for a pick (always > 0.5 — a pick
// only exists where the model favors clearing the book's number) into the
// 0-100 "confidence score" shown next to every Best Bet, matching the
// convention used by most AI-picks apps (PropsBot's Confidence Score,
// PlayerProps.ai's BetScore, etc.) — see lib/game-picks.ts / lib/spread-total-picks.ts
// for where modelProb itself comes from.

export type ConfidenceTier = "low" | "medium" | "high";

// The app-wide "only show real confidence" bar: a pick (player prop leg,
// auto-parlay leg, or other-sport model favorite) only ever surfaces if the
// model's own win probability for it is at least this. Below this, a pick
// simply isn't generated/shown anywhere — not softened, not labeled
// "low confidence" — per the explicit house rule that nothing under 70%
// model confidence appears on the Dashboard, Props, or Parlays pages.
export const MIN_MODEL_WIN_PCT = 0.7;

export function confidenceScore(modelProb: number): number {
  return Math.round(Math.min(0.99, Math.max(0.5, modelProb)) * 100);
}

export function confidenceTier(score: number): ConfidenceTier {
  if (score >= 75) return "high";
  if (score >= 62) return "medium";
  return "low";
}

export const CONFIDENCE_TIER_CLASS: Record<ConfidenceTier, string> = {
  high: "bg-emerald-950 text-emerald-300",
  medium: "bg-amber-950 text-amber-300",
  low: "bg-neutral-800 text-neutral-400",
};
