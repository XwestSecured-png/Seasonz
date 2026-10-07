"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PayoutCalc } from "../parlays/payout-calc";
import { PushBetButton } from "../push-bet-button";
import { probToFairAmerican } from "@/lib/fair-odds";
import type { Sportsbook, SportsbookCategory } from "@/lib/sportsbooks";

export interface TdPlayerOption {
  player: string;
  team: string;
  anytimeTdPct: number;
  multiTdPct: number;
}

type StatType = "Anytime TD" | "2+ TDs";

interface Slot {
  team: string;
  player: string;
  statType: StatType;
}

// This builder is deliberately a 3-to-5-leg parlay, not an open-ended "pick
// as many as you want" list — matching how sportsbooks package these TD
// combo bets, and keeping the combined probability from getting diluted by
// a 1 or 2 leg "parlay" that's barely different from a straight bet. The
// upper end (maxLegs prop) is tier-gated (see lib/entitlements.ts's
// tdPicksMaxLegs) — Free is capped below 5, Pro/Super Pro always get 5.
const MIN_SLOTS = 3;
const EMPTY_SLOT: Slot = { team: "", player: "", statType: "Anytime TD" };

function pct(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

/** A 3-to-5-leg dropdown-built TD parlay (Team -> Player -> Anytime TD / 2+ TDs), with a combined probability and a fair-odds payout calculator — the user-built counterpart to the Model's Top 5 auto picks above it. */
export function TdPicksBuilder({
  players,
  week,
  sportsbookPrefs,
  maxLegs = 5,
  allowedCategories,
}: {
  players: TdPlayerOption[];
  week?: number;
  sportsbookPrefs: Sportsbook[];
  /** Tier-gated leg cap — see lib/entitlements.ts's tdPicksMaxLegs. Never let this fall below MIN_SLOTS even if misconfigured. */
  maxLegs?: number;
  allowedCategories?: SportsbookCategory[];
}) {
  const MAX_SLOTS = Math.max(MIN_SLOTS, maxLegs);
  const [slots, setSlots] = useState<Slot[]>(
    Array.from({ length: MIN_SLOTS }, () => ({ ...EMPTY_SLOT }))
  );

  const teams = useMemo(
    () => Array.from(new Set(players.map((p) => p.team))).sort(),
    [players]
  );

  const playersByTeam = useMemo(() => {
    const map = new Map<string, TdPlayerOption[]>();
    for (const p of players) {
      const list = map.get(p.team) ?? [];
      list.push(p);
      map.set(p.team, list);
    }
    for (const list of map.values()) list.sort((a, b) => b.anytimeTdPct - a.anytimeTdPct);
    return map;
  }, [players]);

  function updateSlot(i: number, patch: Partial<Slot>) {
    setSlots((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  function addSlot() {
    setSlots((prev) => (prev.length < MAX_SLOTS ? [...prev, { ...EMPTY_SLOT }] : prev));
  }

  function removeSlot(i: number) {
    setSlots((prev) => (prev.length > MIN_SLOTS ? prev.filter((_, idx) => idx !== i) : prev));
  }

  const picks = slots
    .map((s) => {
      const p = players.find((pl) => pl.team === s.team && pl.player === s.player);
      if (!p) return null;
      const prob = s.statType === "Anytime TD" ? p.anytimeTdPct : p.multiTdPct;
      if (!prob || prob <= 0) return null;
      return { ...s, probability: prob };
    })
    .filter((p): p is Slot & { probability: number } => p !== null);

  const filledCount = picks.length;
  const readyForPayout = filledCount >= MIN_SLOTS;
  const combinedPct = readyForPayout ? picks.reduce((acc, p) => acc * p.probability, 1) : null;
  const payoutLegs = picks.map((p) => ({
    label: `${p.player} (${p.team}) ${p.statType}`,
    priceAmerican: probToFairAmerican(p.probability),
  }));

  const selectClass =
    "w-full rounded-md bg-neutral-900 border border-neutral-800 px-2 py-1.5 text-sm text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-600";

  if (players.length === 0) {
    return (
      <p className="text-sm text-neutral-500">
        No touchdown projections synced yet for this week.
      </p>
    );
  }

  return (
    <div className="rounded-md border border-neutral-800 p-4 space-y-3">
      <div className="space-y-2">
        {slots.map((slot, i) => {
          const options = slot.team ? playersByTeam.get(slot.team) ?? [] : [];
          const selected = options.find((p) => p.player === slot.player) ?? null;
          return (
            <div key={i} className="flex gap-2 items-center flex-wrap sm:flex-nowrap">
              <span className="text-xs text-neutral-500 w-4 shrink-0">{i + 1}.</span>
              <select
                value={slot.team}
                onChange={(e) => updateSlot(i, { team: e.target.value, player: "" })}
                className={selectClass}
              >
                <option value="">Team…</option>
                {teams.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <select
                value={slot.player}
                onChange={(e) => updateSlot(i, { player: e.target.value, statType: "Anytime TD" })}
                disabled={!slot.team}
                className={selectClass}
              >
                <option value="">Player…</option>
                {options.map((p) => (
                  <option key={p.player} value={p.player}>
                    {p.player} ({pct(p.anytimeTdPct)})
                  </option>
                ))}
              </select>
              <select
                value={slot.statType}
                onChange={(e) => updateSlot(i, { statType: e.target.value as StatType })}
                disabled={!slot.player}
                className={selectClass}
              >
                <option value="Anytime TD">Anytime TD</option>
                <option value="2+ TDs" disabled={!!selected && selected.multiTdPct <= 0}>
                  2+ TDs
                </option>
              </select>
              {slots.length > MIN_SLOTS && (
                <button
                  type="button"
                  onClick={() => removeSlot(i)}
                  className="text-neutral-500 hover:text-neutral-300 text-sm px-1"
                  aria-label="Remove player"
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={addSlot}
          disabled={slots.length >= MAX_SLOTS}
          className="text-sm text-blue-400 hover:text-blue-300 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          + Add player ({slots.length}/{MAX_SLOTS})
        </button>
        <span className="text-xs text-neutral-500">
          {MIN_SLOTS}&ndash;{MAX_SLOTS} legs
          {MAX_SLOTS < 5 && (
            <>
              {" · "}
              <Link href="/upgrade" className="text-blue-400 hover:text-blue-300 underline">
                Upgrade
              </Link>{" "}
              for 5
            </>
          )}
        </span>
      </div>

      {readyForPayout ? (
        <div className="rounded-md bg-neutral-900/50 border border-neutral-800 px-3 py-2 space-y-1.5">
          <div className="text-xs text-neutral-400">
            Combined (all {filledCount} hit): {combinedPct !== null ? pct(combinedPct) : "—"}
          </div>
          <PayoutCalc legs={payoutLegs} />
          <PushBetButton
            legs={payoutLegs}
            title="Your TD Picks parlay"
            week={week}
            sportsbookPrefs={sportsbookPrefs}
            allowedCategories={allowedCategories}
            compact
          />
        </div>
      ) : (
        <p className="text-xs text-neutral-500">
          Pick a player for at least {MIN_SLOTS} legs to see the combined odds and payout
          ({filledCount}/{MIN_SLOTS} filled so far).
        </p>
      )}
      <p className="text-xs text-neutral-500">
        Payout is the model&rsquo;s own fair (no-vig) odds at each player&rsquo;s probability —
        not a live sportsbook price.
      </p>
    </div>
  );
}
