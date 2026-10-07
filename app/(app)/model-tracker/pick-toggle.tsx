"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function PickToggle({
  gameId,
  homeTeam,
  awayTeam,
  currentPick,
  locked,
}: {
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
      const res = await fetch("/api/picks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameId, team: next }),
      });
      if (!res.ok) {
        // Most likely the lock window closed between page load and this tap
        // (e.g. the tab was open past kickoff - 5min). Roll the optimistic
        // update back and let the refresh below pick up the real, locked state.
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
