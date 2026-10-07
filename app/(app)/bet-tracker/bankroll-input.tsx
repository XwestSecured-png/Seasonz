"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function BankrollInput({ current }: { current: number | null }) {
  const [value, setValue] = useState(current !== null ? String(current) : "");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const save = () => {
    startTransition(async () => {
      await fetch("/api/bankroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankrollUsd: value === "" ? null : Number(value) }),
      });
      router.refresh();
    });
  };

  return (
    <div className="flex items-center gap-2 text-sm">
      <label className="text-neutral-400" htmlFor="bankroll-input">
        Bankroll ($)
      </label>
      <input
        id="bankroll-input"
        type="number"
        min="0"
        step="50"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Optional — turns % suggestions into $"
        className="w-56 rounded-md bg-neutral-900 border border-neutral-800 px-2 py-1 text-neutral-100"
      />
      <button
        type="button"
        onClick={save}
        disabled={isPending}
        className="rounded-md border border-neutral-800 px-2.5 py-1 text-neutral-300 hover:bg-neutral-900 disabled:opacity-50"
      >
        {isPending ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
