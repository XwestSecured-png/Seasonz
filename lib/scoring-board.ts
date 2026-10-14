// The TDs & Turnovers board: every player's touchdowns, interceptions and
// fumbles this season by week, plus next week's anytime-TD chances. Built in
// the NFL modelProps stage and stored in app_settings "nflScoringBoard" so the
// page doesn't download nflverse's season file on every view.
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import type { ScoringEventRow } from "./nflverse";
import type { TdModelProjection } from "./td-model";

export type EventKey = Exclude<keyof ScoringEventRow, "week" | "team" | "opponent" | "playerId" | "player" | "position">;
export const EVENT_KEYS: EventKey[] = ["passTd", "rushTd", "recTd", "returnTd", "defTd", "intThrown", "defInt", "fumbles", "fumblesLost", "forced", "recovered"];

export interface BoardPlayer {
  id: string;
  player: string;
  team: string;
  position: string;
  totals: Record<EventKey, number>;
  /** week -> compact counts (only nonzero keys), with opponent. */
  weeks: { w: number; opp: string; e: Partial<Record<EventKey, number>> }[];
}

export interface BoardPick {
  player: string;
  team: string;
  position: string;
  chance: number;
  multi: number;
  expected: number;
  carries: number;
  targets: number;
  implied: number | null;
  seasonTds: number;
  games: number;
}

export interface ScoringBoard {
  season: number;
  throughWeek: number;
  nextWeek: number;
  updatedAt: string;
  players: BoardPlayer[];
  next: BoardPick[];
}

export function buildScoringBoard(season: number, nextWeek: number, events: ScoringEventRow[], projections: TdModelProjection[]): ScoringBoard {
  const by = new Map<string, BoardPlayer>();
  const lastWeek = new Map<string, number>();
  let through = 0;
  for (const e of events) {
    through = Math.max(through, e.week);
    let p = by.get(e.playerId);
    if (!p) {
      p = {
        id: e.playerId,
        player: e.player,
        team: e.team,
        position: e.position,
        totals: Object.fromEntries(EVENT_KEYS.map((k) => [k, 0])) as Record<EventKey, number>,
        weeks: [],
      };
      by.set(e.playerId, p);
    }
    const compact: Partial<Record<EventKey, number>> = {};
    for (const k of EVENT_KEYS) {
      if (e[k]) {
        p.totals[k] += e[k];
        compact[k] = e[k];
      }
    }
    p.weeks.push({ w: e.week, opp: e.opponent, e: compact });
    // Latest team (trades).
    if (e.week >= (lastWeek.get(e.playerId) ?? 0)) {
      lastWeek.set(e.playerId, e.week);
      p.team = e.team;
    }
  }
  for (const p of by.values()) p.weeks.sort((a, b) => a.w - b.w);
  return {
    season,
    throughWeek: through,
    nextWeek,
    updatedAt: new Date().toISOString(),
    players: [...by.values()],
    next: projections.slice(0, 150).map((p) => ({
      player: p.player,
      team: p.team,
      position: p.position,
      chance: +p.anytimeTdPct.toFixed(4),
      multi: +p.multiTdPct.toFixed(4),
      expected: +p.tdsPerGame.toFixed(3),
      carries: +p.carriesPerGame.toFixed(1),
      targets: +p.targetsPerGame.toFixed(1),
      implied: p.impliedPoints === null ? null : +p.impliedPoints.toFixed(1),
      seasonTds: p.seasonTds,
      games: p.games,
    })),
  };
}

export async function saveScoringBoard(b: ScoringBoard): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key: "nflScoringBoard", value: b })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: b, updatedAt: sql`now()` } });
}

export async function getScoringBoard(): Promise<ScoringBoard | null> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "nflScoringBoard"));
  return (row?.value as ScoringBoard) ?? null;
}
