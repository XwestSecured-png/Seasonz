"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

export function DeleteBetButton({ id }: { id: number }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const onClick = () => {
    startTransition(async () => {
      await fetch(`/api/bets?id=${id}`, { method: "DELETE" });
      router.refresh();
    });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPending}
      className="text-xs text-neutral-500 hover:text-red-400 disabled:opacity-50"
      title="Remove this bet (only works while it's still pending)"
    >
      {isPending ? "…" : "Remove"}
    </button>
  );
}
