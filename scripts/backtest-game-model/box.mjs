// Player box scores (minutes, +/-, counting stats) for every game in
// <file>.json (from fetch-lines.mjs). Writes <file>-box.json for impact.mjs,
// corr.mjs and props.mts.
//   node box.mjs basketball nba nba
//   node box.mjs basketball wnba wnba
import fs from "fs";
const [sp, lg, file] = process.argv.slice(2);
async function j(u, t = 4) { for (let i = 0; i < t; i++) { try { const r = await fetch(u); if (r.ok) return await r.json(); if (r.status === 404) return null; } catch {} await new Promise((r) => setTimeout(r, 800 * (i + 1))); } return null; }
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); })); }
const G = JSON.parse(fs.readFileSync(`${file}.json`));
const out = [];
await pool(G, 12, async (g) => {
  const d = await j(`https://site.api.espn.com/apis/site/v2/sports/${sp}/${lg}/summary?event=${g.id}`);
  const P = []; // [team, name, MIN, +/-, PTS, REB, AST, 3PM, STL, BLK, TO, starter]
  for (const tm of d?.boxscore?.players ?? []) {
    const ab = tm.team?.abbreviation; const st = tm.statistics?.[0]; if (!st) continue; const L = st.labels ?? st.names;
    for (const a of st.athletes ?? []) {
      if (a.didNotPlay || !a.stats?.length) continue;
      const s = Object.fromEntries(L.map((l, i) => [l, a.stats[i]]));
      const n = (x) => Number(String(x ?? "0").replace("+", "")) || 0; const made = (x) => Number(String(x ?? "0-0").split("-")[0]) || 0;
      P.push([ab, a.athlete?.displayName, n(s.MIN), n(s["+/-"]), n(s.PTS), n(s.REB), n(s.AST), made(s["3PT"]), n(s.STL), n(s.BLK), n(s.TO), a.starter ? 1 : 0]);
    }
  }
  if (P.length) out.push({ id: g.id, season: g.season, t: g.t, h: g.h, a: g.a, hs: g.hs, as: g.as, ml: g.ml, spread: g.spread, total: g.total, P });
});
out.sort((x, y) => x.t.localeCompare(y.t));
fs.writeFileSync(`${file}-box.json`, JSON.stringify(out));
console.log("done", out.length);
