"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { PayoutCalc } from "./payout-calc";
import { PushBetButton } from "../push-bet-button";
import type { Sportsbook, SportsbookCategory } from "@/lib/sportsbooks";

interface StoredLeg {
  label: string;
  priceAmerican: number;
  winPct: number;
  result: "pending" | "won" | "lost" | "push";
}

const RESULTS: StoredLeg["result"][] = ["pending", "won", "lost", "push"];
const RESULT_LABEL: Record<StoredLeg["result"], string> = {
  pending: "Pending",
  won: "Won",
  lost: "Lost",
  push: "Push",
};

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-neutral-700/50 text-neutral-300",
  won: "bg-emerald-500/20 text-emerald-300",
  lost: "bg-rose-500/20 text-rose-300",
};

export function ParlayCard({
  id,
  title,
  legs,
  combinedWinPct,
  status,
  createdAt,
  sportsbookPrefs,
  allowedCategories,
}: {
  id: number;
  title: string | null;
  legs: StoredLeg[];
  combinedWinPct: number | null;
  status: string;
  createdAt: string;
  sportsbookPrefs: Sportsbook[];
  allowedCategories?: SportsbookCategory[];
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function grade(legIndex: number, result: StoredLeg["result"]) {
    startTransition(async () => {
      await fetch("/api/parlays", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, legIndex, result }),
      });
      router.refresh();
    });
  }

  function remove() {
    startTransition(async () => {
      await fetch("/api/parlays", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      router.refresh();
    });
  }

  return (
    <div className="rounded-md border border-neutral-800 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">
          {title || `${legs.length}-leg parlay`}
        </span>
        <div className="flex items-center gap-2">
          <span
            className={`text-xs px-2 py-0.5 rounded-full ${
              STATUS_BADGE[status] ?? STATUS_BADGE.pending
            }`}
          >
            {status === "pending" ? "Pending" : status === "won" ? "Won" : "Lost"}
          </span>
          <button
            type="button"
            onClick={remove}
            disabled={isPending}
            className="text-neutral-500 hover:text-neutral-300 text-xs"
          >
            Delete
          </button>
        </div>
      </div>
      <ul className="space-y-1.5">
        {legs.map((leg, i) => (
          <li key={i} className="flex items-center justify-between gap-2 flex-wrap text-xs">
            <span className="text-neutral-300">
              {leg.label}{" "}
              <span className="text-neutral-500">
                ({leg.priceAmerican > 0 ? "+" : ""}
                {leg.priceAmerican})
              </span>
            </span>
            <div className="flex gap-1">
              {RESULTS.map((r) => (
                <button
                  key={r}
                  type="button"
                  disabled={isPending}
                  onClick={() => grade(i, r)}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                    leg.result === r
                      ? r === "won"
                        ? "bg-emerald-600 text-white"
                        : r === "lost"
                          ? "bg-rose-600 text-white"
                          : r === "push"
                            ? "bg-amber-600 text-white"
                            : "bg-neutral-600 text-white"
                      : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
                  }`}
                >
                  {RESULT_LABEL[r]}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <div className="text-xs text-neutral-500 pt-1 border-t border-neutral-800 space-y-1.5">
        <div>
          Combined win%: {combinedWinPct !== null ? `${(combinedWinPct * 100).toFixed(1)}%` : "—"}
        </div>
        <PayoutCalc legs={legs} compact />
        <PushBetButton
          legs={legs.map((leg) => ({ label: leg.label, priceAmerican: leg.priceAmerican }))}
          title={title ?? undefined}
          sportsbookPrefs={sportsbookPrefs}
          allowedCategories={allowedCategories}
          alreadyTracked
          compact
        />
      </div>
    </div>
  );
}
