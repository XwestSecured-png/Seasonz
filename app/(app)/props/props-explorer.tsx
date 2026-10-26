"use client";

import { useMemo, useState } from "react";
import { TrustBadge, type TrustView } from "../trust-badge";
import { Verdict } from "../verdict";
import { propStakeLabel } from "@/lib/stake-sizing";
import { SortSelect } from "./sort-select";
import { sortScore, type PropSort } from "@/lib/prop-sort";

export interface PropRow {
  id: number;
  player: string;
  team: string;
  statType: string;
  line: number | null;
  side: string | null;
  priceAmerican: number | null;
  book: string | null;
  projection: number | null;
  edgePct: number | null;
  // The model's real statistical win chance for this pick (null for rows
  // synced before this column existed) — every row here already cleared
  // the 70% bar at sync time, so this is shown as confirmation, not as a
  // further filter.
  modelWinPct: number | null;
  /** The market's no-vig chance for the side (null for picks saved before 1.32.0). */
  marketPct?: number | null;
  trust?: TrustView | null;
  // Every sportsbook's price for this exact player/stat/line/side, best
  // price first (includes the one already shown as `book`/`priceAmerican`
  // above). Empty for model-only stat types, which have no book line at all.
  otherBooks?: { book: string; priceAmerican: number }[];
}

// Groups the four raw market labels (see lib/odds.ts MARKET_LABELS) under a
// broader category so the page can show "Passing / Rushing / Receiving"
// headers rather than a flat list of stat-type strings.
const STAT_CATEGORY: Record<string, string> = {
  "Pass Yds": "Passing",
  "Rush Yds": "Rushing",
  "Rush + Rec Yds": "Rushing",
  "Rec Yds": "Receiving",
  Receptions: "Receiving",
  "Anytime TD": "Touchdowns",
  "2+ TDs": "Touchdowns",
  "INT Thrown": "Turnovers",
  "Fumble Lost": "Turnovers",
  "QB Sacked": "Pass Protection",
  "Anytime Sack": "Defense",
  "Anytime INT": "Defense",
};
const CATEGORY_ORDER = [
  "Passing",
  "Rushing",
  "Receiving",
  "Touchdowns",
  "Turnovers",
  "Pass Protection",
  "Defense",
];

// These stat types are model-only projections with no sportsbook line to
// compare against (see computeTdProjections / computeTurnoverProjections /
// computeDefensiveProjections in lib/props-model.ts), so they're displayed
// as a plain probability rather than the usual line/price/edge row the
// book-compared yardage stats use.
const MODEL_ONLY_STAT_TYPES = new Set([
  "Anytime TD",
  "2+ TDs",
  "INT Thrown",
  "Fumble Lost",
  "QB Sacked",
  "Anytime Sack",
  "Anytime INT",
]);

function formatPrice(price: number | null): string {
  if (price === null) return "—";
  return price > 0 ? `+${price}` : `${price}`;
}

// One line per category, shown as a legend above the filters so each
// section's meaning is visible without opening the top-of-page explainer.
const CATEGORY_LEGEND: { category: string; blurb: string }[] = [
  { category: "Passing", blurb: "QB yardage line vs. season average" },
  { category: "Rushing", blurb: "Rush yards line vs. season average" },
  {
    category: "Receiving",
    blurb: "Rec yards/receptions line vs. season average",
  },
  {
    category: "Touchdowns",
    blurb: "model-only chance of scoring, no book line",
  },
  {
    category: "Turnovers",
    blurb: "model-only chance of an INT thrown or fumble lost",
  },
  {
    category: "Pass Protection",
    blurb: "model-only chance the QB gets sacked",
  },
  {
    category: "Defense",
    blurb: "model-only chance a defender gets a sack or INT",
  },
];

export function PropsExplorer({
  picks,
  favTeam,
  bankrollUsd = null,
}: {
  picks: PropRow[];
  favTeam: { code: string; primary: string } | null;
  /** The signed-in user's bankroll, for the suggested stake's dollar amount. */
  bankrollUsd?: number | null;
}) {
  const teams = useMemo(
    () => Array.from(new Set(picks.map((p) => p.team))).sort(),
    [picks],
  );
  const statTypes = useMemo(
    () => Array.from(new Set(picks.map((p) => p.statType))).sort(),
    [picks],
  );

  const [team, setTeam] = useState("All");
  const [statType, setStatType] = useState("All");

  const filtered = picks.filter(
    (p) =>
      (team === "All" || p.team === team) &&
      (statType === "All" || p.statType === statType),
  );

  const [sort, setSort] = useState<PropSort>("edge");
  // Model-only props (Anytime TD...) keep their chance in edgePct.
  const chanceOf = (r: PropRow) =>
    r.modelWinPct ?? (MODEL_ONLY_STAT_TYPES.has(r.statType) ? r.edgePct : null);
  const score = (r: PropRow) =>
    sortScore(sort, {
      trust: r.trust,
      chance: chanceOf(r),
      price: r.priceAmerican,
      market: r.marketPct ?? null,
    });

  // Player cards: one per team + player. "Team (A-Z)" keeps the team
  // sections; every other sort shows one ranked list, best card first.
  type Card = { team: string; player: string; rows: PropRow[] };
  const cards = new Map<string, Card>();
  for (const p of filtered) {
    const k = `${p.team}|${p.player}`;
    const c = cards.get(k) ?? { team: p.team, player: p.player, rows: [] };
    c.rows.push(p);
    cards.set(k, c);
  }
  const best = (c: Card) => Math.max(...c.rows.map(score));
  const sections: { team: string | null; cards: Card[] }[] =
    sort === "team"
      ? Array.from(new Set([...cards.values()].map((c) => c.team)))
          .sort()
          .map((t) => ({
            team: t,
            cards: [...cards.values()]
              .filter((c) => c.team === t)
              .sort((a, b) => a.player.localeCompare(b.player)),
          }))
      : [
          {
            team: null,
            cards: [...cards.values()].sort((a, b) => best(b) - best(a)),
          },
        ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500">
        {CATEGORY_LEGEND.map((c) => (
          <span key={c.category}>
            <span className="text-neutral-400 font-medium">{c.category}:</span>{" "}
            {c.blurb}
          </span>
        ))}
      </div>
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
        <SortSelect value={sort} onChange={setSort} />
        <span className="text-xs text-neutral-500">
          {filtered.length} of {picks.length} picks
        </span>
      </div>

      {cards.size === 0 ? (
        <p className="text-sm text-neutral-500">No picks match that filter.</p>
      ) : (
        sections.map((sec) => {
          const isFavSection = sec.team !== null && sec.team === favTeam?.code;
          return (
            <div key={sec.team ?? "ranked"} className="space-y-3">
              {sec.team !== null && (
                <h3
                  className="text-sm font-semibold border-b pb-1 flex items-center gap-2"
                  style={
                    isFavSection
                      ? {
                          color: favTeam!.primary,
                          borderColor: favTeam!.primary,
                        }
                      : { color: "#e5e5e5", borderColor: "#262626" }
                  }
                >
                  {sec.team}
                  {isFavSection && (
                    <span
                      className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded"
                      style={{
                        backgroundColor: `${favTeam!.primary}26`,
                        color: favTeam!.primary,
                      }}
                    >
                      Your team
                    </span>
                  )}
                </h3>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                {sec.cards.map(({ team: t, player, rows }) => {
                  const isFavTeam = t === favTeam?.code;
                  // Group this player's own rows by stat type, under the
                  // broader category badge (Passing / Rushing / Receiving).
                  const byStat = new Map<string, PropRow[]>();
                  for (const r of rows) {
                    const list = byStat.get(r.statType) ?? [];
                    list.push(r);
                    byStat.set(r.statType, list);
                  }
                  const statBest = (st: string) =>
                    Math.max(...byStat.get(st)!.map(score));
                  if (sort !== "team")
                    for (const l of byStat.values())
                      l.sort((a, b) => score(b) - score(a));
                  const statsSorted = Array.from(byStat.keys()).sort((a, b) =>
                    sort === "team"
                      ? CATEGORY_ORDER.indexOf(STAT_CATEGORY[a] ?? "") -
                        CATEGORY_ORDER.indexOf(STAT_CATEGORY[b] ?? "")
                      : statBest(b) - statBest(a),
                  );
                  return (
                    <div
                      key={`${t}|${player}`}
                      className="rounded-md border p-3 space-y-2"
                      style={
                        isFavTeam
                          ? {
                              borderColor: `${favTeam!.primary}55`,
                              backgroundColor: `${favTeam!.primary}0d`,
                            }
                          : { borderColor: "#262626" }
                      }
                    >
                      <div className="text-sm font-medium text-neutral-100">
                        {player}
                        {sec.team === null && (
                          <span className="ml-1.5 text-xs font-normal text-neutral-500">
                            {t}
                          </span>
                        )}
                      </div>
                      {statsSorted.map((st) => (
                        <div key={st} className="space-y-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400">
                              {STAT_CATEGORY[st] ?? "Other"}
                            </span>
                            <span className="text-xs font-medium text-neutral-300">
                              {st}
                            </span>
                          </div>
                          <ul className="space-y-1">
                            {byStat.get(st)!.map((r) =>
                              MODEL_ONLY_STAT_TYPES.has(r.statType) ? (
                                <li
                                  key={r.id}
                                  className="text-xs text-neutral-400 flex items-center justify-between gap-2"
                                >
                                  <span className="text-neutral-500">
                                    No book line — model projection only
                                  </span>
                                  <span className="text-neutral-200 font-medium shrink-0">
                                    {r.edgePct !== null
                                      ? `${(r.edgePct * 100).toFixed(0)}%`
                                      : "—"}{" "}
                                    chance
                                  </span>
                                </li>
                              ) : (
                                <li key={r.id} className="text-xs space-y-1">
                                  <div className="text-neutral-400 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
                                    <span>
                                      <span
                                        className={
                                          r.side === "Over"
                                            ? "text-emerald-400"
                                            : "text-rose-400"
                                        }
                                      >
                                        {r.side}
                                      </span>{" "}
                                      {r.line} · {formatPrice(r.priceAmerican)}{" "}
                                      @ {r.book}
                                    </span>
                                    <span className="text-neutral-500 min-w-0 flex flex-wrap items-center gap-x-1">
                                      proj {r.projection?.toFixed(1) ?? "—"} ·{" "}
                                      {r.edgePct !== null
                                        ? `${(r.edgePct * 100).toFixed(1)}%`
                                        : "—"}{" "}
                                      edge
                                      {r.modelWinPct !== null && (
                                        <>
                                          {" · "}
                                          <Verdict chance={r.modelWinPct} />
                                          {r.marketPct != null &&
                                            r.modelWinPct !== null && (
                                              <span
                                                className={
                                                  r.modelWinPct - r.marketPct >=
                                                  0.1
                                                    ? "text-emerald-400 font-medium"
                                                    : "text-neutral-400"
                                                }
                                                title="Our chance minus the betting market's own no-vig chance for this side"
                                              >
                                                {" "}
                                                ·{" "}
                                                {r.modelWinPct - r.marketPct >=
                                                0
                                                  ? "+"
                                                  : ""}
                                                {Math.round(
                                                  (r.modelWinPct -
                                                    r.marketPct) *
                                                    100,
                                                )}{" "}
                                                pts vs market
                                              </span>
                                            )}
                                        </>
                                      )}
                                      {(() => {
                                        const stake = propStakeLabel(
                                          r.modelWinPct,
                                          r.priceAmerican,
                                          bankrollUsd,
                                        );
                                        return stake ? (
                                          <span
                                            className="text-emerald-400/90"
                                            title="Suggested stake: an eighth of Kelly, capped at 2% of bankroll"
                                          >
                                            · stake {stake}
                                          </span>
                                        ) : null;
                                      })()}
                                      {r.trust && (
                                        <>
                                          {" "}
                                          <TrustBadge trust={r.trust} compact />
                                        </>
                                      )}
                                    </span>
                                  </div>
                                  <CompareBooks
                                    books={r.otherBooks}
                                    currentBook={r.book}
                                  />
                                </li>
                              ),
                            )}
                          </ul>
                        </div>
                      ))}
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

// Lets the user see every sportsbook's price for this exact line, instead
// of just the one book whose price happened to be the model's chosen pick
// — a quick "which book pays best" check, collapsed by default to keep the
// list from getting noisy for props where only one book posts a line.
function CompareBooks({
  books,
  currentBook,
}: {
  books: { book: string; priceAmerican: number }[] | undefined;
  currentBook: string | null;
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
