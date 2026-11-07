"use client";

import { useMemo, useState } from "react";
import type { LongShot } from "@/lib/long-shots";

type SortKey = "edge" | "model" | "market" | "bestPrice" | "teamRank" | "player" | "game" | "games";

const ET = "America/New_York";
const fmtPrice = (p: number | null) => (p == null ? "—" : p > 0 ? `+${p}` : String(p));
const fmtPct = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);
const kickoffLabel = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-US", { timeZone: ET, weekday: "short", hour: "numeric", minute: "2-digit" }) : "";

function Tag({ tone, children }: { tone: "star" | "thin" | "book" | "zero"; children: React.ReactNode }) {
  const cls = {
    star: "bg-emerald-500/15 text-emerald-300",
    thin: "bg-amber-500/15 text-amber-200",
    book: "bg-orange-500/15 text-orange-300",
    zero: "bg-neutral-700/60 text-neutral-300",
  }[tone];
  return <span className={`ml-1 rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ${cls}`}>{children}</span>;
}

export function LongShotsTable({ rows, oddsAt }: { rows: LongShot[]; oddsAt: string | null }) {
  const [q, setQ] = useState("");
  const [team, setTeam] = useState("");
  const [game, setGame] = useState("");
  const [hideStarters, setHideStarters] = useState(false);
  const [hideZero, setHideZero] = useState(false);
  const [hideStarted, setHideStarted] = useState(true);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "edge", dir: -1 });
  // Fixed when the page loads; good enough to tell which games have kicked off.
  const [loadedAt] = useState(() => Date.now());

  const teams = useMemo(() => [...new Set(rows.map((r) => r.team))].sort(), [rows]);
  const games = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const r of rows) if (r.game) m.set(r.game, r.kickoffAt);
    return [...m.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  }, [rows]);

  const started = (r: LongShot) => r.kickoffAt != null && new Date(r.kickoffAt).getTime() <= loadedAt;
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = rows.filter(
      (r) =>
        (!needle || r.player.toLowerCase().includes(needle)) &&
        (!team || r.team === team) &&
        (!game || r.game === game) &&
        !(hideStarters && r.teamRank <= 2) &&
        !(hideZero && r.model === 0) &&
        !(hideStarted && started(r))
    );
    const val = (r: LongShot): number | string => {
      switch (sort.key) {
        case "player":
          return r.player;
        case "game":
          return r.kickoffAt ?? "";
        default:
          return (r[sort.key] as number | null) ?? -999;
      }
    };
    return list.sort((a, b) => {
      const x = val(a);
      const y = val(b);
      return typeof x === "string" ? sort.dir * x.localeCompare(String(y)) : sort.dir * (x - (y as number));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, team, game, hideStarters, hideZero, hideStarted, sort]);

  const th = (key: SortKey, label: string, num = true) => (
    <th
      scope="col"
      aria-sort={sort.key === key ? (sort.dir < 0 ? "descending" : "ascending") : undefined}
      className={`sticky top-0 z-10 bg-neutral-950 px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap ${num ? "text-right" : "text-left"} ${sort.key === key ? "text-orange-300" : "text-neutral-400"}`}
    >
      <button
        type="button"
        className="uppercase"
        onClick={() => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: num ? -1 : 1 }))}
      >
        {label}
        {sort.key === key ? (sort.dir < 0 ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );

  const input = "rounded-md border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-sm text-neutral-100 min-w-0";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          id="ls-q"
          type="search"
          placeholder="Search player"
          aria-label="Search player"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className={`${input} flex-1 basis-40`}
        />
        <select id="ls-team" aria-label="Team" value={team} onChange={(e) => setTeam(e.target.value)} className={input}>
          <option value="">All teams</option>
          {teams.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select id="ls-game" aria-label="Game" value={game} onChange={(e) => setGame(e.target.value)} className={input}>
          <option value="">All games</option>
          {games.map(([g, k]) => (
            <option key={g} value={g}>
              {g} · {kickoffLabel(k)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-neutral-400">
        <label className="inline-flex items-center gap-1.5">
          <input id="ls-starters" type="checkbox" checked={hideStarters} onChange={(e) => setHideStarters(e.target.checked)} /> Hide starters
        </label>
        <label className="inline-flex items-center gap-1.5">
          <input id="ls-zero" type="checkbox" checked={hideZero} onChange={(e) => setHideZero(e.target.checked)} /> Hide 0% model
        </label>
        <label className="inline-flex items-center gap-1.5">
          <input id="ls-started" type="checkbox" checked={hideStarted} onChange={(e) => setHideStarted(e.target.checked)} /> Hide games already
          started
        </label>
        <span className="ml-auto tabular-nums">
          {shown.length} of {rows.length} players{oddsAt ? ` · odds ${oddsAt}` : ""}
        </span>
      </div>

      <div className="max-h-[70vh] overflow-auto rounded-lg border border-neutral-800 bg-neutral-950/70">
        <table className="w-full min-w-[720px] border-collapse text-sm tabular-nums">
          <thead>
            <tr className="border-b border-neutral-800">
              {th("player", "Player", false)}
              {th("game", "Game", false)}
              {th("teamRank", "Team rank")}
              {th("model", "Model")}
              {th("market", "Market")}
              {th("edge", "Edge")}
              {th("bestPrice", "Best price")}
              {th("games", "Games")}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={`${r.team}-${r.player}`} className={`border-b border-neutral-900 ${started(r) ? "opacity-50" : ""}`}>
                <td className="px-2.5 py-1.5 whitespace-nowrap">
                  <span className="font-semibold text-neutral-100">{r.player}</span> <span className="text-xs text-neutral-500">{r.team}</span>
                  {r.teamRank <= 2 && <Tag tone="star">Starter</Tag>}
                  {r.games < 8 && <Tag tone="thin">Thin</Tag>}
                  {r.books === 1 && <Tag tone="book">1 book</Tag>}
                  {r.model === 0 && <Tag tone="zero">No TD hist</Tag>}
                </td>
                <td className="px-2.5 py-1.5 whitespace-nowrap text-neutral-300">
                  {r.game ?? "—"} <span className="text-xs text-neutral-500">{kickoffLabel(r.kickoffAt)}</span>
                </td>
                <td className="px-2.5 py-1.5 text-right font-mono">{r.teamRank}</td>
                <td className="px-2.5 py-1.5 text-right font-mono">{fmtPct(r.model)}</td>
                <td className="px-2.5 py-1.5 text-right font-mono text-neutral-400">{fmtPct(r.market)}</td>
                <td
                  className={`px-2.5 py-1.5 text-right font-mono font-semibold ${r.edge == null ? "text-neutral-500" : r.edge > 0 ? "text-emerald-400" : "text-rose-400"}`}
                >
                  {r.edge == null ? "—" : `${r.edge > 0 ? "+" : ""}${r.edge.toFixed(1)}`}
                </td>
                <td className="px-2.5 py-1.5 text-right font-mono text-orange-300">{fmtPrice(r.bestPrice)}</td>
                <td className="px-2.5 py-1.5 text-right font-mono text-neutral-400">{r.games}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
