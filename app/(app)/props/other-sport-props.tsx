"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { SportKey } from "@/lib/sports/types";
import type { PlayerOption } from "@/lib/sports/player-options";

const SELECT = "rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm disabled:opacity-50";
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
/** Suggested line: the book's line if one is posted, else the recent average rounded to a half point (no pushes). */
const suggestLine = (avg: number, book: { line: number } | null) => (book ? book.line : Math.max(0.5, Math.floor(avg) + 0.5));

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
  playerOptions,
}: {
  sport: SportKey;
  games: UpcomingGameOption[];
  picks: ExistingPropPick[];
  playerOptions: Record<string, PlayerOption[]>;
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
  const [manual, setManual] = useState(false);

  const game = games.find((g) => g.id === gameId) ?? null;
  const teamPlayers = useMemo(() => (team ? (playerOptions[team] ?? []) : []), [team, playerOptions]);
  const playerOpt = teamPlayers.find((p) => p.player === player) ?? null;
  const statOpt = playerOpt?.stats.find((s) => s.key === statLabel) ?? null;

  const pickGame = (id: number | "") => {
    setGameId(id);
    setTeam("");
    setPlayer("");
    setStatLabel("");
    setThreshold("");
  };
  const pickTeam = (t: string) => {
    setTeam(t);
    setPlayer("");
    setStatLabel("");
    setThreshold("");
  };
  const pickPlayer = (name: string) => {
    setPlayer(name);
    const first = teamPlayers.find((p) => p.player === name)?.stats[0];
    setStatLabel(first?.key ?? "");
    setThreshold(first ? String(suggestLine(first.avg, first.bookLine)) : "");
  };
  const pickStat = (key: string) => {
    setStatLabel(key);
    const s = playerOpt?.stats.find((x) => x.key === key);
    setThreshold(s ? String(suggestLine(s.avg, s.bookLine)) : "");
  };

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
          Pick a game, team, player and stat from the menus. The line fills in from the
          sportsbook when one is posted, otherwise from the player&rsquo;s recent average, and you can
          change it. Once the game is final, it&rsquo;s graded automatically against the real box score.
        </p>
        {games.length === 0 ? (
          <p className="text-xs text-neutral-500">No upcoming games synced yet for this sport.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            <select
              value={gameId}
              onChange={(e) => pickGame(e.target.value ? Number(e.target.value) : "")}
              className={SELECT}
            >
              {games.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.awayTeam} @ {g.homeTeam}
                  {g.kickoffAt
                    ? ` — ${new Date(g.kickoffAt).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })} ET`
                    : ""}
                </option>
              ))}
            </select>
            {manual ? (
              <>
                <input
                  value={team}
                  onChange={(e) => setTeam(e.target.value)}
                  placeholder="Player's team (e.g. LAL)"
                  className={SELECT}
                />
                <input
                  value={player}
                  onChange={(e) => setPlayer(e.target.value)}
                  placeholder="Player name"
                  className={SELECT}
                />
                <input
                  value={statLabel}
                  onChange={(e) => setStatLabel(e.target.value)}
                  placeholder="Stat (box-score label, e.g. PTS)"
                  className={SELECT}
                />
              </>
            ) : (
              <>
                <select value={team} onChange={(e) => pickTeam(e.target.value)} disabled={!game} className={SELECT}>
                  <option value="">Team</option>
                  {game &&
                    [game.awayTeam, game.homeTeam].map((t) => (
                      <option key={t} value={t}>
                        {t}
                        {(playerOptions[t]?.length ?? 0) === 0 ? " (no player data yet)" : ""}
                      </option>
                    ))}
                </select>
                <select
                  value={player}
                  onChange={(e) => pickPlayer(e.target.value)}
                  disabled={teamPlayers.length === 0}
                  className={SELECT}
                >
                  <option value="">{team && teamPlayers.length === 0 ? "No players synced for this team" : "Player"}</option>
                  {teamPlayers.map((p) => (
                    <option key={p.player} value={p.player}>
                      {p.player}
                      {p.position ? ` (${p.position})` : ""}
                      {p.stats[0] ? ` — ${fmt(p.stats[0].avg)} ${p.stats[0].key}` : ""}
                    </option>
                  ))}
                </select>
                <select value={statLabel} onChange={(e) => pickStat(e.target.value)} disabled={!playerOpt} className={SELECT}>
                  <option value="">Stat</option>
                  {playerOpt?.stats.map((st) => (
                    <option key={st.key} value={st.key}>
                      {st.label} — avg {fmt(st.avg)}
                      {st.bookLine ? ` · book ${st.bookLine.line}` : ""}
                    </option>
                  ))}
                </select>
              </>
            )}
            <input
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              placeholder="Line (auto-filled, edit if you like)"
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
        {!manual && statOpt && (
          <p className="text-xs text-neutral-400">
            {player}: {statOpt.label.toLowerCase()} averaged {fmt(statOpt.avg)} over the last{" "}
            {Math.min(10, playerOpt?.games ?? 0)} games
            {statOpt.last5.length ? ` (last ${statOpt.last5.length}: ${statOpt.last5.map(fmt).join(", ")})` : ""}.
            {statOpt.bookLine
              ? ` ${statOpt.bookLine.book} line: ${statOpt.bookLine.line}.`
              : " No sportsbook line posted, so the line is set just above the recent average."}
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            setManual((m) => !m);
            setTeam("");
            setPlayer("");
            setStatLabel("");
            setThreshold("");
          }}
          className="text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-300"
        >
          {manual ? "Use dropdowns instead" : "Player not listed? Type it in"}
        </button>
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
