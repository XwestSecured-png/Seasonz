import { verdictFor, VERDICT_CLASS } from "@/lib/prop-verdict";

/** "82% · Very likely to hit" — the chance a side hits, spelled out. */
export function Verdict({ chance, showPct = true, className = "" }: { chance: number; showPct?: boolean; className?: string }) {
  const v = verdictFor(chance);
  return (
    <span className={`whitespace-nowrap ${VERDICT_CLASS[v.tone]} ${className}`}>
      {showPct && <span className="font-semibold">{Math.round(chance * 100)}%</span>}
      {showPct && " · "}
      {v.label}
    </span>
  );
}
