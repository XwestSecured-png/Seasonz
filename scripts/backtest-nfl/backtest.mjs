// NFL backtest: tune Elo (carryover, K, HFA, rest), then blend with the closing moneyline.
import fs from "fs";
let text = fs.existsSync("games.csv") ? fs.readFileSync("games.csv", "utf8") : null;
if (!text) {
  const r = await fetch("https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv");
  text = await r.text();
  fs.writeFileSync("games.csv", text);
}
const lines = text.trim().split("\n");
const head = lines[0].split(",");
const idx = Object.fromEntries(head.map((h, i) => [h, i]));
const G = lines.slice(1).map((l) => l.split(",")).map((c) => ({
  season: +c[idx.season], type: c[idx.game_type], week: +c[idx.week], date: c[idx.gameday],
  h: c[idx.home_team], a: c[idx.away_team], hs: c[idx.home_score] === "NA" ? null : +c[idx.home_score], as: c[idx.away_score] === "NA" ? null : +c[idx.away_score],
  neutral: c[idx.location] === "Neutral", mlh: +c[idx.home_moneyline], mla: +c[idx.away_moneyline], spread: +c[idx.spread_line],
  hrest: +c[idx.home_rest], arest: +c[idx.away_rest],
})).filter((g) => g.season >= 2005 && g.hs !== null).sort((x, y) => x.date.localeCompare(y.date));
// Team relocations
const norm = { SD: "LAC", STL: "LA", OAK: "LV" };
for (const g of G) { g.h = norm[g.h] ?? g.h; g.a = norm[g.a] ?? g.a; }
const clampP = (p) => Math.min(0.995, Math.max(0.005, p));
const logit = (p) => Math.log(clampP(p) / (1 - clampP(p)));
const q = (x) => (x < 0 ? -x / (-x + 100) : 100 / (x + 100));
const noVig = (g) => (Number.isFinite(g.mlh) && Number.isFinite(g.mla) && g.mlh && g.mla ? q(g.mlh) / (q(g.mlh) + q(g.mla)) : null);
function run(p) {
  const R = new Map(); let season = null; const out = [];
  for (const g of G) {
    if (g.season !== season) {
      season = g.season;
      if (p.reset) R.clear(); else for (const [t, r] of R) R.set(t, 1500 + (1 - p.reg) * (r - 1500));
    }
    const rh = R.get(g.h) ?? 1500, ra = R.get(g.a) ?? 1500;
    let adj = g.neutral ? 0 : p.hfa;
    if (p.rest && Number.isFinite(g.hrest) && Number.isFinite(g.arest)) adj += p.rest * Math.max(-7, Math.min(7, g.hrest - g.arest));
    const pe = 1 / (1 + 10 ** (-(rh - ra + adj) / 400));
    const act = g.hs > g.as ? 1 : g.hs < g.as ? 0 : 0.5;
    out.push({ season: g.season, week: g.week, act, pe, mk: noVig(g) });
    const edge = act === 1 ? rh - ra + adj : ra - rh - adj;
    const mult = Math.log(Math.abs(g.hs - g.as) + 1) * (2.2 / (edge * 0.001 + 2.2));
    const d = p.k * mult * (act - pe);
    R.set(g.h, rh + d); R.set(g.a, ra - d);
  }
  return out;
}
const score = (rows, f) => { let ll = 0, br = 0, acc = 0, n = 0; for (const r of rows) { if (r.act === 0.5) continue; const p = clampP(f(r)); ll -= r.act * Math.log(p) + (1 - r.act) * Math.log(1 - p); br += (p - r.act) ** 2; acc += (p >= 0.5) === (r.act === 1) ? 1 : 0; n++; } return { n, ll: +(ll / n).toFixed(4), brier: +(br / n).toFixed(4), acc: +((100 * acc) / n).toFixed(1) }; };
const TUNE = [2012, 2022], TEST = [2023, 2025];
const inR = (r, [a, b]) => r.season >= a && r.season <= b;
const base = { k: 20, hfa: 65, reg: 1, reset: true, rest: 0 };
const baseRows = run(base);
let best = null;
for (const k of [12, 16, 20, 24, 28]) for (const hfa of [20, 35, 48, 55, 65]) for (const reg of [0.2, 0.33, 0.5, 0.67]) for (const rest of [0, 2, 4]) {
  const p = { k, hfa, reg, reset: false, rest };
  const s = score(run(p).filter((r) => inR(r, TUNE)), (r) => r.pe);
  if (!best || s.ll < best.s.ll) best = { p, s };
}
const tuned = run(best.p);
const test = (rows) => rows.filter((r) => inR(r, TEST));
// blend weight on tune seasons with lines
let bw = 0, bl = 1e9;
for (let w = 0; w <= 1.0001; w += 0.01) {
  const s = score(tuned.filter((r) => inR(r, TUNE) && r.mk != null), (r) => 1 / (1 + Math.exp(-(w * logit(r.pe) + (1 - w) * logit(r.mk))))).ll;
  if (s < bl) { bl = s; bw = w; }
}
const T = test(tuned), TM = T.filter((r) => r.mk != null);
console.log(JSON.stringify({
  games: G.length, best: best.p,
  test_appElo: score(test(baseRows), (r) => r.pe),
  test_tunedElo: score(T, (r) => r.pe),
  test_withLine: { n: TM.length, appElo: score(test(baseRows).filter((r) => r.mk != null), (r) => r.pe), tunedElo: score(TM, (r) => r.pe), market: score(TM, (r) => r.mk), blend: score(TM, (r) => 1 / (1 + Math.exp(-(bw * logit(r.pe) + (1 - bw) * logit(r.mk))))), weight: +bw.toFixed(2) },
  weeks1to4: { appElo: score(test(baseRows).filter((r) => r.week <= 4), (r) => r.pe), tunedElo: score(T.filter((r) => r.week <= 4), (r) => r.pe) },
}, null, 1));
