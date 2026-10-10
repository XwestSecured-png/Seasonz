import type { Insight } from "@/lib/sports/insights";

function H({ children }: { children: React.ReactNode }) {
  return <div className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">{children}</div>;
}

/** Expandable "Why the model picks X" with every data point behind the pick. */
export function GameInsight({ insight: i }: { insight: Insight }) {
  return (
    <details className="group rounded-md border border-neutral-800 bg-neutral-950/50">
      <summary className="flex cursor-pointer list-none items-center justify-between px-2.5 py-1.5 text-xs text-orange-300 [&::-webkit-details-marker]:hidden">
        <span>
          Why {i.pick} ({Math.round(i.pickPct * 100)}%)
        </span>
        <span className="text-neutral-500 group-open:rotate-90 transition-transform">▸</span>
      </summary>
      <div className="space-y-1 border-t border-neutral-800 px-2.5 pb-3 pt-2 text-xs text-neutral-300">
        <ul className="list-disc space-y-1 pl-4">
          {i.reasons.map((r, k) => (
            <li key={k}>{r}</li>
          ))}
        </ul>

        {i.odds.length > 0 && (
          <>
            <H>Sportsbook lines</H>
            {i.odds.map((o) => (
              <div key={o.book} className="space-y-0.5">
                <div className="font-medium text-neutral-200">{o.book}</div>
                <div className="text-neutral-400">Moneyline: {o.ml}</div>
                <div className="text-neutral-400">Spread: {o.spread}</div>
                <div className="text-neutral-400">Total: {o.total}</div>
                {o.edge && <div className="text-neutral-300">{o.edge}</div>}
              </div>
            ))}
          </>
        )}

        {i.compare.length > 0 && (
          <>
            <H>Team comparison</H>
            {i.compareNote && <div className="text-[11px] text-neutral-500">{i.compareNote}</div>}
            <table className="w-full text-[11px]">
              <tbody>
                {i.compare.map((c) => (
                  <tr key={c.label} className="border-t border-neutral-900">
                    <td className="py-0.5 pr-2 text-neutral-500">{c.label}</td>
                    <td className={`py-0.5 pr-2 text-right ${c.edge === "away" ? "text-emerald-400" : ""}`}>{c.away}</td>
                    <td className={`py-0.5 text-right ${c.edge === "home" ? "text-emerald-400" : ""}`}>{c.home}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-[10px] text-neutral-600">Left: away team · Right: home team · Green: better side</div>
          </>
        )}

        <H>Injuries and suspensions</H>
        {i.injuries.length === 0 ? (
          <div className="text-neutral-500">No one listed on ESPN&rsquo;s injury report for either team.</div>
        ) : (
          <ul className="space-y-0.5">
            {i.injuries.map((p) => (
              <li key={p.team + p.player}>
                <span className="text-neutral-500">{p.team}</span> {p.player} — {p.status}
                {p.ppg ? ` (${p.ppg.toFixed(1)} ${i.injuryStat})` : ""}
              </li>
            ))}
          </ul>
        )}

        <H>Officiating crew</H>
        {i.officials ? (
          <>
            <div>{i.officials.names.join(", ")}</div>
            <ul className="list-disc space-y-0.5 pl-4 text-neutral-400">
              {i.officials.style.map((s, k) => (
                <li key={k}>{s}</li>
              ))}
            </ul>
          </>
        ) : (
          <div className="text-neutral-500">Not announced yet. The NBA posts crews the morning of the game; this fills in on the next sync.</div>
        )}

        <H>Schedule</H>
        <ul className="space-y-0.5">
          {i.schedule.map((s, k) => (
            <li key={k}>{s}</li>
          ))}
        </ul>

        <H>Last meetings</H>
        {i.meetings.length === 0 ? (
          <div className="text-neutral-500">No meetings in the last two seasons.</div>
        ) : (
          <ul className="space-y-0.5">
            {i.meetings.map((x, k) => (
              <li key={k}>
                <span className="text-neutral-500">{x.date}:</span> {x.text}
              </li>
            ))}
          </ul>
        )}
        <div className="pt-2 text-[10px] text-neutral-600">
          Sources: ESPN (schedule, box scores, injuries, officials) and FanDuel/BetMGM lines. No expert or columnist picks.
        </div>
      </div>
    </details>
  );
}
