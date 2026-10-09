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
const start = JSON.parse(process.argv[3]);
const RANGES = {
  k: [3, 4, 5, 6, 8, 10, 12, 14, 16, 20, 25, 30, 35, 40, 50, 60],
  hfa: [0, 15, 25, 35, 45, 50, 65, 80, 100, 120, 140],
  reg: [0, 0.1, 0.2, 0.33, 0.5, 0.75, 1],
  rest: [0, 5, 10, 15, 25, 35, 45, 60],
  mov: [0, 1],
  newT: sport.startsWith("ncaa") ? [1500, 1300, 1200, 1100, 1000, 900] : [1500],
};
let cur = { ...start }, curR = run(cur, firstEval, tuneHi);
for (let pass = 0; pass < 3; pass++) for (const key of Object.keys(RANGES)) for (const v of RANGES[key]) {
  const c = { ...cur, [key]: v }; const r = run(c, firstEval, tuneHi);
  if (r.ll < curR.ll) { cur = c; curR = r; }
}
console.log(JSON.stringify({ sport, test: testS, baseTest: base, best: cur, tuneFit: curR, bestTest: run(cur, testS, testS) }));
