// Same-game correlations for lib/sgp.ts. Each player's stat is turned into
// a "surprise" (tonight minus his own recent average), and surprises are
// correlated with: his other stats, teammates', opponents', and the game's
// result against the closing spread and total.
//   Basketball: nba-box.json / wnba-box.json (box.mjs).
//   Football: nflverse weekly player stats + games.csv, 2018-25.
//   node corr.mjs
import fs from "fs";
const corr = (xs) => { const n = xs.length; if (n < 30) return null; let mx = 0, my = 0; for (const [x, y] of xs) { mx += x; my += y; } mx /= n; my /= n; let sxy = 0, sxx = 0, syy = 0; for (const [x, y] of xs) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; } return +(sxy / Math.sqrt(sxx * syy)).toFixed(3); };
const res = {};
// ---------- Basketball
for (const file of ["nba", "wnba"]) {
  const G = JSON.parse(fs.readFileSync(`${file}-box.json`));
  const hist = new Map(); const acc = {}; const add = (k, x, y) => { (acc[k] ??= []).push([x, y]); };
  const S = { PTS: 4, REB: 5, AST: 6, "3PM": 7, STL: 8, BLK: 9, TO: 10 };
  for (const g of G) {
    const resid = [];
    for (const p of g.P) { const h = hist.get(p[1]) ?? []; if (h.length >= 5 && p[2] >= 10) { const last = h.slice(-10); const r = {}; for (const [k, i] of Object.entries(S)) r[k] = p[i] - last.reduce((a, b) => a + b[i], 0) / last.length; r.PRA = r.PTS + r.REB + r.AST; resid.push([p[0], p[1], r, p[11]]); } }
    const totR = Number.isFinite(g.total) ? g.hs + g.as - g.total : null; const marR = Number.isFinite(g.spread) ? g.hs - g.as + g.spread : null;
    for (const [team, , r, starter] of resid) {
      if (!starter) continue;
      const keys = Object.keys(r); for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) add(`same:${keys[i]}~${keys[j]}`, r[keys[i]], r[keys[j]]);
      if (totR !== null) for (const k of ["PTS", "REB", "AST", "3PM", "PRA"]) add(`total:${k}`, r[k], totR);
      if (marR !== null) for (const k of ["PTS", "REB", "AST", "PRA"]) add(`teamCover:${k}`, r[k], team === g.h ? marR : -marR);
      add("teamWin:PTS", r.PTS, (team === g.h) === (g.hs > g.as) ? 1 : 0);
    }
    const st = resid.filter((x) => x[3]);
    for (let i = 0; i < st.length; i++) for (let j = i + 1; j < st.length; j++) {
      const same = st[i][0] === st[j][0];
      for (const k of ["PTS", "REB", "AST", "PRA"]) add(`${same ? "mate" : "opp"}:${k}~${k}`, st[i][2][k], st[j][2][k]);
      if (same) { add("mate:AST~PTS", st[i][2].AST, st[j][2].PTS); add("mate:PTS~AST", st[i][2].PTS, st[j][2].AST); }
    }
    if (totR !== null && marR !== null) add("game:cover~over", marR, totR);
    for (const p of g.P) hist.set(p[1], [...(hist.get(p[1]) ?? []), p].slice(-20));
  }
  res[file] = Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, [corr(v), v.length]]));
}
// ---------- NFL
function parse(t) { const out = []; let row = [], f = "", q = false; for (let i = 0; i < t.length; i++) { const c = t[i]; if (q) { if (c === '"') { if (t[i + 1] === '"') { f += c; i++; } else q = false; } else f += c; } else if (c === '"') q = true; else if (c === ",") { row.push(f); f = ""; } else if (c === "\n") { row.push(f); out.push(row); row = []; f = ""; } else if (c !== "\r") f += c; } if (f || row.length) { row.push(f); out.push(row); } return out; }
async function csv(u) { const r = await fetch(u); const L = parse(await r.text()); const H = L[0]; return L.slice(1).filter((c) => c.length === H.length).map((c) => Object.fromEntries(H.map((h, i) => [h, c[i]]))); }
const games = await csv("https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv");
const gk = new Map(); for (const g of games) if (g.home_score !== "NA" && +g.season >= 2018) { gk.set(`${g.season}|${g.week}|${g.home_team}`, { g, home: true }); gk.set(`${g.season}|${g.week}|${g.away_team}`, { g, home: false }); }
const acc = {}; const add = (k, x, y) => { (acc[k] ??= []).push([x, y]); };
for (let s = 2018; s <= 2025; s++) {
  const rows = await csv(`https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${s}.csv`);
  const hist = new Map(); const byGame = new Map();
  rows.sort((a, b) => +a.week - +b.week);
  const F = { passYds: "passing_yards", passTD: "passing_tds", int: "passing_interceptions", passAtt: "attempts", rushYds: "rushing_yards", rushAtt: "carries", rushTD: "rushing_tds", rec: "receptions", recYds: "receiving_yards", recTD: "receiving_tds" };
  for (const r of rows) {
    if (r.season_type !== "REG") continue;
    const v = Object.fromEntries(Object.entries(F).map(([k, c]) => [k, Number(r[c]) || 0])); v.td = v.rushTD + v.recTD; v.anyTD = v.td > 0 ? 1 : 0;
    const h = hist.get(r.player_id) ?? [];
    if (h.length >= 4) {
      const last = h.slice(-8); const re = {}; for (const k of Object.keys(v)) re[k] = v[k] - last.reduce((a, b) => a + b[k], 0) / last.length;
      const key = `${r.season}|${r.week}|${r.team}`; const list = byGame.get(key) ?? [];
      const vol = r.position === "QB" ? last.reduce((a, b) => a + b.passAtt, 0) / last.length : r.position === "RB" ? last.reduce((a, b) => a + b.rushAtt, 0) / last.length : last.reduce((a, b) => a + b.rec, 0) / last.length;
      list.push({ pos: r.position, res: re, vol }); byGame.set(key, list);
    }
    hist.set(r.player_id, [...h, v]);
  }
  for (const [k, list] of byGame) {
    const gi = gk.get(k); if (!gi) continue; const g = gi.g;
    const hs = +g.home_score, as = +g.away_score; const totR = hs + as - +g.total_line; const marH = hs - as - +g.spread_line; const mar = gi.home ? marH : -marH; const win = (gi.home ? hs > as : as > hs) ? 1 : 0;
    const qb = list.filter((x) => x.pos === "QB" && x.vol >= 20)[0]; const rb = list.filter((x) => x.pos === "RB").sort((a, b) => b.vol - a.vol)[0];
    const wrs = list.filter((x) => (x.pos === "WR" || x.pos === "TE") && x.vol >= 3).sort((a, b) => b.vol - a.vol).slice(0, 2);
    if (qb) {
      add("qb:passYds~passTD", qb.res.passYds, qb.res.passTD); add("qb:passYds~int", qb.res.passYds, qb.res.int); add("qb:passYds~total", qb.res.passYds, totR); add("qb:passTD~total", qb.res.passTD, totR);
      add("qb:passYds~cover", qb.res.passYds, mar); add("qb:passYds~win", qb.res.passYds, win); add("qb:passYds~rushYds", qb.res.passYds, qb.res.rushYds);
      for (const w of wrs) { add("qbwr:passYds~recYds", qb.res.passYds, w.res.recYds); add("qbwr:passYds~rec", qb.res.passYds, w.res.rec); add("qbwr:passTD~anyTD", qb.res.passTD, w.res.anyTD); }
      const oq = (byGame.get(`${g.season}|${g.week}|${gi.home ? g.away_team : g.home_team}`) ?? []).filter((x) => x.pos === "QB" && x.vol >= 20)[0];
      if (oq && gi.home) add("opp:passYds~passYds", qb.res.passYds, oq.res.passYds);
    }
    if (rb) {
      add("rb:rushYds~rushAtt", rb.res.rushYds, rb.res.rushAtt); add("rb:rushYds~anyTD", rb.res.rushYds, rb.res.anyTD); add("rb:rushYds~cover", rb.res.rushYds, mar); add("rb:rushYds~win", rb.res.rushYds, win);
      add("rb:rushYds~total", rb.res.rushYds, totR); add("rb:anyTD~total", rb.res.anyTD, totR); add("rb:anyTD~cover", rb.res.anyTD, mar); if (qb) add("qbrb:passYds~rushYds", qb.res.passYds, rb.res.rushYds);
    }
    for (const w of wrs) { add("wr:recYds~rec", w.res.recYds, w.res.rec); add("wr:recYds~anyTD", w.res.recYds, w.res.anyTD); add("wr:recYds~total", w.res.recYds, totR); add("wr:anyTD~total", w.res.anyTD, totR); add("wr:recYds~cover", w.res.recYds, mar); }
    if (wrs.length === 2) add("wrwr:recYds~recYds", wrs[0].res.recYds, wrs[1].res.recYds);
    if (gi.home) add("game:cover~over", marH, totR);
  }
}
res.nfl = Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, [corr(v), v.length]]));
fs.writeFileSync("corr.json", JSON.stringify(res, null, 1));
for (const [k, v] of Object.entries(res)) console.log(k, JSON.stringify(Object.fromEntries(Object.entries(v).map(([a, b]) => [a, b[0]]))));
