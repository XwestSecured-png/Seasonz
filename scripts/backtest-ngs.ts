// Point-in-time backtest for the Next Gen Stats / PFR pressure factors
// (lib/ngs.ts, lib/ngs-matchup.ts). Run with: npx tsx scripts/backtest-ngs.ts
//
// For every regular-season game 2018-2025 it builds the existing model's
// prediction (Elo + weather + referee + team factors) using only weeks
// BEFORE the game, then measures what each NGS factor adds: hit rate when
// it fires, and the Brier score at a range of caps, so each cap is chosen
// from data instead of picked by hand.
import { fetchAllRegSeasonGames, fetchPlayerWeekStats, fetchTeamWeekStats } from "../lib/nflverse";
import { replayElo } from "../lib/elo";
import { computeTeamPassShare } from "../lib/pass-reliance";
import { computeWeatherAdjustment } from "../lib/weather";
import { computeRefereeBias } from "../lib/referee";
import { computeTeamSeasonFactors } from "../lib/team-factors";
import { computeTeamFactorAdjustments } from "../lib/team-matchup";
import { fetchNgsTeamWeeks, computeNgsProfiles, opponentMap } from "../lib/ngs";
import { computeNgsAdjustments } from "../lib/ngs-matchup";

const SEASONS = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
const KEYS = ["NGS_PASSING", "NGS_RUSHING", "NGS_SEPARATION", "PRESSURE"] as const;
type Key = (typeof KEYS)[number];

interface Row {
  season: number;
  base: number;
  homeWin: boolean;
  signal: Record<Key, number>; // factor value at cap = 1 (i.e. normalized -1..1)
}

const UNIT = { NGS_PASSING: 1, NGS_RUSHING: 1, NGS_SEPARATION: 1, PRESSURE: 1, TOTAL: 99 };

function brier(rows: Row[], caps: Record<Key, number>, total = 0.03) {
  let s = 0;
  let correct = 0;
  for (const r of rows) {
    let adj = 0;
    for (const k of KEYS) adj += r.signal[k] * caps[k];
    adj = Math.max(-total, Math.min(total, adj));
    const p = Math.max(0.001, Math.min(0.999, r.base + adj));
    s += (p - (r.homeWin ? 1 : 0)) ** 2;
    if (p > 0.5 === r.homeWin) correct++;
  }
  return { brier: s / rows.length, acc: correct / rows.length };
}

async function main() {
  const allGames = await fetchAllRegSeasonGames();
  const rows: Row[] = [];
  for (const season of SEASONS) {
    const [teamWeek, playerWeek, ngsWeek] = await Promise.all([
      fetchTeamWeekStats(season),
      fetchPlayerWeekStats(season),
      fetchNgsTeamWeeks(season),
    ]);
    const sched = allGames.filter((g) => g.season === season);
    const opps = opponentMap(sched);
    const { results } = replayElo(sched);
    let n = 0;
    for (const r of results) {
      const g = r.game;
      if (g.homeScore === null || g.awayScore === null || g.homeScore === g.awayScore) continue;
      const wk = g.week;
      const tf = computeTeamSeasonFactors(teamWeek.filter((x) => x.week < wk));
      const ps = computeTeamPassShare(playerWeek.filter((x) => x.week < wk));
      const w = computeWeatherAdjustment(g.roof, g.tempF, g.windMph, ps.get(g.homeTeam) ?? 0.6, ps.get(g.awayTeam) ?? 0.6);
      const ref = computeRefereeBias(
        g.referee,
        allGames.filter((x) => x.season < season || (x.season === season && x.week < wk))
      );
      const f = computeTeamFactorAdjustments(tf.get(g.homeTeam), tf.get(g.awayTeam));
      const prof = computeNgsProfiles(ngsWeek.filter((x) => x.week < wk), opps);
      const s = computeNgsAdjustments(prof.get(g.homeTeam), prof.get(g.awayTeam), UNIT);
      rows.push({
        season,
        base: r.homeWinProbPre + w.adjPct + ref.adjPct + f.totalAdjPct,
        homeWin: g.homeScore > g.awayScore,
        signal: {
          NGS_PASSING: s.ngsPassingAdjPct,
          NGS_RUSHING: s.ngsRushingAdjPct,
          NGS_SEPARATION: s.ngsSeparationAdjPct,
          PRESSURE: s.pressureAdjPct,
        },
      });
      n++;
    }
    const fired = rows.filter((x) => x.season === season && x.signal.PRESSURE !== 0).length;
    console.log(`${season}: ${n} games, ngs team-weeks=${ngsWeek.length}, pressure fired=${fired}`);
  }

  const zero = { NGS_PASSING: 0, NGS_RUSHING: 0, NGS_SEPARATION: 0, PRESSURE: 0 };
  const b0 = brier(rows, zero);
  console.log(`\nBaseline (current model) n=${rows.length} acc=${(b0.acc * 100).toFixed(2)}% brier=${b0.brier.toFixed(5)}`);

  for (const k of KEYS) {
    const fired = rows.filter((r) => r.signal[k] !== 0);
    const hits = fired.filter((r) => r.signal[k] > 0 === r.homeWin).length;
    console.log(`\n${k}: fired n=${fired.length} hit rate=${((hits / fired.length) * 100).toFixed(1)}%`);
    let best = { cap: 0, brier: b0.brier };
    for (const cap of [0, 0.005, 0.01, 0.015, 0.02, 0.03, 0.04, 0.05]) {
      const res = brier(rows, { ...zero, [k]: cap }, 1);
      console.log(`  cap ${cap.toFixed(3)}: brier=${res.brier.toFixed(5)} acc=${(res.acc * 100).toFixed(2)}%`);
      if (res.brier < best.brier) best = { cap, brier: res.brier };
    }
    console.log(`  best cap alone: ${best.cap}`);
  }

  // Joint grid over the four caps (coarse), with the total ceiling.
  const grid = [0, 0.005, 0.01, 0.02, 0.03];
  let best = { caps: zero as Record<Key, number>, brier: b0.brier, total: 0 };
  for (const a of grid) for (const b of grid) for (const c of grid) for (const d of grid) for (const t of [0.03, 0.05, 0.08]) {
    const caps = { NGS_PASSING: a, NGS_RUSHING: b, NGS_SEPARATION: c, PRESSURE: d };
    const res = brier(rows, caps, t);
    if (res.brier < best.brier - 1e-9) best = { caps, brier: res.brier, total: t };
  }
  const fin = brier(rows, best.caps, best.total);
  console.log(`\nBest joint caps: ${JSON.stringify(best.caps)} total=${best.total} brier=${fin.brier.toFixed(5)} acc=${(fin.acc * 100).toFixed(2)}%`);

  // Hold-out check: fit on 2018-2023, test on 2024-2025.
  const train = rows.filter((r) => r.season <= 2023);
  const test = rows.filter((r) => r.season >= 2024);
  let bt = { caps: zero as Record<Key, number>, brier: brier(train, zero).brier, total: 0.03 };
  for (const a of grid) for (const b of grid) for (const c of grid) for (const d of grid) for (const t of [0.03, 0.05, 0.08]) {
    const caps = { NGS_PASSING: a, NGS_RUSHING: b, NGS_SEPARATION: c, PRESSURE: d };
    const res = brier(train, caps, t);
    if (res.brier < bt.brier - 1e-9) bt = { caps, brier: res.brier, total: t };
  }
  const tb = brier(test, zero);
  const ta = brier(test, bt.caps, bt.total);
  console.log(`Hold-out 2024-25: fit caps ${JSON.stringify(bt.caps)} total=${bt.total}`);
  console.log(`  baseline acc=${(tb.acc * 100).toFixed(2)}% brier=${tb.brier.toFixed(5)}  ->  with NGS acc=${(ta.acc * 100).toFixed(2)}% brier=${ta.brier.toFixed(5)}  (n=${test.length})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
