// NBA pick model on top of the tuned Elo (lib/sports/sport-elo.ts).
//
// Backtested on ESPN box scores for 3,944 games (2023-24 through 2025-26):
// tuned on 2024-25, scored on the held-out 2025-26 season (1,237 games with
// enough history on both teams).
//
//                          log loss  Brier   picked winner
//   Elo only                .5985    .2059   68.5%
//   + paint & margin form   .5956    .2044   69.3%   <- what this file adds
//
// Tested and NOT used because they made held-out picks no better or worse:
// rebounds, turnovers, total fouls, offensive fouls, free-throw attempts,
// threes, mid-range makes, last meetings (head-to-head) and the referee
// crew's home-win history. They still appear in every pick's explanation,
// labelled as context, because people want to see them.
//
// Form = each team's average over its last 20 games this season (needs 5+):
//   margin  = points scored minus allowed
//   paint   = points in the paint minus paint points allowed
// Injuries: players listed OUT or suspended lower their team's chance by
// their scoring above a bench replacement. ESPN keeps no history of injury
// reports, so this part can't be backtested; it is capped at 10 points.
export const NBA_FORM_WINDOW = 20;
export const NBA_MIN_GAMES = 5;
const W = { intercept: 0.056, elo: 0.809, mov: 0.089, paint: 0.183 };
const MOV_MEAN = 0.125;
const MOV_SD = 10.88;
const PAINT_MEAN = 0.101;
const PAINT_SD = 9.25;

const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export interface FormRow {
  ms: number;
  mov: number;
  paint: number;
}

export interface TeamForm {
  games: number;
  mov: number; // avg margin, last 20
  paint: number; // avg paint margin, last 20
}

export function formBefore(rows: FormRow[], beforeMs: number): TeamForm | null {
  const prior = rows.filter((r) => r.ms < beforeMs).slice(-NBA_FORM_WINDOW);
  if (prior.length < NBA_MIN_GAMES) return null;
  const avg = (k: "mov" | "paint") => prior.reduce((s, r) => s + r[k], 0) / prior.length;
  return { games: prior.length, mov: avg("mov"), paint: avg("paint") };
}

/** Home win chance from Elo plus recent form. Falls back to Elo when either team has under 5 games. */
export function nbaWinProb(eloHomePct: number, home: TeamForm | null, away: TeamForm | null): number {
  if (!home || !away) return eloHomePct;
  const p = Math.min(0.995, Math.max(0.005, eloHomePct));
  const z =
    W.intercept +
    W.elo * logit(p) +
    (W.mov * (home.mov - away.mov - MOV_MEAN)) / MOV_SD +
    (W.paint * (home.paint - away.paint - PAINT_MEAN)) / PAINT_SD;
  return sigmoid(z);
}

/**
 * Points of scoring a team loses to absences: for each player OUT or
 * suspended, his points per game above a typical bench replacement (8).
 */
export function lostScoring(players: { ppg: number }[]): number {
  return players.reduce((s, p) => s + Math.max(0, p.ppg - 8), 0);
}

/** Shifts a home win chance by the scoring each side is missing; capped at 10 points either way. */
export function applyInjuries(homePct: number, homeLost: number, awayLost: number): { pct: number; shift: number } {
  // About 2.8 win-percentage points per point of scoring margin near a
  // coin flip in the NBA; missing scorers are partly covered by teammates,
  // so only 60% of the lost points count.
  const marginShift = 0.6 * (awayLost - homeLost);
  const z = logit(Math.min(0.995, Math.max(0.005, homePct))) + marginShift * 0.115;
  const raw = sigmoid(z);
  const shift = Math.max(-0.1, Math.min(0.1, raw - homePct));
  return { pct: homePct + shift, shift };
}
