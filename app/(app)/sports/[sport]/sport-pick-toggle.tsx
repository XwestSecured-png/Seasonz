"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { SportKey } from "@/lib/sports/types";

/**
 * Game-winner pick toggle for a non-NFL sport's game — same component as
 * app/(app)/model-tracker/pick-toggle.tsx, just posting to /api/sport-picks
 * with a sport tag instead of /api/picks.
 */
export function SportPickToggle({
  sport,
  gameId,
  homeTeam,
  awayTeam,
  currentPick,
  locked,
}: {
  sport: SportKey;
  gameId: number;
  homeTeam: string;
  awayTeam: string;
  currentPick: string | null;
  locked: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [pick, setPick] = useState(currentPick);
  const [justLocked, setJustLocked] = useState(false);
  const router = useRouter();

  const choose = (team: string) => {
    if (locked) return;
    const prev = pick;
    const next = pick === team ? null : team; // tap again to clear your pick
    setPick(next);
    startTransition(async () => {
      const res = await fetch("/api/sport-picks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sport, gameId, team: next }),
      });
      if (!res.ok) {
        setPick(prev);
        if (res.status === 403) setJustLocked(true);
      }
      router.refresh();
    });
  };

  const btnClass = (team: string) =>
    `px-2 py-0.5 rounded text-xs font-medium transition-colors ${
      pick === team
        ? "bg-sky-600 text-white"
        : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
    } ${locked ? "opacity-50 cursor-not-allowed" : ""}`;

  return (
    <div className="flex gap-1">
      <button
        type="button"
        disabled={locked || isPending}
        onClick={() => choose(awayTeam)}
        className={btnClass(awayTeam)}
      >
        {awayTeam}
      </button>
      <button
        type="button"
        disabled={locked || isPending}
        onClick={() => choose(homeTeam)}
        className={btnClass(homeTeam)}
      >
        {homeTeam}
      </button>
      {justLocked && (
        <span className="text-[10px] text-amber-500 self-center ml-1">
          Just locked
        </span>
      )}
    </div>
  );
}
