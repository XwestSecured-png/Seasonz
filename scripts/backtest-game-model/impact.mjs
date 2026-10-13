// Basketball injuries: does valuing a missing regular by his scoring (points
// per game above a replacement-level 8) or by a plus-minus "impact" rating
// predict the result better? Missing = played 15+ min in 5+ of his team's
// last 10 games but isn't in tonight's box score. Fit on the first season,
// scored on the last. Shrinkage K (minutes) is tried for the impact rating.
//   node impact.mjs nba   (needs nba-box.json from box.mjs)
import fs from "fs";
const file = process.argv[2] ?? "nba";
const G = JSON.parse(fs.readFileSync(`${file}-box.json`));
const seasons = [...new Set(G.map((g) => g.season))].sort(); const test = seasons.at(-1);
const clampP = (p) => Math.min(0.995, Math.max(0.005, p)); const logit = (p) => Math.log(clampP(p) / (1 - clampP(p)));
const q = (x) => (x < 0 ? -x / (-x + 100) : 100 / (x + 100));
function fit(X, y) { const d = X[0].length; let w = new Array(d).fill(0); for (let it = 0; it < 25; it++) { const H = Array.from({ length: d }, () => new Array(d).fill(0)), gr = new Array(d).fill(0); for (let i = 0; i < X.length; i++) { const z = X[i].reduce((s, x, k) => s + x * w[k], 0), p = 1 / (1 + Math.exp(-z)); for (let a = 0; a < d; a++) { gr[a] += (p - y[i]) * X[i][a]; for (let b = 0; b < d; b++) H[a][b] += p * (1 - p) * X[i][a] * X[i][b]; } } for (let a = 0; a < d; a++) H[a][a] += 1e-3; const M = H.map((r, i) => [...r, gr[i]]); for (let c = 0; c < d; c++) { let p = c; for (let r = c + 1; r < d; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]]; for (let r = 0; r < d; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= d; k++) M[r][k] -= f * M[c][k]; } } w = w.map((x, i) => x - M[i][d] / M[i][i]); } return w; }
const ll = (rs, f) => { let s = 0, a = 0; for (const r of rs) { const p = clampP(f(r)); s -= r.y * Math.log(p) + (1 - r.y) * Math.log(1 - p); a += (p >= 0.5) === (r.y === 1) ? 1 : 0; } return [+(s / rs.length).toFixed(4), +(100 * a / rs.length).toFixed(1)]; };
const out = {};
for (const K of [250, 500, 1000, 2000]) {
  const teamGames = new Map(); const pl = new Map(); const margins = new Map(); let season = null; const rows = [];
  for (const g of G) {
    if (g.season !== season) { season = g.season; for (const v of pl.values()) { v.pm *= 0.5; v.min *= 0.5; v.exp *= 0.5; v.pts *= 0.5; v.n *= 0.5; } for (const [t, l] of margins) margins.set(t, l.slice(-10)); }
    const feat = {};
    for (const [team, sign] of [[g.h, 1], [g.a, -1]]) {
      const last = (teamGames.get(team) ?? []).slice(-10);
      const inBox = new Set(g.P.filter((p) => p[0] === team).map((p) => p[1]));
      let lostImp = 0, lostPpg = 0;
      if (last.length >= 5) {
        const minBy = new Map(); for (const tg of last) for (const [n, m] of tg) minBy.set(n, [...(minBy.get(n) ?? []), m]);
        for (const [n, ms] of minBy) {
          if (ms.length < 5) continue; const avgMin = ms.reduce((a, b) => a + b, 0) / last.length; if (avgMin < 15 || inBox.has(n)) continue;
          const v = pl.get(n); if (!v) continue;
          const imp = ((v.pm - v.exp) / (v.min + K)) * 48; // on-court margin vs. the team's, per 48, shrunk
          lostImp += (imp * avgMin) / 48; lostPpg += Math.max(0, v.pts / Math.max(1, v.n) - 8);
        }
      }
      const ml = margins.get(team) ?? []; feat[sign] = { lostImp, lostPpg, form: ml.length >= 5 ? ml.slice(-20).reduce((a, b) => a + b, 0) / ml.slice(-20).length : null };
    }
    if (feat[1].form !== null && feat[-1].form !== null && g.hs !== g.as) rows.push({ season: g.season, y: g.hs > g.as ? 1 : 0, form: feat[1].form - feat[-1].form, imp: feat[-1].lostImp - feat[1].lostImp, ppg: feat[-1].lostPpg - feat[1].lostPpg, mk: g.ml ? q(g.ml[0]) / (q(g.ml[0]) + q(g.ml[1])) : null });
    const marg = g.hs - g.as;
    for (const [team, m] of [[g.h, marg], [g.a, -marg]]) {
      for (const p of g.P.filter((p) => p[0] === team)) { const v = pl.get(p[1]) ?? { pm: 0, min: 0, exp: 0, pts: 0, n: 0 }; v.pm += p[3]; v.min += p[2]; v.exp += (m * p[2]) / 48; v.pts += p[4]; v.n += 1; pl.set(p[1], v); }
      teamGames.set(team, [...(teamGames.get(team) ?? []), g.P.filter((p) => p[0] === team).map((p) => [p[1], p[2]])]);
      margins.set(team, [...(margins.get(team) ?? []), m]);
    }
  }
  const tune = rows.filter((r) => r.season !== test), te = rows.filter((r) => r.season === test);
  const specs = { base: (r) => [1, r.form / 10], ppg: (r) => [1, r.form / 10, r.ppg / 10], imp: (r) => [1, r.form / 10, r.imp], both: (r) => [1, r.form / 10, r.ppg / 10, r.imp] };
  const res = { n: te.length };
  for (const [k, f] of Object.entries(specs)) { const w = fit(tune.map(f), tune.map((r) => r.y)); res[k] = { w: w.map((x) => +x.toFixed(3)), test: ll(te, (r) => 1 / (1 + Math.exp(-f(r).reduce((s, x, i) => s + x * w[i], 0)))) }; }
  const tm = te.filter((r) => r.mk != null); res.market = ll(tm, (r) => r.mk);
  const mfit = (f) => { const tt = tune.filter((r) => r.mk != null); const w = fit(tt.map((r) => [logit(r.mk), ...f(r)]), tt.map((r) => r.y)); return { w: w.map((x) => +x.toFixed(3)), test: ll(tm, (r) => 1 / (1 + Math.exp(-[logit(r.mk), ...f(r)].reduce((s, x, i) => s + x * w[i], 0)))) }; };
  res.mkt_plus_imp = mfit((r) => [r.imp]); res.mkt_plus_ppg = mfit((r) => [r.ppg / 10]);
  out[K] = res;
}
console.log(JSON.stringify(out, null, 1));
