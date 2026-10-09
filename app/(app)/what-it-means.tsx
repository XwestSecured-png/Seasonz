"use client";

import Link from "next/link";
import { explainBet, type ExplainInput } from "@/lib/bet-explainer";

/**
 * "What it means" — a collapsible plain-English breakdown of one bet:
 * what has to happen to win, when it's a push, and what it pays.
 */
export function WhatItMeans({
  bet,
  defaultOpen = false,
  compact = false,
}: {
  bet: ExplainInput;
  defaultOpen?: boolean;
  compact?: boolean;
}) {
  const e = explainBet(bet);
  return (
    <details
      open={defaultOpen}
      className={`group rounded-md border border-emerald-900/60 bg-emerald-950/20 ${compact ? "text-xs" : "text-sm"}`}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 font-medium text-emerald-300 [&::-webkit-details-marker]:hidden">
        <span className="text-emerald-500 transition-transform group-open:rotate-90">▸</span>
        What it means
        {!compact && <span className="font-normal text-neutral-500">· {e.title}</span>}
      </summary>
      <div className="space-y-1.5 px-3 pb-3 text-neutral-300">
        <Row label="You win if" tone="text-emerald-400" text={e.win} />
        <Row label="You lose if" tone="text-red-400" text={e.lose} />
        {e.push && <Row label="Push" tone="text-amber-400" text={e.push} />}
        {e.alternate && <Row label="Alt line" tone="text-sky-400" text={e.alternate} />}
        {e.payout && <Row label="Payout" tone="text-neutral-400" text={e.payout} />}
        {e.odds && <Row label="The odds" tone="text-neutral-400" text={e.odds} />}
        <Link prefetch={false} href="/learn" className="inline-block pt-1 text-xs text-emerald-400 underline underline-offset-2 hover:text-emerald-300">
          Learn how every bet type works →
        </Link>
      </div>
    </details>
  );
}

function Row({ label, text, tone }: { label: string; text: string; tone: string }) {
  return (
    <p>
      <span className={`mr-1.5 font-medium ${tone}`}>{label}:</span>
      {text}
    </p>
  );
}
