"use client";

import { useMemo } from "react";
import { chanceFromPrice, parlayChance, type SgpSport } from "@/lib/sgp";
import type { LegMeta } from "./leg-picker";

interface Leg {
  label: string;
  priceAmerican: string;
  meta?: LegMeta;
}

const pct = (p: number) => `${(p * 100).toFixed(p < 0.1 ? 1 : 0)}%`;

/**
 * Shown when two or more legs come from the same game: the slip's real
 * chance with the measured same-game links (lib/sgp.ts) next to the plain
 * multiplied chance a regular parlay assumes.
 */
export function SameGamePanel({ sport, legs }: { sport: SgpSport; legs: Leg[] }) {
  const result = useMemo(() => {
    const priced = legs
      .map((l) => ({ l, price: Number(l.priceAmerican) }))
      .filter(({ l, price }) => l.label.trim() && Number.isFinite(price) && price !== 0);
    if (priced.length < 2) return null;
    const counts = new Map<string, number>();
    for (const { l } of priced) if (l.meta) counts.set(l.meta.gameKey, (counts.get(l.meta.gameKey) ?? 0) + 1);
    if (![...counts.values()].some((c) => c >= 2)) return null;
    const sgpLegs = priced.map(({ l, price }, i) => ({
      ...(l.meta ?? { gameKey: `manual-${i}`, kind: "prop" as const }),
      prob: chanceFromPrice(price, l.meta?.fairPrice ?? false),
    }));
    const r = parlayChance(sport, sgpLegs);
    const labels = priced.map(({ l }) => l.label);
    return { ...r, labels };
  }, [sport, legs]);

  if (!result) return null;
  if (sport === "other") {
    return (
      <p className="mt-2 text-xs text-neutral-500">
        Same-game legs: links between hockey/baseball legs aren&rsquo;t measured yet, so they&rsquo;re treated as independent.
      </p>
    );
  }
  const ratio = result.correlated / Math.max(1e-9, result.independent);
  const up = ratio >= 1.03;
  const down = ratio <= 0.97;
  const s = result.strongest;
  return (
    <div className="mt-2 space-y-1 border-t border-neutral-800 pt-2 text-xs">
      <div className="font-medium text-neutral-300">Same-game legs</div>
      <div className="text-neutral-400">
        Chance all legs hit: <span className="text-neutral-100 font-medium">{pct(result.correlated)}</span> with same-game links
        {" · "}
        {pct(result.independent)} if they were independent
        {up && <span className="text-emerald-400"> ({ratio.toFixed(2)}× more likely — these legs tend to hit together)</span>}
        {down && <span className="text-amber-400"> ({ratio.toFixed(2)}× — these legs work against each other)</span>}
      </div>
      {s && Math.abs(s.r) >= 0.1 && (
        <div className="text-neutral-500">
          Strongest link: {result.labels[s.a]} &amp; {result.labels[s.b]} ({s.r > 0 ? "move together" : "pull apart"}, r = {s.r.toFixed(2)}).
        </div>
      )}
      <div className="text-neutral-500">
        {up
          ? "Sportsbooks know this too: a same-game parlay usually pays less than the multiplied odds above, so compare the book's SGP price with the chance here."
          : "Each leg's chance comes from its price with a typical book margin removed; links are measured from past box scores."}
        {result.simulations ? ` Based on ${result.simulations.toLocaleString()} simulated games.` : ""}
      </div>
    </div>
  );
}
