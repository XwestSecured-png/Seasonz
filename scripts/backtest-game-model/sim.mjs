import fs from "fs";
const clampP = (p) => Math.min(0.995, Math.max(0.005, p));
const logit = (p) => Math.log(clampP(p) / (1 - clampP(p)));
const q = (x) => (x < 0 ? -x / (-x + 100) : 100 / (x + 100));
const prop = (h, a) => q(h) / (q(h) + q(a));
function shin(h, a) {
  const Q = [q(h), q(a)], B = Q[0] + Q[1];
  let z = 0;
  for (let it = 0; it < 60; it++) {
    const P = Q.map((qi) => (Math.sqrt(z * z + 4 * (1 - z) * qi * qi / B) - z) / (2 * (1 - z)));
    const s = P[0] + P[1];
    // adjust z so the sum is 1 (sum decreases as z increases)
    z = Math.max(0, Math.min(0.5, z + (s - 1) * 0.5));
  }
  const P = Q.map((qi) => (Math.sqrt(z * z + 4 * (1 - z) * qi * qi / B) - z) / (2 * (1 - z)));
  return P[0] / (P[0] + P[1]);
}
function power(h, a) {
  const Q = [q(h), q(a)]; let lo = 1, hi = 3;
  for (let it = 0; it < 60; it++) { const k = (lo + hi) / 2; if (Q[0] ** k + Q[1] ** k > 1) lo = k; else hi = k; }
  const k = (lo + hi) / 2; return Q[0] ** k / (Q[0] ** k + Q[1] ** k);
}
const ll = (p, y) => -(y * Math.log(clampP(p)) + (1 - y) * Math.log(1 - clampP(p)));
const Phi = (z) => { const s = z < 0 ? -1 : 1, x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.3275911 * x); const e = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return 0.5 * (1 + s * e); };
const PhiInv = (p) => { let lo = -8, hi = 8; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (Phi(m) < p) lo = m; else hi = m; } return (lo + hi) / 2; };
function lgam(x) { const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]; let y = x, t = x + 5.5; t -= (x + 0.5) * Math.log(t); let s = 1.000000000190015; for (const v of c) s += v / ++y; return -t + Math.log(2.5066282746310005 * s / x); }
const pois = (k, l) => Math.exp(k * Math.log(l) - l - lgam(k + 1));
const nb = (k, m, r) => Math.exp(lgam(k + r) - lgam(r) - lgam(k + 1) + r * Math.log(r / (r + m)) + k * Math.log(m / (r + m)));
// Score grid for count sports: home ~ f(lh), away ~ f(la)
function grid(lh, la, r) { const f = (k, l) => (r ? nb(k, l, r) : pois(k, l)); const M = 25; const ph = [], pa = []; for (let k = 0; k <= M; k++) { ph.push(f(k, lh)); pa.push(f(k, la)); } return { ph, pa }; }
function countProbs(lh, la, r, spread, total, tiesGoToOT) {
  const { ph, pa } = grid(lh, la, r); let win = 0, tie = 0, cover = 0, push = 0, over = 0, tpush = 0;
  for (let i = 0; i < ph.length; i++) for (let j = 0; j < pa.length; j++) { const p = ph[i] * pa[j]; if (i > j) win += p; else if (i === j) tie += p;
    const m = i - j + spread; if (m > 0) cover += p; else if (m === 0) push += p; const t = i + j - total; if (t > 0) over += p; else if (t === 0) tpush += p; }
  return { win: win + tie * 0.5, cover: cover / (1 - push), over: over / (1 - tpush) };
}
// Solve lh, la from home win prob p and expected total T (count sports)
function solveLambdas(p, T, r) { let lo = -3, hi = 3; for (let it = 0; it < 40; it++) { const d = (lo + hi) / 2; const lh = T / 2 + d / 2, la = T / 2 - d / 2; if (la <= 0.05 || lh <= 0.05) { if (d > 0) hi = d; else lo = d; continue; } const w = countProbs(lh, la, r, 0, 0.5).win; if (w < p) lo = d; else hi = d; } const d = (lo + hi) / 2; return [T / 2 + d / 2, T / 2 - d / 2]; }

const SP = { nba: { n: 20, count: false }, wnba: { n: 20, count: false }, nfl: { n: 10, count: false }, ncaaf: { n: 10, count: false }, nhl: { n: 20, count: true }, mlb: { n: 15, count: true } };
const out = {};
for (const [sp, cfg] of Object.entries(SP)) {
  const G = JSON.parse(fs.readFileSync(`${sp}.json`)).filter((g) => g.ml && g.hs !== g.as || (g.ml && sp === "nfl"));
  const seasons = [...new Set(G.map((g) => g.season))].sort(); const test = seasons[seasons.length - 1];
  // Devig
  const dv = { prop: 0, shin: 0, power: 0, n: 0 };
  for (const g of G) { if (g.hs === g.as) continue; const y = g.hs > g.as ? 1 : 0; dv.prop += ll(prop(...g.ml), y); dv.shin += ll(shin(...g.ml), y); dv.power += ll(power(...g.ml), y); dv.n++; }
  for (const k of ["prop", "shin", "power"]) dv[k] = +(dv[k] / dv.n).toFixed(5);
  // Rolling team scoring
  const T = new Map(); const rows = []; let lgSum = 0, lgN = 0;
  for (const g of G) {
    const th = T.get(g.h) ?? [], ta = T.get(g.a) ?? [];
    const avg = (l, k) => l.slice(-cfg.n).reduce((s, x) => s + x[k], 0) / Math.max(1, l.slice(-cfg.n).length);
    const lg = lgN ? lgSum / lgN : null;
    if (th.length >= 5 && ta.length >= 5 && lg && Number.isFinite(g.total) && Number.isFinite(g.spread)) {
      const eh = avg(th, 0) + avg(ta, 1) - lg / 2, ea = avg(ta, 0) + avg(th, 1) - lg / 2;
      rows.push({ season: g.season, g, mTotal: eh + ea, sh: shin(...g.ml) });
    }
    T.set(g.h, [...th, [g.hs, g.as]]); T.set(g.a, [...ta, [g.as, g.hs]]); lgSum += g.hs + g.as; lgN++;
  }
  const tune = rows.filter((r) => r.season !== test), te = rows.filter((r) => r.season === test);
  // total blend weight (on tune) and residual sd
  let bw = 0, best = 1e9; for (let w = 0; w <= 1.0001; w += 0.02) { const e = tune.reduce((s, r) => s + (w * r.mTotal + (1 - w) * r.g.total - (r.g.hs + r.g.as)) ** 2, 0); if (e < best) { best = e; bw = w; } }
  const rmse = (rs, f) => Math.sqrt(rs.reduce((s, r) => s + (f(r) - (r.g.hs + r.g.as)) ** 2, 0) / rs.length);
  const sdT = rmse(tune, (r) => r.g.total);
  const sdM = Math.sqrt(tune.reduce((s, r) => s + (r.g.hs - r.g.as + r.g.spread) ** 2, 0) / tune.length);
  // Spread vs ML consistency: normal margin model, mean from spread, sd sdM -> P(win) vs shin
  const cons = te.reduce((s, r) => s + Math.abs(Phi(-r.g.spread / sdM) - r.sh), 0) / te.length;
  // How well does the sim (from win prob + total) price the closing spread / total? Logloss of cover/over at the line vs actual, compared with 50/50.
  let llC = 0, llO = 0, nC = 0, nO = 0, base = 0, baseO = 0, rBest = null;
  const evalCount = (r_) => { let a = 0, b = 0, n1 = 0, n2 = 0; for (const r of tune.slice(-800)) { const [lh, la] = solveLambdas(r.sh, r.g.total, r_); const pr = countProbs(lh, la, r_, r.g.spread, r.g.total); const m = r.g.hs - r.g.as + r.g.spread, t = r.g.hs + r.g.as - r.g.total; if (m !== 0) { a += ll(pr.cover, m > 0 ? 1 : 0); n1++; } if (t !== 0) { b += ll(pr.over, t > 0 ? 1 : 0); n2++; } } return a / n1 + b / n2; };
  if (cfg.count) { let bv = 1e9; for (const r_ of [0, 4, 8, 15, 30]) { const v = evalCount(r_); if (v < bv) { bv = v; rBest = r_; } } }
  for (const r of te) {
    const m = r.g.hs - r.g.as + r.g.spread, t = r.g.hs + r.g.as - r.g.total;
    const tot = bw * r.mTotal + (1 - bw) * r.g.total;
    let pc, po;
    if (cfg.count) { const [lh, la] = solveLambdas(r.sh, tot, rBest); const pr = countProbs(lh, la, rBest, r.g.spread, r.g.total); pc = pr.cover; po = pr.over; }
    else { const mu = sdM * PhiInv(r.sh); pc = Phi((mu + r.g.spread) / sdM); po = 1 - Phi((r.g.total - tot) / sdT); }
    if (m !== 0) { llC += ll(pc, m > 0 ? 1 : 0); base += Math.log(2); nC++; }
    if (t !== 0) { llO += ll(po, t > 0 ? 1 : 0); baseO += Math.log(2); nO++; }
  }
  out[sp] = { n: G.length, test, devig: dv, totals: { w: +bw.toFixed(2), rmseMarket: +rmse(te, (r) => r.g.total).toFixed(3), rmseModel: +rmse(te, (r) => r.mTotal).toFixed(3), rmseBlend: +rmse(te, (r) => bw * r.mTotal + (1 - bw) * r.g.total).toFixed(3) },
    sdMargin: +sdM.toFixed(2), sdTotal: +sdT.toFixed(2), spreadVsMlGap: +(cons * 100).toFixed(2), nbR: rBest,
    cover: { n: nC, ll: +(llC / nC).toFixed(4), coin: +(base / nC).toFixed(4) }, over: { n: nO, ll: +(llO / nO).toFixed(4), coin: +(baseO / nO).toFixed(4) } };
  console.log(sp, JSON.stringify(out[sp]));
}
fs.writeFileSync("sim-results.json", JSON.stringify(out, null, 1));
