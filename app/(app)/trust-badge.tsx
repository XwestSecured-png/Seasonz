"use client";

import { useState } from "react";
import type { TrustTier } from "@/lib/prop-trust";

export interface TrustView {
  tier: TrustTier;
  adj?: number;
  hits?: number | null;
  of?: number | null;
  reasons?: string[];
}

const STYLE: Record<TrustTier, string> = {
  High: "bg-emerald-950 text-emerald-300 ring-emerald-800/60",
  Medium: "bg-amber-950 text-amber-300 ring-amber-800/60",
  Low: "bg-neutral-800 text-neutral-400 ring-neutral-700",
};
const BARS: Record<TrustTier, number> = { High: 3, Medium: 2, Low: 1 };

/** "High / Medium / Low trust" pill; tap for why. */
export function TrustBadge({ trust, label = "trust", compact = false }: { trust: TrustView | null | undefined; label?: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!trust) return null;
  const why = [
    ...(trust.adj != null ? [`Picks like this hit about ${Math.round(trust.adj * 100)}% in testing`] : []),
    ...(trust.reasons ?? []),
  ];
  return (
    <span className="relative inline-flex">
      {/* A span, not a button: badges sit inside other buttons and links. */}
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            setOpen((o) => !o);
          }
        }}
        title={why.join(" · ")}
        aria-label={`${trust.tier} ${label}. ${why.join(". ")}`}
        className={`inline-flex cursor-pointer items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${STYLE[trust.tier]}`}
      >
        <span className="inline-flex items-end gap-px" aria-hidden>
          {[1, 2, 3].map((i) => (
            <span key={i} className={`w-0.5 rounded-sm ${i <= BARS[trust.tier] ? "bg-current" : "bg-current opacity-25"}`} style={{ height: 3 + i * 2 }} />
          ))}
        </span>
        {compact ? `${trust.tier} trust` : `${trust.tier} ${label}`}
      </span>
      {open && why.length > 0 && (
        <span className="absolute right-0 top-full z-20 mt-1 w-64 rounded-md border border-neutral-700 bg-neutral-900 p-2 text-left text-[11px] font-normal text-neutral-300 shadow-lg">
          {why.map((w) => (
            <span key={w} className="block py-0.5">
              • {w}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
