"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

/** Won / Lost / Push / Void for bets the app can't grade itself (parlays, unreadable props). */
export function SettleButtons({ id }: { id: number }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const settle = (result: string) =>
    startTransition(async () => {
      await fetch(`/api/bets?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ result }) });
      router.refresh();
    });
  const btn = "rounded px-1.5 py-0.5 text-[11px] font-medium disabled:opacity-50";
  return (
    <span className="flex gap-1">
      <button type="button" disabled={isPending} onClick={() => settle("WON")} className={`${btn} bg-emerald-500/15 text-emerald-300`}>
        Won
      </button>
      <button type="button" disabled={isPending} onClick={() => settle("LOST")} className={`${btn} bg-red-500/15 text-red-300`}>
        Lost
      </button>
      <button type="button" disabled={isPending} onClick={() => settle("PUSH")} className={`${btn} bg-neutral-700 text-neutral-200`}>
        Push
      </button>
      <button type="button" disabled={isPending} onClick={() => settle("VOID")} className={`${btn} bg-neutral-800 text-neutral-400`}>
        Void
      </button>
    </span>
  );
}
