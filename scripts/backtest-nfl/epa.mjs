// NFL: does a team EPA rating (offensive EPA minus opponent's, last 10
// games, last season at half weight) add to Elo? Fit 2013-22, tested 2023-25.
// EPA is passing + rushing only (receiving EPA repeats the passing plays).
//   node epa.mjs
import fs from "fs";
function parse(t) { const out = []; let row = [], f = "", q = false; for (let i = 0; i < t.length; i++) { const c = t[i]; if (q) { if (c === '"') { if (t[i + 1] === '"') { f += c; i++; } else q = false; } else f += c; } else if (c === '"') q = true; else if (c === ",") { row.push(f); f = ""; } else if (c === "\n") { row.push(f); out.push(row); row = []; f = ""; } else if (c !== "\r") f += c; } if (f || row.length) { row.push(f); out.push(row); } return out; }
async function csv(u) { const r = await fetch(u); if (!r.ok) throw new Error(r.status + " " + u); const L = parse(await r.text()); const H = L[0]; return L.slice(1).filter((c) => c.length === H.length).map((c) => Object.fromEntries(H.map((h, i) => [h, c[i]]))); }
const norm = { SD: "LAC", STL: "LA", OAK: "LV" }; const N = (t) => norm[t] ?? t;
const games = await csv("https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv");
const epa = new Map();
for (let s = 2012; s <= 2025; s++) {
  const rows = await csv(`https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${s}.csv`);
  for (const r of rows) {
    if (r.season_type && r.season_type !== "REG" && r.season_type !== "POST") continue;
    const k = `${r.season}|${r.week}|${N(r.team ?? r.recent_team)}`;
    epa.set(k, (epa.get(k) ?? 0) + (Number(r.passing_epa) || 0) + (Number(r.rushing_epa) || 0));
  }
}
const G = games.filter((g) => +g.season >= 2009 && g.home_score !== "NA" && g.home_score !== "")
  .map((g) => ({ season: +g.season, week: +g.week, h: N(g.home_team), a: N(g.away_team), hs: +g.home_score, as: +g.away_score, neutral: g.location === "Neutral", mlh: +g.home_moneyline, mla: +g.away_moneyline, date: g.gameday }))
  .sort((x, y) => x.date.localeCompare(y.date));
const clampP = (p) => Math.min(0.995, Math.max(0.005, p)); const logit = (p) => Math.log(clampP(p) / (1 - clampP(p)));
const q = (x) => (x < 0 ? -x / (-x + 100) : 100 / (x + 100));
const R = new Map(); let season = null; const rows = []; const net = new Map();
for (const g of G) {
  if (g.season !== season) { season = g.season; for (const [t, r] of R) R.set(t, 1500 + 0.5 * (r - 1500)); for (const [t, l] of net) net.set(t, l.slice(-8).map((x) => x * 0.5)); }
  const rh = R.get(g.h) ?? 1500, ra = R.get(g.a) ?? 1500; const adj = g.neutral ? 0 : 48;
  const pe = 1 / (1 + 10 ** (-(rh - ra + adj) / 400));
  const avg = (t) => { const l = (net.get(t) ?? []).slice(-10); return l.length >= 3 ? l.reduce((a, b) => a + b, 0) / l.length : null; };
  const eh = avg(g.h), ea = avg(g.a);
  const act = g.hs > g.as ? 1 : g.hs < g.as ? 0 : 0.5;
  const mk = Number.isFinite(g.mlh) && Number.isFinite(g.mla) && g.mlh && g.mla ? q(g.mlh) / (q(g.mlh) + q(g.mla)) : null;
  if (act !== 0.5) rows.push({ season: g.season, act, pe, epa: eh !== null && ea !== null ? eh - ea : null, mk });
  const edge = act === 1 ? rh - ra + adj : ra - rh - adj; const mult = Math.log(Math.abs(g.hs - g.as) + 1) * (2.2 / (edge * 0.001 + 2.2));
  const d = 20 * mult * (act - pe); R.set(g.h, rh + d); R.set(g.a, ra - d);
  const eH = epa.get(`${g.season}|${g.week}|${g.h}`), eA = epa.get(`${g.season}|${g.week}|${g.a}`);
  if (eH !== undefined && eA !== undefined) { net.set(g.h, [...(net.get(g.h) ?? []), eH - eA]); net.set(g.a, [...(net.get(g.a) ?? []), eA - eH]); }
}
function fit(X, y) { const d = X[0].length; let w = new Array(d).fill(0); for (let it = 0; it < 25; it++) { const H = Array.from({ length: d }, () => new Array(d).fill(0)), gr = new Array(d).fill(0); for (let i = 0; i < X.length; i++) { const z = X[i].reduce((s, x, k) => s + x * w[k], 0), p = 1 / (1 + Math.exp(-z)); for (let a = 0; a < d; a++) { gr[a] += (p - y[i]) * X[i][a]; for (let b = 0; b < d; b++) H[a][b] += p * (1 - p) * X[i][a] * X[i][b]; } } for (let a = 0; a < d; a++) H[a][a] += 1e-3; const M = H.map((r, i) => [...r, gr[i]]); for (let c = 0; c < d; c++) { let p = c; for (let r = c + 1; r < d; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]]; for (let r = 0; r < d; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= d; k++) M[r][k] -= f * M[c][k]; } } w = w.map((x, i) => x - M[i][d] / M[i][i]); } return w; }
const sc = (rs, f) => { let ll = 0, ac = 0; for (const r of rs) { const p = clampP(f(r)); ll -= r.act * Math.log(p) + (1 - r.act) * Math.log(1 - p); ac += (p >= 0.5) === (r.act === 1) ? 1 : 0; } return { n: rs.length, ll: +(ll / rs.length).toFixed(4), acc: +((100 * ac) / rs.length).toFixed(1) }; };
const tune = rows.filter((r) => r.season >= 2013 && r.season <= 2022 && r.epa !== null), test = rows.filter((r) => r.season >= 2023 && r.epa !== null);
const sdE = Math.sqrt(tune.reduce((a, r) => a + r.epa ** 2, 0) / tune.length);
const f1 = (r) => [1, logit(r.pe)], f2 = (r) => [1, logit(r.pe), r.epa / sdE];
const w1 = fit(tune.map(f1), tune.map((r) => r.act)), w2 = fit(tune.map(f2), tune.map((r) => r.act));
const p = (f, w) => (r) => 1 / (1 + Math.exp(-f(r).reduce((s, x, k) => s + x * w[k], 0)));
console.log(JSON.stringify({ sdE: +sdE.toFixed(2), w2: w2.map((x) => +x.toFixed(4)), elo: sc(test, p(f1, w1)), eloEpa: sc(test, p(f2, w2)), market: sc(test.filter((r) => r.mk != null), (r) => r.mk) }));
fs.writeFileSync("epa-rows.json", JSON.stringify(rows));
