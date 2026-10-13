// Closing lines (moneyline, spread, total and their prices) + final scores
// for recent seasons, from ESPN. Writes <sport>.json for sim.mjs, box.mjs.
//   node fetch-lines.mjs nba,nhl,mlb,wnba,nfl,ncaaf,ncaab
import fs from "fs";
const B = "https://site.api.espn.com/apis/site/v2/sports", C = "https://sports.core.api.espn.com/v2/sports";
const S = {
  nba: ["basketball", "nba", [2025, 2026]], nhl: ["hockey", "nhl", [2025, 2026]], mlb: ["baseball", "mlb", [2025, 2026]],
  ncaaf: ["football", "college-football", [2024, 2025]], wnba: ["basketball", "wnba", [2025, 2026]], nfl: ["football", "nfl", [2024, 2025]],
  ncaab: ["basketball", "mens-college-basketball", [2026]],
};
async function j(u, t = 4) { for (let i = 0; i < t; i++) { try { const r = await fetch(u); if (r.ok) return await r.json(); if (r.status === 404) return null; } catch {} await new Promise((r) => setTimeout(r, 700 * (i + 1))); } return null; }
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); })); }
const only = process.argv[2]?.split(",");
for (const [key, [sp, lg, seasons]] of Object.entries(S)) {
  if (only && !only.includes(key)) continue;
  const t = await j(`${B}/${sp}/${lg}/teams?limit=2000`);
  let teams = (t?.sports?.[0]?.leagues?.[0]?.teams ?? []).map((x) => x.team.id);
  // College: Division I only (FBS for football, D-I for basketball).
  const groupIds = async (group, dates) => { const ids = new Set(); for (const d of dates) { const g = await j(`${B}/${sp}/${lg}/scoreboard?groups=${group}&limit=1000&dates=${d}`); for (const e of g?.events ?? []) for (const c of e.competitions[0].competitors) ids.add(c.team.id); } return ids; };
  if (key === "ncaab") { const ids = await groupIds(50, ["20260110", "20260117", "20260124", "20260131"]); teams = teams.filter((id) => ids.has(id)); }
  if (key === "ncaaf") { const ids = await groupIds(80, ["20251101"]); teams = teams.filter((id) => ids.has(id)); }
  const games = new Map();
  for (const season of seasons) await pool(teams.flatMap((id) => [2, 3].map((st) => ({ id, st }))), 16, async ({ id, st }) => {
    const d = await j(`${B}/${sp}/${lg}/teams/${id}/schedule?season=${season}&seasontype=${st}`);
    for (const e of d?.events ?? []) {
      const c = e.competitions?.[0]; if (!c?.status?.type?.completed) continue;
      const h = c.competitors.find((x) => x.homeAway === "home"), a = c.competitors.find((x) => x.homeAway === "away");
      const hs = Number(h?.score?.value ?? h?.score), as = Number(a?.score?.value ?? a?.score); if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;
      games.set(e.id, { id: e.id, season, t: e.date, h: h.team.abbreviation, a: a.team.abbreviation, hs, as, n: !!c.neutralSite });
    }
  });
  const list = [...games.values()].sort((x, y) => x.t.localeCompare(y.t));
  await pool(list, 16, async (g) => {
    const o = await j(`${C}/${sp}/leagues/${lg}/events/${g.id}/competitions/${g.id}/odds`);
    for (const it of o?.items ?? []) {
      if (/live/i.test(it.provider?.name ?? "")) continue;
      const cl = (side, k) => it[side]?.close?.[k]?.american ?? it[side]?.close?.[k]?.alternateDisplayValue;
      const h = Number(cl("homeTeamOdds", "moneyLine") ?? it.homeTeamOdds?.moneyLine), a = Number(cl("awayTeamOdds", "moneyLine") ?? it.awayTeamOdds?.moneyLine);
      if (Number.isFinite(h) && Number.isFinite(a) && h && a) {
        g.ml = [h, a]; g.prov = it.provider?.name; g.spread = Number(it.spread); g.total = Number(it.overUnder);
        g.so = [Number(cl("homeTeamOdds", "spread") ?? it.homeTeamOdds?.spreadOdds), Number(cl("awayTeamOdds", "spread") ?? it.awayTeamOdds?.spreadOdds)];
        g.to = [Number(it.close?.over?.american ?? it.overOdds), Number(it.close?.under?.american ?? it.underOdds)];
        break;
      }
    }
  });
  console.log(key, list.length, "games,", list.filter((g) => g.ml).length, "with a closing line");
  fs.writeFileSync(`${key}.json`, JSON.stringify(list));
}
