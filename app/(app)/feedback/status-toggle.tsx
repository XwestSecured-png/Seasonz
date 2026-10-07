"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

export function StatusToggle({ id, status }: { id: number; status: string }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const toggle = () => {
    const next = status === "new" ? "reviewed" : "new";
    startTransition(async () => {
      await fetch("/api/feedback", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: next }),
      });
      router.refresh();
    });
  };

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={toggle}
      className={`shrink-0 text-xs px-2 py-0.5 rounded-full transition-colors ${
        status === "new"
          ? "bg-amber-950 text-amber-300 hover:bg-amber-900"
          : "bg-emerald-950 text-emerald-300 hover:bg-emerald-900"
      }`}
    >
      {status === "new" ? "New — mark reviewed" : "Reviewed"}
    </button>
  );
}
