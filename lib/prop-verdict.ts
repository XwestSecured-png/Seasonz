// Plain-English verdicts for a prop's chance of hitting (client-safe).
export type VerdictTone = "great" | "good" | "lean" | "even" | "weak" | "bad";

export interface Verdict {
  label: string;
  tone: VerdictTone;
}

/** What a side's chance of hitting means, in words. */
export function verdictFor(chance: number): Verdict {
  if (chance >= 0.9) return { label: "Very, very likely to hit", tone: "great" };
  if (chance >= 0.8) return { label: "Very likely to hit", tone: "great" };
  if (chance >= 0.7) return { label: "Likely to hit", tone: "good" };
  if (chance >= 0.58) return { label: "Leans toward hitting", tone: "lean" };
  if (chance > 0.42) return { label: "Toss-up", tone: "even" };
  if (chance > 0.3) return { label: "Leans toward missing", tone: "weak" };
  if (chance > 0.2) return { label: "Unlikely to hit", tone: "weak" };
  if (chance > 0.1) return { label: "Very unlikely to hit", tone: "bad" };
  return { label: "Almost no chance of hitting", tone: "bad" };
}

export const VERDICT_CLASS: Record<VerdictTone, string> = {
  great: "text-emerald-300",
  good: "text-emerald-400",
  lean: "text-sky-300",
  even: "text-neutral-300",
  weak: "text-amber-300",
  bad: "text-rose-400",
};
