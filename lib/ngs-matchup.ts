import type { NgsTeamProfile } from "./ngs";

// Small, capped home-win% nudges from Next Gen Stats + PFR pressure data,
// built the same way as lib/team-matchup.ts: each factor is a home-minus-
// away gap divided by a "reference gap" (roughly how far apart real NFL
// teams get), clamped to [-1, 1], times that factor's cap. Caps were set
// from a point-in-time backtest (scripts/backtest.ts, see the numbers
// below) — a factor that didn't beat a coin flip gets a near-zero cap.
//
// Each factor nets offense against defense, e.g. passing = (my QB's CPOE
// minus the CPOE my defense allows) for each team, then home vs away.
const REF_CPOE_GAP = 8; // net CPOE points
const REF_RYOE_GAP = 1.0; // net rush yards over expected per carry
const REF_SEPARATION_GAP = 0.8; // net yards of receiver separation
const REF_PRESSURE_RATE_GAP = 0.1; // share of dropbacks under pressure
const REF_PRESSURES_GAP = 6; // pressures generated per game

// Backtest, 2018-2025 regular seasons (2,119 games, point-in-time — see
// scripts/backtest-ngs.ts), measured ON TOP of the existing model:
//   PRESSURE        hit 58.5% when it fired, lowers Brier  -> kept
//   NGS_SEPARATION  hit 53.9%, lowers Brier slightly        -> kept, small
//   NGS_PASSING     hit 55.0% but RAISES Brier              -> cap 0
//   NGS_RUSHING     hit 54.4% but RAISES Brier              -> cap 0
// Passing/rushing do pick winners, but they mostly repeat what the
// existing EPA-based SCHEME_OFF/SCHEME_DEF factors already say, so adding
// them double-counts. Their caps stay at 0 until a retest says otherwise.
// Caps below were fit on 2018-2023 and checked on 2024-2025 held out:
// Brier 0.22260 -> 0.22231, accuracy 62.62% -> 63.17% (n=543).
export const NGS_CAPS = {
  NGS_PASSING: 0,
  NGS_RUSHING: 0,
  NGS_SEPARATION: 0.01,
  PRESSURE: 0.02,
  TOTAL: 0.03,
};

const MIN_WEEKS = 3;

const norm = (diff: number, ref: number) => Math.max(-1, Math.min(1, diff / ref));

export interface NgsAdjustments {
  ngsPassingAdjPct: number;
  ngsRushingAdjPct: number;
  ngsSeparationAdjPct: number;
  pressureAdjPct: number;
  totalAdjPct: number;
}

const ZERO: NgsAdjustments = {
  ngsPassingAdjPct: 0,
  ngsRushingAdjPct: 0,
  ngsSeparationAdjPct: 0,
  pressureAdjPct: 0,
  totalAdjPct: 0,
};

function net(off: number | null, allowed: number | null): number | null {
  return off === null || allowed === null ? null : off - allowed;
}

export function computeNgsAdjustments(
  home: NgsTeamProfile | undefined,
  away: NgsTeamProfile | undefined,
  caps = NGS_CAPS
): NgsAdjustments {
  if (!home || !away || home.weeks < MIN_WEEKS || away.weeks < MIN_WEEKS) return ZERO;

  const hp = net(home.cpoe, home.cpoeAllowed);
  const ap = net(away.cpoe, away.cpoeAllowed);
  const ngsPassingAdjPct = hp !== null && ap !== null ? norm(hp - ap, REF_CPOE_GAP) * caps.NGS_PASSING : 0;

  const hr = net(home.ryoePerCarry, home.ryoeAllowedPerCarry);
  const ar = net(away.ryoePerCarry, away.ryoeAllowedPerCarry);
  const ngsRushingAdjPct = hr !== null && ar !== null ? norm(hr - ar, REF_RYOE_GAP) * caps.NGS_RUSHING : 0;

  const hs = net(home.separation, home.separationAllowed);
  const as = net(away.separation, away.separationAllowed);
  const ngsSeparationAdjPct =
    hs !== null && as !== null ? norm(hs - as, REF_SEPARATION_GAP) * caps.NGS_SEPARATION : 0;

  // Pressure: generating more pressure is good, allowing a higher pressure
  // rate on your own QB is bad. Average the two halves that are available.
  const parts: number[] = [];
  if (home.pressuresPerGame !== null && away.pressuresPerGame !== null) {
    parts.push(norm(home.pressuresPerGame - away.pressuresPerGame, REF_PRESSURES_GAP));
  }
  if (home.pressureRateAllowed !== null && away.pressureRateAllowed !== null) {
    parts.push(norm(away.pressureRateAllowed - home.pressureRateAllowed, REF_PRESSURE_RATE_GAP));
  }
  const pressureAdjPct = parts.length
    ? (parts.reduce((a, b) => a + b, 0) / parts.length) * caps.PRESSURE
    : 0;

  const raw = ngsPassingAdjPct + ngsRushingAdjPct + ngsSeparationAdjPct + pressureAdjPct;
  const totalAdjPct = Math.max(-caps.TOTAL, Math.min(caps.TOTAL, raw));
  const scale = raw !== 0 ? totalAdjPct / raw : 1;
  return {
    ngsPassingAdjPct: ngsPassingAdjPct * scale,
    ngsRushingAdjPct: ngsRushingAdjPct * scale,
    ngsSeparationAdjPct: ngsSeparationAdjPct * scale,
    pressureAdjPct: pressureAdjPct * scale,
    totalAdjPct,
  };
}
