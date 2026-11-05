import type { VenueInfo } from "@/lib/sports/venue";

/** "📍 Gerald J. Ford Stadium · Dallas, TX" (+ "Neutral site" chip). */
export function VenueLine({ venue, className = "" }: { venue: VenueInfo | null | undefined; className?: string }) {
  if (!venue) return null;
  return (
    <div className={`flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-400 ${className}`}>
      <span className="inline-flex items-center gap-1 min-w-0">
        <svg viewBox="0 0 24 24" className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M12 21s-6.5-5.7-6.5-11a6.5 6.5 0 0 1 13 0c0 5.3-6.5 11-6.5 11Z" />
          <circle cx="12" cy="10" r="2.3" />
        </svg>
        <span className="truncate">{venue.label}</span>
      </span>
      {venue.neutral && <span className="rounded border border-violet-500/40 bg-violet-500/10 px-1 py-px text-[10px] text-violet-200">Neutral site</span>}
    </div>
  );
}
