import { MIN_GAMES_FOR_FACTORS, type TeamSeasonFactors } from "./team-factors";

// Same philosophy as lib/weather.ts and lib/referee.ts: small, bounded,
// documented nudges to the model's pre-game home win% — not a re-derivation
// of anything, just honest, capped defaults you can retune once Model
// Tracker has graded enough games to tell you whether they're pulling their
// weight.
//
// Each factor is a differential (home - away, or the trench-matchup
// equivalent) divided by a "reference gap" — roughly how far apart two
// real NFL teams get on that stat — then clamped to that factor's own cap.
// All six are then summed and clamped again to an overall ceiling, so a
// freak game where every single factor points the same way still can't
// swing the model further than that ceiling allows.
const REFERENCE_EPA_GAP = 10; // offense/defense EPA-per-game gap that counts as "full strength"
const REFERENCE_TURNOVER_GAP = 1.0; // turnover-margin-per-game gap for "full strength"
const REFERENCE_PENALTY_GAP = 3.0; // penalties-per-game gap for "full strength"
const REFERENCE_TRENCH_GAP = 2.0; // combined pressure-vs-protection gap for "full strength"
const REFERENCE_AGGRESSION_GAP = 0.2; // 2pt-conversions-per-game gap for "full strength"

// Backtested against 10 completed seasons (2015-2024, 2,614 games,
// point-in-time cutoffs so no factor ever sees a future week — see
// scripts/backtest.ts). Per-factor hit rate when each factor actually fired:
// SCHEME_OFF 63.2% (n=2038), TRENCHES 58.4% (n=2017), TURNOVER 58.1%
// (n=1953), SCHEME_DEF 54.6% (n=2038), PENALTY 53.0% (n=1979), AGGRESSION
// 50.3% (n=1399). The first four are solidly above a coin flip; AGGRESSION's
// 50.3% over a large sample is statistically indistinguishable from random
// (95% CI roughly 47.7-52.9%) — the 2pt-rate proxy genuinely isn't earning
// its weight, so its cap was shrunk rather than left where a hand-picked
// default happened to put it. SCHEME_OFF's cap was nudged up to match its
// real edge. The other four caps are left as the original honest defaults —
// backtested now, not re-derived from nothing.
const CAP_SCHEME_OFF_PCT = 0.025; // raised from 0.02 — the strongest of the six, by a clear margin
const CAP_SCHEME_DEF_PCT = 0.02;
const CAP_TURNOVER_PCT = 0.02;
const CAP_PENALTY_PCT = 0.01;
const CAP_TRENCHES_PCT = 0.015;
const CAP_AGGRESSION_PCT = 0.002; // shrunk from 0.005 — backtested hit rate is statistically noise
const CAP_TOTAL_PCT = 0.06; // overall ceiling across all six combined — sweep found no pressure to move this

function normalizedDiff(diff: number, referenceGap: number): number {
  return Math.max(-1, Math.min(1, diff / referenceGap));
}

export interface TeamFactorAdjustments {
  schemeOffAdjPct: number;
  schemeDefAdjPct: number;
  turnoverAdjPct: number;
  penaltyAdjPct: number;
  trenchesAdjPct: number;
  aggressionAdjPct: number;
  totalAdjPct: number; // sum of the six above, clamped to CAP_TOTAL_PCT
}

const ZERO: TeamFactorAdjustments = {
  schemeOffAdjPct: 0,
  schemeDefAdjPct: 0,
  turnoverAdjPct: 0,
  penaltyAdjPct: 0,
  trenchesAdjPct: 0,
  aggressionAdjPct: 0,
  totalAdjPct: 0,
};

/** Home-perspective win% nudges from six season-to-date team factors — zero across the board until both teams clear the minimum sample. */
export function computeTeamFactorAdjustments(
  home: TeamSeasonFactors | undefined,
  away: TeamSeasonFactors | undefined
): TeamFactorAdjustments {
  if (
    !home ||
    !away ||
    home.gamesPlayed < MIN_GAMES_FOR_FACTORS ||
    away.gamesPlayed < MIN_GAMES_FOR_FACTORS
  ) {
    return ZERO;
  }

  // Offensive scheme: whoever's own offense is actually producing more.
  const schemeOffAdjPct =
    normalizedDiff(home.offEpaPerGame - away.offEpaPerGame, REFERENCE_EPA_GAP) * CAP_SCHEME_OFF_PCT;

  // Defensive scheme: whoever's defense allows LESS gets the positive nudge,
  // so this is away-allowed minus home-allowed (home benefits when its
  // defense is stingier than the away team's).
  const schemeDefAdjPct =
    normalizedDiff(away.defEpaAllowedPerGame - home.defEpaAllowedPerGame, REFERENCE_EPA_GAP) *
    CAP_SCHEME_DEF_PCT;

  const turnoverAdjPct =
    normalizedDiff(home.turnoverMarginPerGame - away.turnoverMarginPerGame, REFERENCE_TURNOVER_GAP) *
    CAP_TURNOVER_PCT;

  // Fewer penalties is better, so this is away's rate minus home's.
  const penaltyAdjPct =
    normalizedDiff(away.penaltiesPerGame - home.penaltiesPerGame, REFERENCE_PENALTY_GAP) *
    CAP_PENALTY_PCT;

  // Trenches: each team's own net differential (pressure generated minus
  // sacks allowed) — a team that gets after the passer and protects its own
  // QB has a good trench profile. Compare the two teams' net differentials.
  const homeTrenchNet = home.pressuresPerGame - home.sacksAllowedPerGame;
  const awayTrenchNet = away.pressuresPerGame - away.sacksAllowedPerGame;
  const trenchesAdjPct =
    normalizedDiff(homeTrenchNet - awayTrenchNet, REFERENCE_TRENCH_GAP) * CAP_TRENCHES_PCT;

  const aggressionAdjPct =
    normalizedDiff(home.twoPtPerGame - away.twoPtPerGame, REFERENCE_AGGRESSION_GAP) *
    CAP_AGGRESSION_PCT;

  const rawTotal =
    schemeOffAdjPct + schemeDefAdjPct + turnoverAdjPct + penaltyAdjPct + trenchesAdjPct + aggressionAdjPct;
  const totalAdjPct = Math.max(-CAP_TOTAL_PCT, Math.min(CAP_TOTAL_PCT, rawTotal));

  // When the overall cap actually bites, scale every component down by the
  // same factor rather than clamping only the total — otherwise the six
  // stored per-factor numbers would no longer add up to what actually got
  // applied to homeWinPctPre, and the Model Tracker tooltip would show a
  // "Total" that doesn't match its own parts.
  const scale = rawTotal !== 0 ? totalAdjPct / rawTotal : 1;

  return {
    schemeOffAdjPct: schemeOffAdjPct * scale,
    schemeDefAdjPct: schemeDefAdjPct * scale,
    turnoverAdjPct: turnoverAdjPct * scale,
    penaltyAdjPct: penaltyAdjPct * scale,
    trenchesAdjPct: trenchesAdjPct * scale,
    aggressionAdjPct: aggressionAdjPct * scale,
    totalAdjPct,
  };
}
