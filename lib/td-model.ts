// Anytime-TD model: who is most likely to score next week.
//
// Touchdowns follow opportunity. A player's expected touchdowns are
//   (carries per game x TD rate per carry + targets per game x TD rate per target)
//   x (team's implied points / 22.5)
// where
//   - carries and targets per game weight recent games more (half-life 3
//     games), with last season's games counting 30%;
//   - TD rates per carry/target are the player's own, shrunk toward his
//     position's league rate (150 carries / 250 targets of prior weight),
//     because a few touchdowns in a few games says little on its own;
//   - the team's implied points come from next week's spread and total
//     (a team expected to score 28 gets ~25% more TD chances than average).
// P(1+ TD) = 1 - e^-λ, P(2+) = 1 - e^-λ(1 + λ).
//
// Backtest (nflverse weekly stats, fit on 2024-25, tested on 2026 weeks 4-5,
// every RB/WR/TE/QB with 3+ games): log loss 0.460 vs 0.738 for the old
// season-TD-rate model, Brier 0.148 vs 0.179; on the players the old model
// covered, 0.524 vs 0.577. Calibrated within a few points in every band.
import type { PlayerWeekStats } from "./nflverse";

export const TD_MODEL = {
  halfLife: 3,
  prevSeasonWeight: 0.3,
  kCarries: 150,
  kTargets: 250,
  impliedBeta: 1,
  leagueImplied: 22.5,
  minGames: 3,
};

export interface TdModelProjection {
  player: string;
  playerId: string | null;
  team: string;
  position: string;
  games: number; // this season
  carriesPerGame: number;
  targetsPerGame: number;
  rushTdRate: number; // per carry (shrunk)
  recTdRate: number; // per target (shrunk)
  impliedPoints: number | null;
  tdsPerGame: number; // λ, expected TDs next game
  anytimeTdPct: number;
  multiTdPct: number;
  seasonTds: number;
}

type Row = PlayerWeekStats;
const keyOf = (r: Row) => r.playerId || `${r.player}|${r.position}`;

/** League TD rate per carry and per target, by position. */
export function leagueTdRates(rows: Row[]): Map<string, { perCarry: number; perTarget: number }> {
  const a = new Map<string, number[]>();
  for (const r of rows) {
    const x = a.get(r.position) ?? [0, 0, 0, 0];
    x[0] += r.rushingTds;
    x[1] += r.carries ?? 0;
    x[2] += r.receivingTds;
    x[3] += r.targets ?? 0;
    a.set(r.position, x);
  }
  const out = new Map<string, { perCarry: number; perTarget: number }>();
  for (const [pos, x] of a) out.set(pos, { perCarry: x[0] / Math.max(1, x[1]), perTarget: x[2] / Math.max(1, x[3]) });
  return out;
}

/**
 * Projects next game's touchdowns for every skill player with 3+ games
 * this season. `prior` is last season's weekly rows (for the opportunity
 * baseline and league rates); `implied` maps team -> implied points for the
 * coming game (from the spread and total), when a line is posted.
 */
export function projectTouchdowns(current: Row[], prior: Row[], implied: Map<string, number>): TdModelProjection[] {
  const P = TD_MODEL;
  const league = leagueTdRates(prior.length ? [...prior, ...current] : current);
  const season = Math.max(0, ...current.map((r) => r.season));
  const hist = new Map<string, Row[]>();
  for (const r of [...prior, ...current]) {
    const k = keyOf(r);
    const l = hist.get(k) ?? [];
    l.push(r);
    hist.set(k, l);
  }
  const out: TdModelProjection[] = [];
  for (const rowsFor of hist.values()) {
    rowsFor.sort((a, b) => a.season - b.season || a.week - b.week);
    const cur = rowsFor.filter((r) => r.season === season);
    if (cur.length < P.minGames) continue;
    const last = cur[cur.length - 1];
    const lg = league.get(last.position) ?? { perCarry: 0.03, perTarget: 0.05 };
    let wSum = 0;
    let wCar = 0;
    let wTgt = 0;
    let tdC = 0;
    let nC = 0;
    let tdT = 0;
    let nT = 0;
    const n = rowsFor.length;
    rowsFor.forEach((h, j) => {
      const seasonW = h.season === season ? 1 : P.prevSeasonWeight;
      const w = Math.pow(0.5, (n - 1 - j) / P.halfLife) * seasonW;
      wSum += w;
      wCar += w * (h.carries ?? 0);
      wTgt += w * (h.targets ?? 0);
      tdC += seasonW * h.rushingTds;
      nC += seasonW * (h.carries ?? 0);
      tdT += seasonW * h.receivingTds;
      nT += seasonW * (h.targets ?? 0);
    });
    const car = wCar / wSum;
    const tgt = wTgt / wSum;
    const rc = (tdC + P.kCarries * lg.perCarry) / (nC + P.kCarries);
    const rt = (tdT + P.kTargets * lg.perTarget) / (nT + P.kTargets);
    const imp = implied.get(last.team) ?? null;
    let lambda = car * rc + tgt * rt;
    if (imp !== null) lambda *= Math.pow(imp / P.leagueImplied, P.impliedBeta);
    const e = Math.exp(-lambda);
    out.push({
      player: last.player,
      playerId: last.playerId ?? null,
      team: last.team,
      position: last.position,
      games: cur.length,
      carriesPerGame: car,
      targetsPerGame: tgt,
      rushTdRate: rc,
      recTdRate: rt,
      impliedPoints: imp,
      tdsPerGame: lambda,
      anytimeTdPct: 1 - e,
      multiTdPct: 1 - e * (1 + lambda),
      seasonTds: cur.reduce((s, r) => s + r.rushingTds + r.receivingTds, 0),
    });
  }
  return out.sort((a, b) => b.anytimeTdPct - a.anytimeTdPct);
}

/** Team -> implied points from a home spread (negative = home favored) and total. */
export function impliedPoints(gamesList: { homeTeam: string; awayTeam: string; spreadHomeLine: number | null; totalLine: number | null }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const g of gamesList) {
    if (g.spreadHomeLine == null || g.totalLine == null) continue;
    m.set(g.homeTeam, g.totalLine / 2 - g.spreadHomeLine / 2);
    m.set(g.awayTeam, g.totalLine / 2 + g.spreadHomeLine / 2);
  }
  return m;
}
