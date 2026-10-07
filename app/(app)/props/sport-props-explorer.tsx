"use client";

import { useMemo, useState } from "react";

export interface SportPropRow {
  id: number;
  player: string;
  team: string;
  statType: string;
  line: number;
  side: string;
  priceAmerican: number;
  book: string;
  projection: number | null;
  edgePct: number | null;
  modelWinPct: number | null;
  // Every sportsbook's price for this exact player/stat/line/side, best
  // price first (includes the one already shown as `book`/`priceAmerican`).
  otherBooks?: { book: string; priceAmerican: number }[];
}

function formatPrice(price: number | null): string {
  if (price === null) return "—";
  return price > 0 ? `+${price}` : `${price}`;
}

/**
 * Real, model-driven player props for every sport besides NFL — same
 * "compare lines against a real statistical projection" idea as NFL's
 * PropsExplorer (app/(app)/props/props-explorer.tsx), simplified since
 * these sports don't split into NFL's passing/rushing/receiving/defense
 * categories: just team -> player -> stat line, with the model's win% and
 * a "compare books" link on each one.
 */
export function SportPropsExplorer({
  picks,
  favTeam,
}: {
  picks: SportPropRow[];
  favTeam: { code: string; primary: string } | null;
}) {
  const teams = useMemo(() => Array.from(new Set(picks.map((p) => p.team))).sort(), [picks]);
  const statTypes = useMemo(() => Array.from(new Set(picks.map((p) => p.statType))).sort(), [picks]);

  const [team, setTeam] = useState("All");
  const [statType, setStatType] = useState("All");

  const filtered = picks.filter(
    (p) => (team === "All" || p.team === team) && (statType === "All" || p.statType === statType)
  );

  const grouped = new Map<string, Map<string, SportPropRow[]>>();
  for (const p of filtered) {
    const byPlayer = grouped.get(p.team) ?? new Map<string, SportPropRow[]>();
    const rows = byPlayer.get(p.player) ?? [];
    rows.push(p);
    byPlayer.set(p.player, rows);
    grouped.set(p.team, byPlayer);
  }
  const sortedTeams = Array.from(grouped.keys()).sort();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center">
        <label className="text-xs text-neutral-500 flex items-center gap-1.5">
          Team
          <select
            value={team}
            onChange={(e) => setTeam(e.target.value)}
            className="rounded-md bg-neutral-900 border border-neutral-800 px-2 py-1 text-sm text-neutral-200 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="All">All teams</option>
            {teams.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-neutral-500 flex items-center gap-1.5">
          Stat type
          <select
            value={statType}
            onChange={(e) => setStatType(e.target.value)}
            className="rounded-md bg-neutral-900 border border-neutral-800 px-2 py-1 text-sm text-neutral-200 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="All">All stat types</option>
            {statTypes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <span className="text-xs text-neutral-500">
          {filtered.length} of {picks.length} picks
        </span>
      </div>

      {sortedTeams.length === 0 ? (
        <p className="text-sm text-neutral-500">No picks match that filter.</p>
      ) : (
        sortedTeams.map((t) => {
          const byPlayer = grouped.get(t)!;
          const players = Array.from(byPlayer.keys()).sort();
          const isFavTeam = t === favTeam?.code;
          return (
            <div key={t} className="space-y-3">
              <h3
                className="text-sm font-semibold border-b pb-1 flex items-center gap-2"
                style={
                  isFavTeam
                    ? { color: favTeam!.primary, borderColor: favTeam!.primary }
                    : { color: "#e5e5e5", borderColor: "#262626" }
                }
              >
                {t}
                {isFavTeam && (
                  <span
                    className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: `${favTeam!.primary}26`, color: favTeam!.primary }}
                  >
                    Your team
                  </span>
                )}
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {players.map((player) => {
                  const rows = byPlayer.get(player)!;
                  return (
                    <div
                      key={player}
                      className="rounded-md border p-3 space-y-1.5"
                      style={
                        isFavTeam
                          ? { borderColor: `${favTeam!.primary}55`, backgroundColor: `${favTeam!.primary}0d` }
                          : { borderColor: "#262626" }
                      }
                    >
                      <div className="text-sm font-medium text-neutral-100">{player}</div>
                      <ul className="space-y-1">
                        {rows.map((r) => (
                          <li key={r.id} className="text-xs space-y-1">
                            <div className="text-neutral-400 flex items-center justify-between gap-2">
                              <span>
                                <span className={r.side === "Over" ? "text-emerald-400" : "text-rose-400"}>
                                  {r.side}
                                </span>{" "}
                                {r.line} {r.statType} · {formatPrice(r.priceAmerican)} @ {r.book}
                              </span>
                              <span className="text-neutral-500 shrink-0">
                                proj {r.projection?.toFixed(1) ?? "—"}
                                {r.modelWinPct !== null && (
                                  <>
                                    {" · "}
                                    <span className="text-emerald-400 font-medium">
                                      {(r.modelWinPct * 100).toFixed(0)}%
                                    </span>{" "}
                                    model win
                                  </>
                                )}
                              </span>
                            </div>
                            <CompareBooks books={r.otherBooks} currentBook={r.book} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

function CompareBooks({
  books,
  currentBook,
}: {
  books: { book: string; priceAmerican: number }[] | undefined;
  currentBook: string;
}) {
  const [open, setOpen] = useState(false);
  if (!books || books.length < 2) return null;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-[11px] text-blue-400 hover:text-blue-300"
      >
        {open ? "Hide" : "Compare"} {books.length} books
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5 pl-2 border-l border-neutral-800">
          {books.map((b) => (
            <li
              key={b.book}
              className={`flex items-center justify-between gap-3 ${
                b.book === currentBook ? "text-neutral-200" : "text-neutral-500"
              }`}
            >
              <span>{b.book}</span>
              <span className="font-mono">{formatPrice(b.priceAmerican)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
