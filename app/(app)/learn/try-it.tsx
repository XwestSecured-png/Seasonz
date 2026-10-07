"use client";

import { useState } from "react";
import { WhatItMeans } from "../what-it-means";
import type { ExplainMarket } from "@/lib/bet-explainer";

const MARKETS: { key: ExplainMarket; label: string }[] = [
  { key: "ML", label: "Moneyline" },
  { key: "SPREAD", label: "Spread" },
  { key: "TOTAL", label: "Over/Under" },
  { key: "PROP", label: "Player prop" },
];

const input =
  "w-full rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100";

/** A playground: set up any bet and read exactly what it takes to win. */
export function TryIt() {
  const [market, setMarket] = useState<ExplainMarket>("SPREAD");
  const [pick, setPick] = useState("Falcons");
  const [opponent, setOpponent] = useState("Saints");
  const [side, setSide] = useState("OVER");
  const [line, setLine] = useState("-3.5");
  const [mainLine, setMainLine] = useState("");
  const [stat, setStat] = useState("Rec Yds");
  const [price, setPrice] = useState("-110");
  const [stake, setStake] = useState("100");

  const num = (v: string) => (v.trim() === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  const ou = market === "TOTAL" || market === "PROP";

  return (
    <div className="space-y-3 rounded-md border border-neutral-800 p-4">
      <div className="flex flex-wrap gap-1.5">
        {MARKETS.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => {
              setMarket(m.key);
              if (m.key === "TOTAL") setLine("44.5");
              if (m.key === "SPREAD") setLine("-3.5");
              if (m.key === "PROP") {
                setLine("64.5");
                setPick("Drake London");
              } else if (pick === "Drake London") setPick("Falcons");
              setMainLine("");
            }}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              market === m.key ? "bg-emerald-600 text-white" : "border border-neutral-800 bg-neutral-900 text-neutral-300"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {market !== "TOTAL" && (
          <label className="space-y-1 text-xs text-neutral-400">
            {market === "PROP" ? "Player" : "Your team"}
            <input value={pick} onChange={(e) => setPick(e.target.value)} className={input} />
          </label>
        )}
        {(market === "ML" || market === "SPREAD") && (
          <label className="space-y-1 text-xs text-neutral-400">
            Opponent
            <input value={opponent} onChange={(e) => setOpponent(e.target.value)} className={input} />
          </label>
        )}
        {market === "PROP" && (
          <label className="space-y-1 text-xs text-neutral-400">
            Stat
            <input value={stat} onChange={(e) => setStat(e.target.value)} className={input} />
          </label>
        )}
        {ou && (
          <label className="space-y-1 text-xs text-neutral-400">
            Side
            <select value={side} onChange={(e) => setSide(e.target.value)} className={input}>
              <option value="OVER">Over</option>
              <option value="UNDER">Under</option>
            </select>
          </label>
        )}
        {market !== "ML" && (
          <label className="space-y-1 text-xs text-neutral-400">
            Line
            <input type="number" step="0.5" value={line} onChange={(e) => setLine(e.target.value)} className={input} />
          </label>
        )}
        {market !== "ML" && (
          <label className="space-y-1 text-xs text-neutral-400">
            Main line (for alt lines)
            <input
              type="number"
              step="0.5"
              value={mainLine}
              onChange={(e) => setMainLine(e.target.value)}
              placeholder="optional"
              className={input}
            />
          </label>
        )}
        <label className="space-y-1 text-xs text-neutral-400">
          Odds
          <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} className={input} />
        </label>
        <label className="space-y-1 text-xs text-neutral-400">
          Stake ($)
          <input type="number" value={stake} onChange={(e) => setStake(e.target.value)} className={input} />
        </label>
      </div>
      <WhatItMeans
        defaultOpen
        bet={{
          market,
          sport: "nfl",
          pick: market === "TOTAL" ? null : pick,
          opponent,
          side: ou ? side : null,
          line: market === "ML" ? null : num(line),
          mainLine: num(mainLine),
          stat,
          priceAmerican: num(price),
          stakeUsd: num(stake),
        }}
      />
    </div>
  );
}
