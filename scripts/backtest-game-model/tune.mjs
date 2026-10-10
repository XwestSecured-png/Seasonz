// Feature backtest per sport: Elo -> + margin form -> + starter (MLB/NHL) -> market blend.
// Fit logistic weights on the tune season(s), score on the held-out last season.
import fs from "fs";
const sport = process.argv[2];
const P = {
  nba: { k: 12, hfa: 35, regress: 0.33, mov: true, restPerDay: 25, newTeam: 1500 },
  wnba: { k: 16, hfa: 45, regress: 0.5, mov: true, restPerDay: 5, newTeam: 1500 },
  nhl: { k: 6, hfa: 35, regress: 0.2, mov: true, restPerDay: 25, newTeam: 1500 },
  mlb: { k: 4, hfa: 25, regress: 0.2, mov: true, restPerDay: 0, newTeam: 1500 },
  ncaaf: { k: 30, hfa: 65, regress: 0.2, mov: true, restPerDay: 0, newTeam: 1500 },
  ncaab: { k: 30, hfa: 100, regress: 0.33, mov: true, restPerDay: 5, newTeam: 900 },
}[sport];
const G = JSON.parse(fs.readFileSync(`${sport}.json`, "utf8")).map((g) => ({ ...g, ms: Date.parse(g.t) }));
const seasons = [...new Set(G.map((g) => g.season))].sort();
const test = seasons.at(-1);
const tuneSeasons = sport === "wnba" ? [seasons.at(-3), seasons.at(-2)] : [seasons.at(-2)];
const logit = (p) => Math.log(p / (1 - p));
const clampP = (p) => Math.min(0.995, Math.max(0.005, p));
const ip = (s) => { const [a, b] = String(s ?? "0").split("."); return Number(a) + (Number(b) || 0) / 3; };
const noVig = ([h, a]) => { const q = (x) => (x < 0 ? -x / (-x + 100) : 100 / (x + 100)); const qh = q(h), qa = q(a); return qh / (qh + qa); };
const FORM_N = Number(process.argv[3] ?? 10);

// Replay
const R = new Map(), last = new Map(), formLog = new Map(), pit = new Map(), goal = new Map(), teamStarts = new Map();
let season = null;
const rows = [];
for (const g of G) {
  if (g.season !== season) {
    season = g.season;
    for (const [t, r] of R) R.set(t, 1500 + (1 - P.regress) * (r - 1500));
    last.clear(); formLog.clear(); teamStarts.clear();
  }
  const rh = R.get(g.h) ?? P.newTeam, ra = R.get(g.a) ?? P.newTeam;
  let adj = g.n ? 0 : P.hfa;
  if (P.restPerDay) {
    const d = (t) => (last.has(t) ? Math.min(3, Math.floor((g.ms - last.get(t)) / 864e5)) : 3);
    adj += P.restPerDay * (d(g.h) - d(g.a));
  }
  const pElo = 1 / (1 + 10 ** (-(rh - ra + adj) / 400));
  const fh = (formLog.get(g.h) ?? []).slice(-FORM_N), fa = (formLog.get(g.a) ?? []).slice(-FORM_N);
  const avg = (l) => l.reduce((s, x) => s + x, 0) / l.length;
  const form = fh.length >= 5 && fa.length >= 5 ? avg(fh) - avg(fa) : null;
  // MLB starter quality: shrunk FIP-ish runs/9 (lower better). Feature = away - home.
  let starter = null, backup = null;
  if (sport === "mlb" && g.hp?.name && g.ap?.name) {
    const q = (n) => { const s = pit.get(n) ?? { ip: 0, f: 0 }; const PRIOR = 40, LG = 4.3; return (s.f + PRIOR * LG) / (s.ip + PRIOR); };
    starter = q(g.ap.name) - q(g.hp.name);
  }
  if (sport === "nhl" && g.hp?.name && g.ap?.name) {
    const q = (n) => { const s = goal.get(n) ?? { sa: 0, sv: 0 }; const PRIOR = 800, LG = 0.900; return (s.sv + PRIOR * LG) / (s.sa + PRIOR); };
    starter = (q(g.hp.name) - q(g.ap.name)) * 100;
    const share = (team, n) => { const m = teamStarts.get(team); if (!m) return 1; const tot = [...m.values()].reduce((s, x) => s + x, 0); return tot < 5 ? 1 : (m.get(n) ?? 0) / tot; };
    backup = (share(g.a, g.ap.name) < 0.35 ? 1 : 0) - (share(g.h, g.hp.name) < 0.35 ? 1 : 0);
  }
  const act = g.hs > g.as ? 1 : g.hs < g.as ? 0 : null;
  const market = g.ml ? noVig(g.ml) : null;
  if (act !== null) rows.push({ season: g.season, act, pElo, form, starter, backup, market, wx: g.wx ?? null });
  // updates
  if (act !== null || g.hs === g.as) {
    const a = g.hs > g.as ? 1 : g.hs < g.as ? 0 : 0.5;
    const edge = a === 1 ? rh - ra + adj : ra - rh - adj;
    const mult = P.mov ? Math.log(Math.abs(g.hs - g.as) + 1) * (2.2 / (edge * 0.001 + 2.2)) : 1;
    const d = P.k * mult * (a - pElo);
    R.set(g.h, rh + d); R.set(g.a, ra - d);
  }
  last.set(g.h, g.ms); last.set(g.a, g.ms);
  formLog.set(g.h, [...(formLog.get(g.h) ?? []), g.hs - g.as]);
  formLog.set(g.a, [...(formLog.get(g.a) ?? []), g.as - g.hs]);
  if (sport === "mlb") for (const [side, ra2] of [["hp", g.as], ["ap", g.hs]]) {
    const p = g[side]; if (!p?.name) continue; const i2 = ip(p.IP); if (!i2) continue;
    const s = pit.get(p.name) ?? { ip: 0, f: 0 };
    const fip = 13 * Number(p.HR || 0) + 3 * Number(p.BB || 0) - 2 * Number(p.K || 0) + 3.2 * i2; // FIP*IP
    s.ip += i2; s.f += (fip / i2) * i2 * 0.5 + (9 * Number(p.ER || 0)) * 0.5; pit.set(p.name, s);
  }
  if (sport === "nhl") for (const [side, team] of [["hp", g.h], ["ap", g.a]]) {
    const p = g[side]; if (!p?.name) continue;
    const s = goal.get(p.name) ?? { sa: 0, sv: 0 }; s.sa += Number(p.SA || 0); s.sv += Number(p.SV || 0); goal.set(p.name, s);
    const m = teamStarts.get(team) ?? new Map(); m.set(p.name, (m.get(p.name) ?? 0) + 1); teamStarts.set(team, m);
  }
}

// Logistic regression (Newton) with tiny ridge.
function fit(X, y) {
  const d = X[0].length; let w = new Array(d).fill(0);
  for (let it = 0; it < 30; it++) {
    const H = Array.from({ length: d }, () => new Array(d).fill(0)), gr = new Array(d).fill(0);
    for (let i = 0; i < X.length; i++) {
      const z = X[i].reduce((s, x, k) => s + x * w[k], 0), p = 1 / (1 + Math.exp(-z));
      for (let a = 0; a < d; a++) { gr[a] += (p - y[i]) * X[i][a]; for (let b = 0; b < d; b++) H[a][b] += p * (1 - p) * X[i][a] * X[i][b]; }
    }
    for (let a = 0; a < d; a++) { H[a][a] += 1e-3; gr[a] += 1e-3 * w[a]; }
    // solve H dx = gr
    const M = H.map((r, i) => [...r, gr[i]]);
    for (let c = 0; c < d; c++) { let p = c; for (let r = c + 1; r < d; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]];
      for (let r = 0; r < d; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= d; k++) M[r][k] -= f * M[c][k]; } }
    const dx = M.map((r, i) => r[d] / r[i]);
    w = w.map((x, i) => x - dx[i]);
  }
  return w;
}
const score = (ps, ys) => { let ll = 0, br = 0, acc = 0; ps.forEach((p, i) => { p = clampP(p); ll -= ys[i] * Math.log(p) + (1 - ys[i]) * Math.log(1 - p); br += (p - ys[i]) ** 2; acc += (p >= 0.5) === (ys[i] === 1) ? 1 : 0; }); const n = ps.length; return { n, ll: +(ll / n).toFixed(4), brier: +(br / n).toFixed(4), acc: +((100 * acc) / n).toFixed(1) }; };
const SD = (k) => { const v = rows.filter((r) => tuneSeasons.includes(r.season) && r[k] != null).map((r) => r[k]); const m = v.reduce((s, x) => s + x, 0) / v.length; return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length) || 1; };
const sd = { form: SD("form"), starter: SD("starter") };
const base = process.env.BASE || (sport === "mlb" || sport === "nhl" ? "starter" : "form");
const feats = {
  elo: (r) => [1, logit(clampP(r.pElo))],
  form: (r) => [1, logit(clampP(r.pElo)), (r.form ?? 0) / sd.form],
  starter: (r) => [1, logit(clampP(r.pElo)), (r.form ?? 0) / sd.form, (r.starter ?? 0) / sd.starter, r.backup ?? 0],
  weather: (r) => { const L = logit(clampP(r.pElo)); const w = r.wx; return [...feats[base](r), w ? (w.wind / 10) * L : 0, w ? (w.precip > 0.5 ? 1 : 0) * L : 0, w ? (w.temp < 45 ? 1 : 0) * L : 0]; },
  market: (r) => [1, logit(clampP(r.market))],
  eloBackup: (r) => [1, logit(clampP(r.pElo)), r.backup ?? 0],
  eloStarter: (r) => [1, logit(clampP(r.pElo)), (r.starter ?? 0) / sd.starter, r.backup ?? 0],
};
const out = { sport, formN: FORM_N, tune: tuneSeasons, test, sd, models: {} };
const tuneAll = rows.filter((r) => tuneSeasons.includes(r.season));
const testAll = rows.filter((r) => r.season === test);
const tuneM = tuneAll.filter((r) => r.market != null), testM = testAll.filter((r) => r.market != null);
out.oddsCoverage = { tune: `${tuneM.length}/${tuneAll.length}`, test: `${testM.length}/${testAll.length}` };
const W = {};
const pred = (name, r) => 1 / (1 + Math.exp(-feats[name](r).reduce((s, x, k) => s + x * W[name][k], 0)));
for (const name of Object.keys(feats)) {
  if ((name === "starter" || name === "eloBackup" || name === "eloStarter") && base !== "starter") continue;
  if (name === "weather" && !rows.some((r) => r.wx)) continue;
  const needM = name === "market";
  const tr = needM ? tuneM : tuneAll; if (tr.length < 50) continue;
  W[name] = fit(tr.map(feats[name]), tr.map((r) => r.act));
  const ev = (set) => score(set.map((r) => pred(name, r)), set.map((r) => r.act));
  out.models[name] = { w: W[name].map((x) => +x.toFixed(4)), testAll: needM ? undefined : ev(testAll), testWithOdds: testM.length ? ev(testM) : undefined };
}
// Two-stage blend: final = f(model-only prediction, market).
if (tuneM.length >= 50) {
  const bf = (r) => [1, logit(clampP(pred(base, r))), logit(clampP(r.market))];
  const wb = fit(tuneM.map(bf), tuneM.map((r) => r.act));
  out.models.blend2 = { w: wb.map((x) => +x.toFixed(4)), testWithOdds: score(testM.map((r) => 1 / (1 + Math.exp(-bf(r).reduce((s, x, k) => s + x * wb[k], 0)))), testM.map((r) => r.act)) };
}
out.rawElo = { testAll: score(testAll.map((r) => r.pElo), testAll.map((r) => r.act)), testWithOdds: testM.length ? score(testM.map((r) => r.pElo), testM.map((r) => r.act)) : undefined };
console.log(JSON.stringify(out));
