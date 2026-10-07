"use client";

import { useMemo, useState } from "react";
import { computePayout, type PriceLeg } from "@/lib/parlay-math";

function formatUsd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

/** Stake input + live potential payout/profit for a set of parlay legs. Used on saved parlay cards, Auto Parlay cards, and the builder's own live preview. */
export function PayoutCalc({
  legs,
  defaultStake = 20,
  compact = false,
}: {
  legs: PriceLeg[];
  defaultStake?: number;
  compact?: boolean;
}) {
  const [stake, setStake] = useState(String(defaultStake));

  const result = useMemo(() => computePayout(Number(stake), legs), [stake, legs]);

  if (legs.length === 0) return null;

  return (
    <div
      className={`flex items-center gap-2 flex-wrap ${compact ? "text-xs" : "text-sm"}`}
    >
      <label className="flex items-center gap-1.5 text-neutral-400">
        Stake
        <span className="text-neutral-600">$</span>
        <input
          type="number"
          min="0"
          step="1"
          value={stake}
          onChange={(e) => setStake(e.target.value)}
          className="w-16 rounded-md bg-neutral-900 border border-neutral-800 px-1.5 py-0.5 text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
        />
      </label>
      {result ? (
        <span className="text-emerald-400">
          Pays <strong>{formatUsd(result.payout)}</strong> (+{formatUsd(result.profit)} profit) at{" "}
          {result.decimalOdds.toFixed(2)}x
        </span>
      ) : (
        <span className="text-neutral-500">Enter a stake to see the potential payout.</span>
      )}
    </div>
  );
}
