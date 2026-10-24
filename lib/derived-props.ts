// Props built from other projections (1.23.0).
//
//  First TD / Last TD: a player's share of the game's expected touchdowns
//  (his "Anytime TD" expectation over both teams' total) times the chance
//  the game has a touchdown at all: p = lambda / Lambda x (1 - e^-Lambda).
//  Last TD is the same by symmetry. Box scores don't record scoring order,
//  so these can't be graded: they show on the Props page but never become
//  picks (DISPLAY_ONLY_STATS).
//
//  NFL longest catch / run: nflverse doesn't publish each player's longest
//  play, so it's built from expected catches (or carries) and yards per
//  catch (or carry): see the "longest" distribution in lib/prop-dist.ts.
//  Display only in the NFL for the same reason (no way to grade it).
//  College box scores list the longest play, so college projects it
//  directly and grades it like any other stat.
import type { PropModelConfig, Projection } from "./prop-dist";

export const DISPLAY_ONLY_STATS = new Set(["First TD", "Last TD"]);
export const NFL_DISPLAY_ONLY_STATS = new Set(["First TD", "Last TD", "Longest Reception", "Longest Rush"]);

interface AvgLike {
  player: string;
  team: string;
  statType: string;
  average: number;
  stdDev: number;
  games: number;
  proj?: Projection;
  cfg?: PropModelConfig;
  values?: number[];
}

const POISSON: PropModelConfig = { dist: "poisson", sdMult: 1, shrinkK: 0, useMinutes: false };
const LONGEST: PropModelConfig = { dist: "longest", sdMult: 1, shrinkK: 0, useMinutes: false };

/** Adds First TD / Last TD (and, for the NFL, longest catch/run) entries to `averages`. */
export function addDerivedProps<T extends AvgLike>(averages: Map<string, T>, opponentOf: Map<string, string>, opts: { longest: boolean }): number {
  const make = (base: T, statType: string, proj: Projection, cfg: PropModelConfig): T =>
    ({ ...base, statType, average: proj.mean, stdDev: proj.sd, proj, cfg }) as T;
  let added = 0;
  // Expected touchdowns per team this week.
  const teamTd = new Map<string, number>();
  for (const a of averages.values()) {
    if (a.statType !== "Anytime TD" || !a.proj || !opponentOf.has(a.team)) continue;
    teamTd.set(a.team, (teamTd.get(a.team) ?? 0) + Math.max(0, a.proj.mean));
  }
  const extra: T[] = [];
  for (const a of averages.values()) {
    if (a.statType === "Anytime TD" && a.proj && opponentOf.has(a.team)) {
      const game = (teamTd.get(a.team) ?? 0) + (teamTd.get(opponentOf.get(a.team)!) ?? 0);
      if (game > 0 && a.proj.mean > 0) {
        const p = Math.min(0.6, (a.proj.mean / game) * (1 - Math.exp(-game)));
        const proj: Projection = { mean: -Math.log(1 - p), sd: 0, nbSize: null, games: a.proj.games };
        extra.push(make(a, "First TD", proj, POISSON), make(a, "Last TD", proj, POISSON));
      }
    }
    if (opts.longest && (a.statType === "Receptions" || a.statType === "Rush Attempts") && a.proj && a.proj.mean > 0) {
      const yds = averages.get(`${a.player}|${a.statType === "Receptions" ? "Rec Yds" : "Rush Yds"}`);
      if (yds && yds.average > 0) {
        const perPlay = yds.average / Math.max(0.5, a.proj.mean);
        if (perPlay > 0) extra.push(make(a, a.statType === "Receptions" ? "Longest Reception" : "Longest Rush", { mean: a.proj.mean, sd: perPlay, nbSize: null, games: a.proj.games }, LONGEST));
      }
    }
  }
  for (const e of extra) {
    const k = `${e.player}|${e.statType}`;
    if (!averages.has(k)) {
      averages.set(k, e);
      added++;
    }
  }
  return added;
}
