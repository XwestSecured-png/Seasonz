import type { TeamFpi } from "./espn";

// Same small-bounded-nudge philosophy as lib/weather.ts, lib/referee.ts, and
// lib/team-matchup.ts — ESPN's FPI and Total QBR are real, independently
// produced ratings, but the model still treats them as a capped adjustment
// on top of its own Elo + nflverse-derived factors, not a re-derivation.
//
// Two deliberate scope calls, both worth stating plainly:
//  - FPI's own offense/defense/special-teams sub-ratings are NOT pulled in
//    as separate weights. The model already has its own offensive/defensive
//    scheme factors from nflverse play-by-play (lib/team-matchup.ts) —
//    adding FPI's version of the same idea would double-count the same
//    underlying signal under a different label. Only the single overall FPI
//    number is weighted.
//  - Strength of schedule is stored (games.sosHome / games.sosAway) for
//    display, but NOT weighted. SOS describes how hard a team's full-season
//    slate has been, which has no clean directional read on a single
//    upcoming matchup — weighting it would be an arbitrary knob, not an
//    honest signal.
const REFERENCE_FPI_GAP = 20; // FPI points between a very good and very bad team
const REFERENCE_QBR_GAP = 30; // Total QBR points between an elite and a poor starter

const CAP_FPI_PCT = 0.03;
const CAP_QBR_PCT = 0.02;
const CAP_TOTAL_PCT = 0.04; // overall ceiling across both combined

function normalizedDiff(diff: number, referenceGap: number): number {
  return Math.max(-1, Math.min(1, diff / referenceGap));
}

export interface EspnFactorAdjustments {
  fpiAdjPct: number;
  qbrAdjPct: number;
  totalAdjPct: number; // sum of the two above, clamped to CAP_TOTAL_PCT
}

const ZERO: EspnFactorAdjustments = { fpiAdjPct: 0, qbrAdjPct: 0, totalAdjPct: 0 };

/** Home-perspective win% nudges from ESPN FPI + Total QBR — zero for either side missing data. */
export function computeEspnFactorAdjustments(
  homeFpi: TeamFpi | undefined,
  awayFpi: TeamFpi | undefined,
  homeQbr: number | undefined,
  awayQbr: number | undefined
): EspnFactorAdjustments {
  const fpiAdjPct =
    homeFpi && awayFpi
      ? normalizedDiff(homeFpi.fpi - awayFpi.fpi, REFERENCE_FPI_GAP) * CAP_FPI_PCT
      : 0;

  const qbrAdjPct =
    homeQbr !== undefined && awayQbr !== undefined
      ? normalizedDiff(homeQbr - awayQbr, REFERENCE_QBR_GAP) * CAP_QBR_PCT
      : 0;

  if (fpiAdjPct === 0 && qbrAdjPct === 0) return ZERO;

  const rawTotal = fpiAdjPct + qbrAdjPct;
  const totalAdjPct = Math.max(-CAP_TOTAL_PCT, Math.min(CAP_TOTAL_PCT, rawTotal));

  // Same proportional-scaling fix used in lib/team-matchup.ts: when the
  // overall cap bites, scale both components down together so the stored
  // per-factor numbers still add up to what was actually applied.
  const scale = rawTotal !== 0 ? totalAdjPct / rawTotal : 1;

  return {
    fpiAdjPct: fpiAdjPct * scale,
    qbrAdjPct: qbrAdjPct * scale,
    totalAdjPct,
  };
}
