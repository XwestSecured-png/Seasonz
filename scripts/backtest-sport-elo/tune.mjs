import fs from "fs";
const sport = process.argv[2];
const G = JSON.parse(fs.readFileSync(`${sport}.json`, "utf8")).map((g) => ({ ...g, ms: Date.parse(g.t) }));
const seasons = [...new Set(G.map((g) => g.season))].sort();
const firstEval = seasons[1];
function run(p, lo = firstEval, hi = 9999) {
  const R = new Map(), last = new Map(), seen = new Set();
  let season = null, n = 0, brier = 0, ll = 0, acc = 0;
  const get = (t) => (R.has(t) ? R.get(t) : p.newT);
  for (const g of G) {
    if (g.season !== season) {
      season = g.season;
      for (const [t, r] of R) R.set(t, 1500 + (1 - p.reg) * (r - 1500));
      last.clear();
    }
    const rh = get(g.h), ra = get(g.a);
    let adj = g.n ? 0 : p.hfa;
    if (p.rest) {
      const dh = last.has(g.h) ? Math.min(3, Math.floor((g.ms - last.get(g.h)) / 864e5)) : 3;
      const da = last.has(g.a) ? Math.min(3, Math.floor((g.ms - last.get(g.a)) / 864e5)) : 3;
      adj += p.rest * (dh - da);
    }
    const ph = 1 / (1 + 10 ** (-(rh - ra + adj) / 400));
    const act = g.hs > g.as ? 1 : g.hs < g.as ? 0 : 0.5;
    if (g.season >= lo && g.season <= hi) {
      n++; brier += (ph - act) ** 2;
      ll += -(act * Math.log(Math.max(1e-9, ph)) + (1 - act) * Math.log(Math.max(1e-9, 1 - ph)));
      if ((ph >= 0.5 ? 1 : 0) === act) acc++;
    }
    const diff = g.hs - g.as;
    const mult = p.mov ? Math.log(Math.abs(diff) + 1) * (2.2 / ((act === 1 ? rh - ra + adj : ra - rh - adj) * 0.001 + 2.2)) : 1;
    const d = p.k * mult * (act - ph);
    R.set(g.h, rh + d); R.set(g.a, ra - d);
    last.set(g.h, g.ms); last.set(g.a, g.ms);
  }
  return { n, brier: brier / n, ll: ll / n, acc: acc / n };
}
const testS = seasons.at(-1), tuneHi = seasons.at(-2);
const BASEP = { k: 20, hfa: 65, reg: 1, rest: 0, mov: 1, newT: 1500 };
const base = run(BASEP, testS, testS);
// The live app also ignores neutral sites; approximate baseline as-is.
const Ks = [4, 6, 8, 12, 16, 20, 25, 30, 40];
const H = [0, 15, 25, 35, 50, 65, 80, 100];
const REG = [0.2, 0.33, 0.5, 0.75, 1];
const REST = [0, 5, 10, 15, 25];
const NEW = sport.startsWith("ncaa") ? [1500, 1400, 1300, 1200] : [1500];
let best = null;
for (const k of Ks) for (const hfa of H) for (const reg of REG) for (const rest of REST) for (const mov of [0, 1]) for (const newT of NEW) {
  const r = run({ k, hfa, reg, rest, mov, newT }, firstEval, tuneHi);
  if (!best || r.ll < best.r.ll) best = { p: { k, hfa, reg, rest, mov, newT }, r };
}
// Hold-out check on the LAST season only, params tuned on seasons before it.
console.log(JSON.stringify({ sport, seasons, test: testS, baseTest: base, best: best.p, tuneFit: best.r, bestTest: run(best.p, testS, testS) }));
