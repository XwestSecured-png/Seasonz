"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PushBetButton } from "../push-bet-button";
import { WhatItMeans } from "../what-it-means";
import type { Sportsbook, SportsbookCategory } from "@/lib/sportsbooks";

export interface BetFormGame {
  id: number;
  week: number;
  homeTeam: string;
  awayTeam: string;
  moneylineHomeOdds: number | null;
  moneylineAwayOdds: number | null;
  spreadHomeLine: number | null;
  spreadHomePriceAmerican: number | null;
  spreadAwayPriceAmerican: number | null;
  totalLine: number | null;
  totalOverPriceAmerican: number | null;
  totalUnderPriceAmerican: number | null;
  bestMarket: string | null;
  bestMarketLabel: string | null;
  bestMarketConfidencePct: number | null;
}

function formatPrice(price: number | null): string {
  if (price === null) return "—";
  return price > 0 ? `+${price}` : `${price}`;
}

export function BetForm({
  games,
  bankrollUsd,
  sportsbookPrefs,
  allowedCategories,
}: {
  games: BetFormGame[];
  bankrollUsd: number | null;
  sportsbookPrefs: Sportsbook[];
  allowedCategories?: SportsbookCategory[];
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [gameId, setGameId] = useState<number | "">(games[0]?.id ?? "");
  const [market, setMarket] = useState<"ML" | "SPREAD" | "TOTAL">("ML");
  const [selection, setSelection] = useState("");
  const [line, setLine] = useState("");
  const [price, setPrice] = useState("");
  const [stake, setStake] = useState("");
  const router = useRouter();

  const game = games.find((g) => g.id === gameId) ?? null;

  // Prefill line/price whenever the game, market, or side selection changes
  // — editable afterward, since the line may have moved since this was
  // synced, or the person bet at a different book.
  const prefill = useMemo(() => {
    if (!game) return null;
    if (market === "ML") {
      return {
        options: [game.awayTeam, game.homeTeam],
        priceFor: (s: string) => (s === game.homeTeam ? game.moneylineHomeOdds : game.moneylineAwayOdds),
        lineFor: () => null,
      };
    }
    if (market === "SPREAD") {
      const homeLine = game.spreadHomeLine;
      return {
        options: [game.awayTeam, game.homeTeam],
        priceFor: (s: string) => (s === game.homeTeam ? game.spreadHomePriceAmerican : game.spreadAwayPriceAmerican),
        lineFor: (s: string) => (homeLine === null ? null : s === game.homeTeam ? homeLine : -homeLine),
      };
    }
    return {
      options: ["OVER", "UNDER"],
      priceFor: (s: string) => (s === "OVER" ? game.totalOverPriceAmerican : game.totalUnderPriceAmerican),
      lineFor: () => game.totalLine,
    };
  }, [game, market]);

  const onSelectGame = (id: number) => {
    setGameId(id);
    setSelection("");
    setLine("");
    setPrice("");
  };

  const onSelectMarket = (m: "ML" | "SPREAD" | "TOTAL") => {
    setMarket(m);
    setSelection("");
    setLine("");
    setPrice("");
  };

  const onSelectSide = (s: string) => {
    setSelection(s);
    if (prefill) {
      const p = prefill.priceFor(s);
      const l = prefill.lineFor(s);
      setPrice(p !== null && p !== undefined ? String(p) : "");
      setLine(l !== null && l !== undefined ? String(l) : "");
    }
  };

  // Only shows a suggestion when this exact pick matches the model's own
  // Best Bet for the game — that's the only case we have a real win
  // probability for (see lib/stake-sizing.ts). Anything else is the
  // person's own read, with no model number to size it by.
  const suggestion = useMemo(() => {
    if (!game || !game.bestMarket || game.bestMarketConfidencePct === null) return null;
    if (game.bestMarket !== market) return null;
    const isBestSelection =
      (market === "ML" && game.bestMarketLabel?.startsWith(selection)) ||
      (market === "SPREAD" && game.bestMarketLabel?.startsWith(selection)) ||
      (market === "TOTAL" && game.bestMarketLabel?.toUpperCase().startsWith(selection));
    if (!isBestSelection || !price) return null;
    const priceNum = Number(price);
    if (!Number.isFinite(priceNum)) return null;
    // Kelly math lives server-side too (lib/stake-sizing.ts) — this is a
    // lightweight client mirror so the suggestion updates live as the price
    // field is edited, without a round trip.
    const decimalOdds = priceNum > 0 ? 1 + priceNum / 100 : 1 + 100 / Math.abs(priceNum);
    const b = decimalOdds - 1;
    const p = Math.min(0.99, Math.max(0.5, game.bestMarketConfidencePct));
    const q = 1 - p;
    const fullKelly = Math.max(0, (b * p - q) / b);
    const pct = Math.min(0.05, fullKelly * 0.5);
    return { pct, usd: bankrollUsd ? Math.round(bankrollUsd * pct) : null };
  }, [game, market, selection, price, bankrollUsd]);

  // What PushBetButton copies/opens for the currently-selected pick — a
  // single leg, so pushing it never auto-saves to Your Parlays (that only
  // fires for 2+ leg slips); "Log bet" right next to it is what tracks a
  // straight bet like this one.
  const pushLeg = useMemo(() => {
    if (!game || !selection || !price) return null;
    const priceNum = Number(price);
    if (!Number.isFinite(priceNum) || priceNum === 0) return null;
    const matchup = `${game.awayTeam} @ ${game.homeTeam}`;
    if (market === "ML") return { label: `${selection} ML — ${matchup}`, priceAmerican: priceNum };
    if (market === "SPREAD") {
      const lineStr = line !== "" ? `${Number(line) > 0 ? "+" : ""}${line}` : "";
      return { label: `${selection} ${lineStr} — ${matchup}`.trim(), priceAmerican: priceNum };
    }
    const side = selection === "OVER" ? "Over" : "Under";
    return { label: `${side} ${line || ""} — ${matchup}`.trim(), priceAmerican: priceNum };
  }, [game, market, selection, line, price]);

  const submit = () => {
    setError(null);
    if (!gameId || !selection || !price || !stake) {
      setError("Fill in every field before logging the bet.");
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch("/api/bets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            gameId,
            market,
            selection,
            line: line === "" ? null : Number(line),
            priceAmerican: Number(price),
            stakeUsd: Number(stake),
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Failed to log bet (${res.status})`);
        }
        setSelection("");
        setLine("");
        setPrice("");
        setStake("");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  if (games.length === 0) {
    return <p className="text-sm text-neutral-500">No upcoming games synced yet to log a bet against.</p>;
  }

  return (
    <div className="rounded-md border border-neutral-800 p-4 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-xs text-neutral-400 space-y-1">
          Game
          <select
            value={gameId}
            onChange={(e) => onSelectGame(Number(e.target.value))}
            className="w-full rounded-md bg-neutral-900 border border-neutral-800 px-2 py-1.5 text-sm text-neutral-100"
          >
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                Wk {g.week} — {g.awayTeam} @ {g.homeTeam}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-neutral-400 space-y-1">
          Market
          <select
            value={market}
            onChange={(e) => onSelectMarket(e.target.value as "ML" | "SPREAD" | "TOTAL")}
            className="w-full rounded-md bg-neutral-900 border border-neutral-800 px-2 py-1.5 text-sm text-neutral-100"
          >
            <option value="ML">Moneyline</option>
            <option value="SPREAD">Spread</option>
            <option value="TOTAL">Total</option>
          </select>
        </label>
      </div>

      <div>
        <div className="text-xs text-neutral-400 mb-1">Selection</div>
        <div className="flex gap-2">
          {prefill?.options.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSelectSide(s)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                selection === s
                  ? "bg-sky-600 text-white"
                  : "bg-neutral-900 border border-neutral-800 text-neutral-300 hover:bg-neutral-800"
              }`}
            >
              {s} {market !== "ML" && selection !== s ? `(${formatPrice(prefill.priceFor(s))})` : ""}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {market !== "ML" && (
          <label className="text-xs text-neutral-400 space-y-1">
            Line <span className="text-neutral-600">(change it for an alternate line)</span>
            <input
              type="number"
              step="0.5"
              value={line}
              onChange={(e) => setLine(e.target.value)}
              className="w-full rounded-md bg-neutral-900 border border-neutral-800 px-2 py-1.5 text-sm text-neutral-100"
            />
          </label>
        )}
        <label className="text-xs text-neutral-400 space-y-1">
          Price (American)
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="-110"
            className="w-full rounded-md bg-neutral-900 border border-neutral-800 px-2 py-1.5 text-sm text-neutral-100"
          />
        </label>
        <label className="text-xs text-neutral-400 space-y-1">
          Stake ($)
          <input
            type="number"
            min="0"
            step="1"
            value={stake}
            onChange={(e) => setStake(e.target.value)}
            placeholder={suggestion ? String(suggestion.usd ?? "") : ""}
            className="w-full rounded-md bg-neutral-900 border border-neutral-800 px-2 py-1.5 text-sm text-neutral-100"
          />
        </label>
      </div>

      {game && selection && (
        <WhatItMeans
          defaultOpen
          bet={{
            market,
            sport: "nfl",
            pick: market === "TOTAL" ? null : selection,
            opponent: market === "TOTAL" ? null : selection === game.homeTeam ? game.awayTeam : game.homeTeam,
            side: market === "TOTAL" ? selection : null,
            line: line === "" || !Number.isFinite(Number(line)) ? null : Number(line),
            mainLine: prefill?.lineFor(selection) ?? null,
            priceAmerican: price === "" || !Number.isFinite(Number(price)) ? null : Number(price),
            stakeUsd: stake === "" ? null : Number(stake),
          }}
        />
      )}

      {suggestion && (
        <p className="text-xs text-emerald-400">
          Model suggestion for this pick: {(suggestion.pct * 100).toFixed(1)}% of bankroll
          {suggestion.usd !== null ? ` (~$${suggestion.usd})` : " — set your bankroll above to see a dollar amount"}
          . Half-Kelly, capped at 5%.
        </p>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={submit}
          disabled={isPending}
          style={{ backgroundColor: "var(--team-accent, #2563eb)" }}
          className="rounded-md hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity px-3 py-1.5 text-sm font-medium text-white"
        >
          {isPending ? "Logging…" : "Log bet"}
        </button>
        <PushBetButton
          legs={pushLeg ? [pushLeg] : []}
          sportsbookPrefs={sportsbookPrefs}
          allowedCategories={allowedCategories}
          alreadyTracked
        />
      </div>
    </div>
  );
}
