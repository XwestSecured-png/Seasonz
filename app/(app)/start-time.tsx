"use client";

// Game start time badge (1.40.0): "Today 7:30 PM ET · in 2h 15m", or
// "Live / started" once it's under way. Counts down every minute.
import { useEffect, useState } from "react";

const ET = "America/New_York";
const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: ET });

function label(start: Date, now: Date): { when: string; until: string; live: boolean; soon: boolean } {
  const time = start.toLocaleTimeString("en-US", { timeZone: ET, hour: "numeric", minute: "2-digit" });
  const today = dayKey(now);
  const tomorrow = dayKey(new Date(now.getTime() + 86_400_000));
  const d = dayKey(start);
  const day =
    d === today ? "Today" : d === tomorrow ? "Tomorrow" : start.toLocaleDateString("en-US", { timeZone: ET, weekday: "short", month: "short", day: "numeric" });
  const mins = Math.round((start.getTime() - now.getTime()) / 60_000);
  const until =
    mins <= 0 ? "" : mins < 60 ? `in ${mins}m` : mins < 48 * 60 ? `in ${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m` : `in ${Math.round(mins / 1440)}d`;
  return { when: `${day} ${time} ET`, until, live: mins <= 0, soon: mins > 0 && mins <= 60 };
}

export function StartTime({ iso }: { iso: string | null }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    // First tick right after mount (the server can't know the visitor's clock), then every minute.
    const first = window.setTimeout(() => setNow(new Date()), 0);
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(t);
    };
  }, []);
  if (!iso) return <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[11px] text-neutral-400">Time TBD</span>;
  const start = new Date(iso);
  // Before the clock is known on this device, show the fixed time only (no countdown).
  const l = now
    ? label(start, now)
    : {
        when: `${start.toLocaleString("en-US", { timeZone: ET, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ET`,
        until: "",
        live: false,
        soon: false,
      };
  const cls = l.live && now ? "bg-rose-500/15 text-rose-300 border-rose-500/30" : l.soon ? "bg-amber-500/15 text-amber-200 border-amber-500/30" : "bg-sky-500/10 text-sky-200 border-sky-500/25";
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${cls}`} title={start.toLocaleString("en-US", { timeZone: ET })}>
      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
      {l.when}
      {now && (l.live ? <span>· started</span> : l.until ? <span className="opacity-80">· {l.until}</span> : null)}
    </span>
  );
}
