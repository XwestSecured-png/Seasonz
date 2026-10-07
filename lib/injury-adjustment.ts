import type { InjuryImpactRow } from "./injury-impact";

// Folds this week's injury-impact estimates (lib/injury-impact.ts) into the
// model's pre-game win% as its own capped nudge — same small-and-bounded
// philosophy as weather/referee/team-factors/ESPN, except the cap here is
// deliberately the largest in the model: a starting QB being OUT is a real,
// well-evidenced swing (see QB_OUT_WIN_PCT_IMPACT in lib/injury-impact.ts),
// not a proxy signal like trench stats or penalty rate.
//
// Only OUT designations count — Doubtful/Questionable carry too much
// "will they even sit" uncertainty to treat as a real absence for the
// model's own win% math (they still show, unadjusted, on Injury Impact).
const CAP_INJURY_PCT = 0.1;

/** Sums each team's OUT-player win% impact for the week — the raw, uncapped per-team total used for the Model Tracker tooltip. */
export function sumTeamInjuryImpact(impactRows: InjuryImpactRow[]): Map<string, number> {
  const byTeam = new Map<string, number>();
  for (const row of impactRows) {
    if (row.status !== "OUT" || row.winPctImpact === null) continue;
    byTeam.set(row.team, (byTeam.get(row.team) ?? 0) + row.winPctImpact);
  }
  return byTeam;
}

/** Home-perspective win% nudge from the two teams' injury situations, capped. */
export function computeInjuryAdjustment(homeImpact: number, awayImpact: number): number {
  const rawDiff = homeImpact - awayImpact;
  return Math.max(-CAP_INJURY_PCT, Math.min(CAP_INJURY_PCT, rawDiff));
}
