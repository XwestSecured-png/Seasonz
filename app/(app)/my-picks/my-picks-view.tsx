"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { MyPick, PickStatus } from "@/lib/my-picks";
import { RecordView } from "./record-view";

const STATUS_STYLE: Record<PickStatus, string> = {
  pending: "bg-neutral-800 text-neutral-300",
  won: "bg-emerald-500/15 text-emerald-300",
  lost: "bg-red-500/15 text-red-300",
  push: "bg-neutral-700 text-neutral-200",
  void: "bg-neutral-700 text-neutral-400",
};
const STATUS_LABEL: Record<PickStatus, string> = { pending: "Pending", won: "Won", lost: "Lost", push: "Push", void: "Void" };

const ET = "America/New_York";
const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: ET }); // YYYY-MM-DD in ET
function dayLabel(key: string): string {
  const today = dayKey(new Date().toISOString());
  const shift = (d: number) => dayKey(new Date(Date.now() + d * 86_400_000).toISOString());
  const pretty = new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  if (key === today) return `Today · ${pretty}`;
  if (key === shift(1)) return `Tomorrow · ${pretty}`;
  if (key === shift(-1)) return `Yesterday · ${pretty}`;
  return pretty;
}
const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: ET }) + " ET";

interface DayGroup {
  key: string;
  label: string;
  slots: { time: string; picks: MyPick[] }[];
  count: number;
}
/** Picks grouped by ET date, then by start time, in the list's existing order. */
function groupByDayAndTime(list: MyPick[]): DayGroup[] {
  const days: DayGroup[] = [];
  for (const p of list) {
    const key = p.kickoffAt ? dayKey(p.kickoffAt) : "tbd";
    let day = days.find((d) => d.key === key);
    if (!day) {
      day = { key, label: key === "tbd" ? "Date TBD" : dayLabel(key), slots: [], count: 0 };
      days.push(day);
    }
    const time = p.kickoffAt ? timeLabel(p.kickoffAt) : "Time TBD";
    let slot = day.slots.find((x) => x.time === time);
    if (!slot) {
      slot = { time, picks: [] };
      day.slots.push(slot);
    }
    slot.picks.push(p);
    day.count++;
  }
  return days;
}

export function MyPicksView({ picks }: { picks: MyPick[] }) {
  const [view, setView] = useState<"upcoming" | "results" | "record">("upcoming");
  const [sport, setSport] = useState<string>("all");
  const [kind, setKind] = useState<"all" | "Game" | "Prop">("all");

  const sports = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of picks) m.set(p.sport, p.sportLabel);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [picks]);

  const filtered = useMemo(
    () => picks.filter((p) => (sport === "all" || p.sport === sport) && (kind === "all" || p.kind === kind)),
    [picks, sport, kind]
  );
  const upcoming = useMemo(
    () => filtered.filter((p) => p.status === "pending").sort((a, b) => (a.kickoffAt ?? "9").localeCompare(b.kickoffAt ?? "9")),
    [filtered]
  );
  const results = useMemo(
    () => filtered.filter((p) => p.status !== "pending").sort((a, b) => (b.kickoffAt ?? "").localeCompare(a.kickoffAt ?? "")),
    [filtered]
  );

  // Record for the current filter (preseason excluded).
  const record = useMemo(() => {
    const counted = results.filter((p) => !p.preseason);
    const won = counted.filter((p) => p.status === "won").length;
    const lost = counted.filter((p) => p.status === "lost").length;
    const push = counted.filter((p) => p.status === "push").length;
    const games = counted.filter((p) => p.kind === "Game" && p.model && (p.status === "won" || p.status === "lost"));
    const modelWon = games.filter((p) => (p.model!.agrees ? p.status === "won" : p.status === "lost")).length;
    return { won, lost, push, pct: won + lost ? (won / (won + lost)) * 100 : null, modelWon, modelGraded: games.length };
  }, [results]);

  const chip = (active: boolean) =>
    `rounded-full px-3 py-1 text-xs font-medium transition-colors ${
      active ? "bg-sky-600 text-white" : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
    }`;

  if (picks.length === 0) {
    return (
      <div className="rounded-md border border-neutral-800 p-4 text-sm text-neutral-400">
        No picks yet. Make a pick on the{" "}
        <Link href="/model-tracker" className="text-sky-400 hover:text-sky-300">
          NFL Model Tracker
        </Link>
        , any sport&rsquo;s page, or{" "}
        <Link href="/props" className="text-sky-400 hover:text-sky-300">
          Player Props
        </Link>
        , and it will show up here.
      </div>
    );
  }

  const list = view === "upcoming" ? upcoming : results;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Record" value={record.won + record.lost + record.push ? `${record.won}-${record.lost}${record.push ? `-${record.push}` : ""}` : "—"} />
        <Stat label="Win rate" value={record.pct !== null ? `${record.pct.toFixed(0)}%` : "—"} />
        <Stat label="Pending" value={String(upcoming.length)} />
      </div>
      {record.modelGraded > 0 && (
        <p className="text-xs text-neutral-500">
          On the same graded game picks, the model went {record.modelWon}-{record.modelGraded - record.modelWon}.
        </p>
      )}

      <div className="flex gap-1.5 flex-wrap">
        <button type="button" onClick={() => setView("upcoming")} className={chip(view === "upcoming")}>
          Upcoming <span className="opacity-60">{upcoming.length}</span>
        </button>
        <button type="button" onClick={() => setView("results")} className={chip(view === "results")}>
          Results <span className="opacity-60">{results.length}</span>
        </button>
        <button type="button" onClick={() => setView("record")} className={chip(view === "record")}>
          Record
        </button>
      </div>
      <div className="flex gap-2 flex-wrap">
        <select
          value={sport}
          onChange={(e) => setSport(e.target.value)}
          className="rounded-md bg-neutral-900 border border-neutral-800 px-2 py-1.5 text-sm text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
        >
          <option value="all">All sports</option>
          {sports.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
          className="rounded-md bg-neutral-900 border border-neutral-800 px-2 py-1.5 text-sm text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
        >
          <option value="all">Games &amp; props</option>
          <option value="Game">Game picks</option>
          <option value="Prop">Prop picks</option>
        </select>
      </div>

      {view === "record" ? (
        <RecordView picks={filtered} />
      ) : list.length === 0 ? (
        <p className="text-sm text-neutral-500">
          {view === "upcoming" ? "Nothing pending for this filter." : "No finished picks for this filter yet."}
        </p>
      ) : (
        <div className="space-y-5">
          {groupByDayAndTime(list.slice(0, 200)).map((day) => (
            <section key={day.key} className="space-y-2">
              <h2 className="sticky top-0 z-10 -mx-1 px-1 py-1 bg-neutral-950/95 backdrop-blur text-sm font-semibold text-neutral-200 border-b border-neutral-800">
                {day.label} <span className="text-xs font-normal text-neutral-500">· {day.count} pick{day.count === 1 ? "" : "s"}</span>
              </h2>
              {day.slots.map((slot) => (
                <div key={slot.time} className="space-y-1.5">
                  <div className="text-xs font-medium text-sky-400">{slot.time}</div>
                  <ul className="space-y-2">
                    {slot.picks.map((p) => (
                      <li key={p.key}>
                        <Link
                          href={p.href}
                          className="block rounded-md border border-neutral-800 px-3 py-2 hover:border-neutral-700 hover:bg-neutral-900/50 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-neutral-100">{p.pick}</div>
                              <div className="text-xs text-neutral-500">
                                <span className="text-neutral-400">{p.sportLabel}</span> · {p.kind} · {p.matchup}
                                {p.preseason && <span className="ml-1 text-amber-300">· Preseason</span>}
                              </div>
                            </div>
                            <span className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[p.status]}`}>
                              {STATUS_LABEL[p.status]}
                            </span>
                          </div>
                          {(p.result || p.model) && (
                            <div className="mt-1 text-xs text-neutral-400 flex flex-wrap gap-x-3">
                              {p.result && <span>{p.result}</span>}
                              {p.model && (
                                <span className={p.model.agrees ? "text-sky-400" : "text-amber-400"}>
                                  Model: {p.model.side} {Math.round(p.model.pct * 100)}%{p.model.agrees ? " (agrees)" : " (disagrees)"}
                                </span>
                              )}
                            </div>
                          )}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ))}
          {list.length > 200 && <p className="text-xs text-neutral-500">Showing the latest 200. Filter by sport to see more.</p>}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-neutral-800 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="text-base font-semibold text-neutral-100">{value}</div>
    </div>
  );
}
