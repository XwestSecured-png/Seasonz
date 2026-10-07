"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { SportKey } from "@/lib/sports/types";

export interface UpcomingGameOption {
  id: number;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: string | null; // ISO string
}

export interface ExistingPropPick {
  id: number;
  gameId: number;
  homeTeam: string;
  awayTeam: string;
  team: string;
  player: string;
  statLabel: string;
  threshold: number;
  side: "over" | "under";
  result: "pending" | "win" | "loss" | "void";
  actualValue: number | null;
}

const RESULT_CLASS: Record<ExistingPropPick["result"], string> = {
  pending: "text-neutral-400",
  win: "text-emerald-400",
  loss: "text-rose-400",
  void: "text-neutral-500",
};

const RESULT_LABEL: Record<ExistingPropPick["result"], string> = {
  pending: "Pending",
  win: "Win",
  loss: "Loss",
  void: "Void — no matching stat",
};

export function OtherSportProps({
  sport,
  games,
  picks,
  statHints,
}: {
  sport: SportKey;
  games: UpcomingGameOption[];
  picks: ExistingPropPick[];
  statHints: string[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [gameId, setGameId] = useState<number | "">(games[0]?.id ?? "");
  const [team, setTeam] = useState("");
  const [player, setPlayer] = useState("");
  const [statLabel, setStatLabel] = useState("");
  const [threshold, setThreshold] = useState("");
  const [side, setSide] = useState<"over" | "under">("over");

  const submit = () => {
    setError(null);
    const thresholdNum = Number(threshold);
    if (!gameId || !team.trim() || !player.trim() || !statLabel.trim() || !Number.isFinite(thresholdNum)) {
      setError("Fill in every field, including a numeric line.");
      return;
    }
    startTransition(async () => {
      const res = await fetch("/api/prop-picks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sport,
          gameId: Number(gameId),
          team: team.trim(),
          player: player.trim(),
          statLabel: statLabel.trim(),
          threshold: thresholdNum,
          side,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? "Couldn't save that pick.");
        return;
      }
      setTeam("");
      setPlayer("");
      setStatLabel("");
      setThreshold("");
      router.refresh();
    });
  };

  const remove = (id: number) => {
    startTransition(async () => {
      await fetch("/api/prop-picks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      router.refresh();
    });
  };

  return (
    <div className="space-y-5">
      <div className="rounded-md border border-neutral-800 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-neutral-300">Make your own pick</h3>
        <p className="text-xs text-neutral-500">
          For a stat with no sportsbook line above (or none posted for this game yet), call your
          own number instead — once the game&rsquo;s final and its box score is synced, this gets
          graded automatically against the real stat.
        </p>
        {games.length === 0 ? (
          <p className="text-xs text-neutral-500">No upcoming games synced yet for this sport.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            <select
              value={gameId}
              onChange={(e) => setGameId(e.target.value ? Number(e.target.value) : "")}
              className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm"
            >
              {games.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.awayTeam} @ {g.homeTeam}
                  {g.kickoffAt ? ` — ${new Date(g.kickoffAt).toLocaleDateString()}` : ""}
                </option>
              ))}
            </select>
            <input
              value={team}
              onChange={(e) => setTeam(e.target.value)}
              placeholder="Player's team (e.g. LAL)"
              className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm"
            />
            <input
              value={player}
              onChange={(e) => setPlayer(e.target.value)}
              placeholder="Player name"
              className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm"
            />
            <input
              value={statLabel}
              onChange={(e) => setStatLabel(e.target.value)}
              placeholder="Stat (e.g. PTS)"
              list={`stat-hints-${sport}`}
              className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm"
            />
            <datalist id={`stat-hints-${sport}`}>
              {statHints.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <input
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              placeholder="Line (e.g. 24.5)"
              inputMode="decimal"
              className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm"
            />
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setSide("over")}
                className={`flex-1 rounded px-2 py-1.5 text-sm font-medium ${
                  side === "over" ? "bg-sky-600 text-white" : "bg-neutral-800 text-neutral-400"
                }`}
              >
                Over
              </button>
              <button
                type="button"
                onClick={() => setSide("under")}
                className={`flex-1 rounded px-2 py-1.5 text-sm font-medium ${
                  side === "under" ? "bg-sky-600 text-white" : "bg-neutral-800 text-neutral-400"
                }`}
              >
                Under
              </button>
            </div>
          </div>
        )}
        {error && <p className="text-xs text-rose-400">{error}</p>}
        <button
          type="button"
          onClick={submit}
          disabled={isPending || games.length === 0}
          className="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          Save pick
        </button>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-neutral-300">Your picks</h3>
        {picks.length === 0 ? (
          <p className="text-xs text-neutral-500">No picks yet.</p>
        ) : (
          <div className="space-y-2">
            {picks.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between gap-3 rounded-md border border-neutral-800 px-3 py-2 text-sm"
              >
                <div>
                  <div className="font-medium">
                    {p.player} ({p.team}) — {p.side === "over" ? "O" : "U"} {p.threshold} {p.statLabel}
                  </div>
                  <div className="text-xs text-neutral-500">
                    {p.awayTeam} @ {p.homeTeam}
                    {p.actualValue !== null ? ` — actual: ${p.actualValue}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-xs font-medium ${RESULT_CLASS[p.result]}`}>
                    {RESULT_LABEL[p.result]}
                  </span>
                  {p.result === "pending" && (
                    <button
                      type="button"
                      onClick={() => remove(p.id)}
                      disabled={isPending}
                      className="text-xs text-neutral-500 hover:text-neutral-300"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
