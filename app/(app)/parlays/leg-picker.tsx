"use client";

import { useMemo, useState } from "react";

export interface LegPickerGame {
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
}

export interface LegPickerProp {
  player: string;
  team: string | null;
  statType: string;
  line: number;
  side: string;
  book: string;
  priceAmerican: number;
}

const TEAM_BET = "__TEAM_BET__";

function formatPrice(price: number | null): string {
  if (price === null) return "—";
  return price > 0 ? `+${price}` : `${price}`;
}

function comboLabel(c: LegPickerProp): string {
  return `${c.side} ${c.line} (${c.book}) ${formatPrice(c.priceAmerican)}`;
}

/**
 * Cascading dropdown leg entry: Team -> Player (or "Team bet") -> Stat Type
 * -> Line/Book, computing {label, priceAmerican} as the user narrows down —
 * the same two fields the manual free-text row produces, so no backend
 * change was needed to support this.
 */
export function LegPicker({
  games,
  propOptions,
  onChange,
  onUseManual,
}: {
  games: LegPickerGame[];
  propOptions: LegPickerProp[];
  onChange: (leg: { label: string; priceAmerican: string }) => void;
  onUseManual: () => void;
}) {
  const teamOptions = useMemo(() => {
    const list: { team: string; opponent: string; gameId: number; isHome: boolean }[] = [];
    for (const g of games) {
      list.push({ team: g.homeTeam, opponent: g.awayTeam, gameId: g.id, isHome: true });
      list.push({ team: g.awayTeam, opponent: g.homeTeam, gameId: g.id, isHome: false });
    }
    return list.sort((a, b) => a.team.localeCompare(b.team));
  }, [games]);

  const [teamKey, setTeamKey] = useState(""); // `${team}:${gameId}`
  const [player, setPlayer] = useState("");
  const [statType, setStatType] = useState("");
  const [comboIdx, setComboIdx] = useState(0);
  const [market, setMarket] = useState<"ML" | "SPREAD" | "TOTAL">("ML");
  const [side, setSide] = useState("");

  const teamEntry = teamOptions.find((t) => `${t.team}:${t.gameId}` === teamKey) ?? null;
  const game = games.find((g) => g.id === teamEntry?.gameId) ?? null;

  const playersForTeam = useMemo(() => {
    if (!teamEntry) return [];
    const names = new Set(
      propOptions.filter((p) => p.team === teamEntry.team).map((p) => p.player)
    );
    return Array.from(names).sort();
  }, [propOptions, teamEntry]);

  const statTypesForPlayer = useMemo(() => {
    if (!teamEntry || !player || player === TEAM_BET) return [];
    const types = new Set(
      propOptions
        .filter((p) => p.team === teamEntry.team && p.player === player)
        .map((p) => p.statType)
    );
    return Array.from(types).sort();
  }, [propOptions, teamEntry, player]);

  const combos = useMemo(() => {
    if (!teamEntry || !player || player === TEAM_BET || !statType) return [];
    return propOptions.filter(
      (p) => p.team === teamEntry.team && p.player === player && p.statType === statType
    );
  }, [propOptions, teamEntry, player, statType]);

  // Team-bet prefill (mirrors app/(app)/bet-tracker/bet-form.tsx) — only
  // relevant once "Team bet" is chosen in the player slot.
  const prefill = useMemo(() => {
    if (!game) return null;
    if (market === "ML") {
      return {
        options: [game.awayTeam, game.homeTeam],
        priceFor: (s: string) =>
          s === game.homeTeam ? game.moneylineHomeOdds : game.moneylineAwayOdds,
        lineFor: () => null as number | null,
        labelFor: (s: string) => `${s} ML`,
      };
    }
    if (market === "SPREAD") {
      const homeLine = game.spreadHomeLine;
      return {
        options: [game.awayTeam, game.homeTeam],
        priceFor: (s: string) =>
          s === game.homeTeam ? game.spreadHomePriceAmerican : game.spreadAwayPriceAmerican,
        lineFor: (s: string) => (homeLine === null ? null : s === game.homeTeam ? homeLine : -homeLine),
        labelFor: (s: string) => {
          const l = homeLine === null ? null : s === game.homeTeam ? homeLine : -homeLine;
          return `${s} ${l !== null && l > 0 ? "+" : ""}${l ?? ""}`.trim();
        },
      };
    }
    return {
      options: ["OVER", "UNDER"],
      priceFor: (s: string) => (s === "OVER" ? game.totalOverPriceAmerican : game.totalUnderPriceAmerican),
      lineFor: () => game.totalLine,
      labelFor: (s: string) => `${s} ${game.totalLine ?? ""} (Total)`.trim(),
    };
  }, [game, market]);

  const chooseTeam = (key: string) => {
    setTeamKey(key);
    setPlayer("");
    setStatType("");
    setSide("");
    setComboIdx(0);
    onChange({ label: "", priceAmerican: "" });
  };

  const choosePlayer = (p: string) => {
    setPlayer(p);
    setStatType("");
    setSide("");
    setComboIdx(0);
    if (p === TEAM_BET) {
      setMarket("ML");
    }
    onChange({ label: "", priceAmerican: "" });
  };

  const chooseStatType = (st: string) => {
    setStatType(st);
    setComboIdx(0);
    const match = propOptions.find(
      (p) => p.team === teamEntry?.team && p.player === player && p.statType === st
    );
    if (match) {
      onChange({ label: `${player} ${match.side} ${match.line} ${match.statType}`, priceAmerican: String(match.priceAmerican) });
    }
  };

  const chooseCombo = (idx: number) => {
    setComboIdx(idx);
    const c = combos[idx];
    if (c) {
      onChange({ label: `${player} ${c.side} ${c.line} ${c.statType}`, priceAmerican: String(c.priceAmerican) });
    }
  };

  const chooseMarket = (m: "ML" | "SPREAD" | "TOTAL") => {
    setMarket(m);
    setSide("");
    onChange({ label: "", priceAmerican: "" });
  };

  const chooseSide = (s: string) => {
    setSide(s);
    if (prefill && game) {
      const price = prefill.priceFor(s);
      if (price !== null && price !== undefined) {
        onChange({ label: prefill.labelFor(s), priceAmerican: String(price) });
      } else {
        onChange({ label: prefill.labelFor(s), priceAmerican: "" });
      }
    }
  };

  const selectClass =
    "w-full rounded-md bg-neutral-900 border border-neutral-800 px-2 py-1.5 text-sm text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-600";

  if (games.length === 0 && propOptions.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-between gap-2 text-xs text-neutral-500 border border-dashed border-neutral-800 rounded-md px-3 py-2">
        <span>No games synced yet to build dropdown picks from this week.</span>
        <button type="button" onClick={onUseManual} className="text-blue-400 hover:text-blue-300 whitespace-nowrap">
          Type it in instead
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 grid grid-cols-1 sm:grid-cols-4 gap-2">
      <select value={teamKey} onChange={(e) => chooseTeam(e.target.value)} className={selectClass}>
        <option value="">Team…</option>
        {teamOptions.map((t) => (
          <option key={`${t.team}:${t.gameId}`} value={`${t.team}:${t.gameId}`}>
            {t.team} ({t.isHome ? "vs" : "@"} {t.opponent})
          </option>
        ))}
      </select>

      <select
        value={player}
        onChange={(e) => choosePlayer(e.target.value)}
        disabled={!teamEntry}
        className={selectClass}
      >
        <option value="">Player…</option>
        <option value={TEAM_BET}>— Team bet (ML / Spread / Total) —</option>
        {playersForTeam.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>

      {player === TEAM_BET ? (
        <>
          <select
            value={market}
            onChange={(e) => chooseMarket(e.target.value as "ML" | "SPREAD" | "TOTAL")}
            className={selectClass}
          >
            <option value="ML">Moneyline</option>
            <option value="SPREAD">Spread</option>
            <option value="TOTAL">Total</option>
          </select>
          <select value={side} onChange={(e) => chooseSide(e.target.value)} className={selectClass}>
            <option value="">Side…</option>
            {prefill?.options.map((s) => (
              <option key={s} value={s}>
                {s} ({formatPrice(prefill.priceFor(s))})
              </option>
            ))}
          </select>
        </>
      ) : (
        <>
          <select
            value={statType}
            onChange={(e) => chooseStatType(e.target.value)}
            disabled={!player}
            className={selectClass}
          >
            <option value="">Stat type…</option>
            {statTypesForPlayer.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
          <select
            value={comboIdx}
            onChange={(e) => chooseCombo(Number(e.target.value))}
            disabled={combos.length === 0}
            className={selectClass}
          >
            {combos.length === 0 ? (
              <option value={0}>Line / book…</option>
            ) : (
              combos.map((c, i) => (
                <option key={`${c.side}:${c.line}:${c.book}`} value={i}>
                  {comboLabel(c)}
                </option>
              ))
            )}
          </select>
        </>
      )}
    </div>
  );
}
