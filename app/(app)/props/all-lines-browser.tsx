"use client";

import { useMemo, useState } from "react";
import { MODEL_FAIR_BOOK, fairAmerican, propLegLabel } from "@/lib/football-markets";

export interface RawLine {
  player: string;
  team: string | null;
  statType: string;
  line: number;
  side: string;
  book: string;
  priceAmerican: number;
}

const CATEGORY: Record<string, string> = {
  "Anytime TD": "Touchdowns",
  TDs: "Touchdowns",
  "2+ TDs": "Touchdowns",
  "First TD": "Touchdowns",
  "Last TD": "Touchdowns",
  "Pass TDs": "Touchdowns",
  "Rush TDs": "Touchdowns",
  "Rec TDs": "Touchdowns",
  "Rush + Rec TDs": "Touchdowns",
  "Pass Yds": "Quarterback",
  "Pass Attempts": "Quarterback",
  Completions: "Quarterback",
  "Longest Completion": "Quarterback",
  "Pass + Rush Yds": "Quarterback",
  "INTs Thrown": "Turnovers",
  "INT Thrown": "Turnovers",
  "Fumble Lost": "Turnovers",
  "QB Sacked": "Turnovers",
  "Rush Yds": "Rushing",
  "Rush Attempts": "Rushing",
  "Longest Rush": "Rushing",
  "Rush + Rec Yds": "Rushing",
  "Rec Yds": "Receiving",
  Receptions: "Receiving",
  "Longest Reception": "Receiving",
  Sacks: "Defense",
  "Anytime Sack": "Defense",
  "Solo Tackles": "Defense",
  "Tackles + Assists": "Defense",
  "Def INTs": "Defense",
  "Anytime INT": "Defense",
  "Field Goals": "Kicking",
  "Kicking Points": "Kicking",
  "Extra Points": "Kicking",
};
const CATEGORIES = ["Touchdowns", "Quarterback", "Rushing", "Receiving", "Turnovers", "Defense", "Kicking"];

const fmt = (p: number) => (p > 0 ? `+${p}` : `${p}`);
const implied = (p: number) => (p > 0 ? 100 / (p + 100) : -p / (-p + 100));

interface Grouped {
  key: string;
  player: string;
  team: string;
  statType: string;
  label: string;
  prices: { book: string; priceAmerican: number }[]; // best first
  modelPct: number | null;
}

/**
 * Every prop line posted this week (FanDuel, DraftKings, BetMGM, Caesars),
 * plus the model's fair price for props books rarely post, browsable by
 * category, team and player — best price first.
 */
export function AllLinesBrowser({ lines }: { lines: RawLine[] }) {
  const [category, setCategory] = useState<string>("Touchdowns");
  const [team, setTeam] = useState("");
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const map = new Map<string, Grouped>();
    for (const l of lines) {
      if (!l.team) continue;
      const key = `${l.player}|${l.statType}|${l.line}|${l.side}`;
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          player: l.player,
          team: l.team,
          statType: l.statType,
          label: propLegLabel(l.player, l.statType, l.side, l.line).slice(l.player.length + 1),
          prices: [],
          modelPct: null,
        };
        map.set(key, g);
      }
      if (l.book === MODEL_FAIR_BOOK) g.modelPct = implied(l.priceAmerican);
      else g.prices.push({ book: l.book, priceAmerican: l.priceAmerican });
    }
    for (const g of map.values()) g.prices.sort((a, b) => b.priceAmerican - a.priceAmerican);
    return Array.from(map.values());
  }, [lines]);

  const teams = useMemo(() => Array.from(new Set(groups.map((g) => g.team))).sort(), [groups]);
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const g of groups) {
      const cat = CATEGORY[g.statType] ?? "Other";
      c.set(cat, (c.get(cat) ?? 0) + 1);
    }
    return c;
  }, [groups]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groups
      .filter((g) => (CATEGORY[g.statType] ?? "Other") === category)
      .filter((g) => !team || g.team === team)
      .filter((g) => !q || g.player.toLowerCase().includes(q))
      // Hide the "No" side of yes/no props and Unders of 0.5 lines unless searching a player.
      .filter((g) => q || !g.label.startsWith("No "))
      .sort((a, b) => a.team.localeCompare(b.team) || a.player.localeCompare(b.player) || a.label.localeCompare(b.label));
  }, [groups, category, team, query]);

  const byPlayer = useMemo(() => {
    const m = new Map<string, Grouped[]>();
    for (const g of shown) {
      const k = `${g.team}|${g.player}`;
      m.set(k, [...(m.get(k) ?? []), g]);
    }
    return Array.from(m.entries());
  }, [shown]);

  if (groups.length === 0) {
    return <p className="text-sm text-neutral-500">No lines posted for this week yet. Check back after the next sync.</p>;
  }

  const selectClass =
    "rounded-md bg-neutral-900 border border-neutral-800 px-2 py-1.5 text-sm text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-600";

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 flex-wrap">
        {CATEGORIES.filter((c) => counts.get(c)).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              category === c ? "bg-sky-600 text-white" : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
            }`}
          >
            {c} <span className="opacity-60">{counts.get(c)}</span>
          </button>
        ))}
      </div>
      <div className="flex gap-2 flex-wrap">
        <select value={team} onChange={(e) => setTeam(e.target.value)} className={selectClass}>
          <option value="">All teams</option>
          {teams.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search player…"
          className={`${selectClass} flex-1 min-w-[10rem]`}
        />
      </div>

      {byPlayer.length === 0 ? (
        <p className="text-sm text-neutral-500">Nothing in this category for that filter.</p>
      ) : (
        <div className="space-y-2">
          {byPlayer.slice(0, 150).map(([k, rows]) => (
            <div key={k} className="rounded-md border border-neutral-800 px-3 py-2">
              <div className="text-sm font-medium">
                {rows[0].player} <span className="text-xs text-neutral-500">{rows[0].team}</span>
              </div>
              <ul className="mt-1 space-y-1">
                {rows.map((g) => (
                  <li key={g.key} className="text-xs flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-neutral-200 min-w-[9rem]">{g.label}</span>
                    {g.prices.length > 0 ? (
                      <span className="text-neutral-400">
                        <span className="text-emerald-400 font-medium">{fmt(g.prices[0].priceAmerican)}</span> {g.prices[0].book}
                        {g.prices.length > 1 && (
                          <span className="text-neutral-500">
                            {" "}
                            · {g.prices
                              .slice(1)
                              .map((p) => `${p.book} ${fmt(p.priceAmerican)}`)
                              .join(" · ")}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-neutral-500">No book line posted</span>
                    )}
                    {g.modelPct !== null && (
                      <span className="text-sky-400">
                        Model: {Math.round(g.modelPct * 100)}% (fair {fmt(fairAmerican(g.modelPct))})
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {byPlayer.length > 150 && (
            <p className="text-xs text-neutral-500">Showing the first 150 players. Pick a team or search to narrow it down.</p>
          )}
        </div>
      )}
    </div>
  );
}
