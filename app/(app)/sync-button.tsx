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
  const [progress, setProgress] = useState<string | null>(null);
  const router = useRouter();

  // Each sport runs as its own request so a full "sync everything" never
  // hits the 5-minute serverless limit in one call.
  const ALL = ["nba", "wnba", "nhl", "mlb", "ncaaf", "ncaab"];
  const onClick = () => {
    setError(null);
    startTransition(async () => {
      const jobs: { label: string; params: URLSearchParams }[] = [];
      if (nfl) {
        jobs.push({ label: "NFL", params: new URLSearchParams({ season: String(season) }) });
      }
      const sportList = sports === "all" ? ALL : sports ? sports.split(",") : [];
      for (const sp of sportList) {
        jobs.push({
          label: sp.toUpperCase(),
          params: new URLSearchParams({ nfl: "false", sports: sp }),
        });
      }
      const failed: string[] = [];
      for (let i = 0; i < jobs.length; i++) {
        setProgress(`${jobs[i].label} (${i + 1}/${jobs.length})`);
        try {
          const res = await fetch(`/api/sync?${jobs[i].params.toString()}`, { method: "POST" });
          if (!res.ok && res.status !== 207) {
            const body = await res.json().catch(() => ({}));
            failed.push(`${jobs[i].label}: ${body.error || res.status}`);
          }
        } catch (e) {
          failed.push(`${jobs[i].label}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      setProgress(null);
      if (failed.length) setError(`Sync failed for ${failed.join(", ")}`);
      router.refresh();
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
        {isPending ? `Syncing${progress ? ` ${progress}` : "…"}` : label ?? "Sync now"}
      </button>
      {error && <span className="text-sm text-red-400">{error}</span>}
    </div>
  );
}
