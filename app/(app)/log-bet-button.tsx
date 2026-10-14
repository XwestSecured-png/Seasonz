"use client";

import Link from "next/link";
import { useState } from "react";

/** One bet the button can log, prefilled from the pick it sits next to. */
export interface BetOption {
  label: string; // shown in the picker, e.g. "LAL ML -150"
  sport: string; // "nfl" | SportKey | "multi"
  market: "ML" | "SPREAD" | "TOTAL" | "PROP" | "PARLAY";
  selection: string;
  line?: number | null; // SPREAD: the HOME spread; TOTAL: the total; PROP: the prop line
  priceAmerican: number | null;
  gameId?: number | null; // NFL
  sportGameId?: number | null; // other sports
  description?: string;
  prop?: { player: string; statType: string; line: number; side: "Over" | "Under" };
}

/**
 * "Log bet": one tap opens a tiny form (price prefilled, stake) and records
 * the bet in the Bet Tracker, where it's graded automatically.
 */
export function LogBetButton({ options, compact = false }: { options: BetOption[]; compact?: boolean }) {
  const usable = options.filter((o) => o.priceAmerican != null);
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const [price, setPrice] = useState("");
  const [stake, setStake] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  if (usable.length === 0) return null;
  const opt = usable[Math.min(idx, usable.length - 1)];

  const start = () => {
    setOpen(true);
    setState("idle");
    setError(null);
    setPrice(String(opt.priceAmerican ?? ""));
  };
  const choose = (i: number) => {
    setIdx(i);
    setPrice(String(usable[i].priceAmerican ?? ""));
  };
  const save = async () => {
    setState("saving");
    setError(null);
    try {
      const res = await fetch("/api/bets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...opt, priceAmerican: Number(price), stakeUsd: Number(stake), label: undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Couldn't log it (${res.status})`);
      setState("done");
    } catch (e) {
      setState("error");
      setError(e instanceof Error ? e.message : "Couldn't log it");
    }
  };

  if (state === "done") {
    return (
      <span className="text-xs text-emerald-400">
        Logged ✓{" "}
        <Link href="/bet-tracker" className="underline hover:text-emerald-300">
          Bet Tracker
        </Link>
      </span>
    );
  }
  if (!open) {
    return (
      <button
        type="button"
        onClick={start}
        className={`rounded-md border border-neutral-700 text-neutral-300 hover:bg-neutral-800 ${compact ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs"}`}
      >
        💵 Log bet
      </button>
    );
  }
  const input = "rounded-md bg-neutral-900 border border-neutral-700 px-2 py-1 text-xs text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-600";
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs" onClick={(e) => e.preventDefault()}>
      {usable.length > 1 ? (
        <select value={idx} onChange={(e) => choose(Number(e.target.value))} className={input}>
          {usable.map((o, i) => (
            <option key={i} value={i}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <span className="text-neutral-300">{opt.label}</span>
      )}
      <label className="flex items-center gap-1 text-neutral-500">
        Price
        <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="numeric" className={`${input} w-16`} aria-label="American odds" />
      </label>
      <label className="flex items-center gap-1 text-neutral-500">
        $
        <input
          value={stake}
          onChange={(e) => setStake(e.target.value)}
          inputMode="decimal"
          placeholder="Stake"
          className={`${input} w-16`}
          aria-label="Stake in dollars"
        />
      </label>
      <button
        type="button"
        onClick={save}
        disabled={state === "saving" || !stake || !price}
        className="rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-2.5 py-1 font-medium text-white"
      >
        {state === "saving" ? "…" : "Log"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-neutral-500 hover:text-neutral-300 px-1">
        Cancel
      </button>
      {error && <span className="w-full text-red-400">{error}</span>}
    </div>
  );
}
