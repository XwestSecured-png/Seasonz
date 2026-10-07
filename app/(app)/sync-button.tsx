"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function SyncButton({
  season,
  sports,
  nfl = true,
  label,
}: {
  season: number;
  /** "all" | "nba" | "nba,nhl" etc — see app/api/sync/route.ts's `sports` param. Omit to leave the multi-sport pipeline untouched. */
  sports?: string;
  /** Pass false for a sport-only sync button (e.g. on an NBA page) so it doesn't also re-run the NFL pipeline. */
  nfl?: boolean;
  label?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const onClick = () => {
    setError(null);
    startTransition(async () => {
      try {
        const params = new URLSearchParams({ season: String(season) });
        if (sports) params.set("sports", sports);
        if (!nfl) params.set("nfl", "false");
        const res = await fetch(`/api/sync?${params.toString()}`, { method: "POST" });
        if (!res.ok && res.status !== 207) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Sync failed (${res.status})`);
        }
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onClick}
        disabled={isPending}
        style={{ backgroundColor: "var(--team-accent, #2563eb)" }}
        className="rounded-md hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity px-3 py-1.5 text-sm font-medium text-white"
      >
        {isPending ? "Syncing…" : label ?? "Sync now"}
      </button>
      {error && <span className="text-sm text-red-400">{error}</span>}
    </div>
  );
}
