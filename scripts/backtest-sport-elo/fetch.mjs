// Pull several seasons of regular+post season games per sport from ESPN.
import fs from "fs";
const B = "https://site.api.espn.com/apis/site/v2/sports";
const S = {
  nba: ["basketball", "nba", [2023, 2024, 2025, 2026]],
  wnba: ["basketball", "wnba", [2023, 2024, 2025, 2026]],
  nhl: ["hockey", "nhl", [2023, 2024, 2025, 2026]],
  mlb: ["baseball", "mlb", [2023, 2024, 2025, 2026]],
  ncaaf: ["football", "college-football", [2023, 2024, 2025]],
  ncaab: ["basketball", "mens-college-basketball", [2024, 2025, 2026]],
};
async function j(u, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(u); if (r.ok) return await r.json(); } catch {}
    await new Promise((r) => setTimeout(r, 500 * (i + 1)));
  }
  return null;
}
async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}
const only = process.argv[2];
for (const [key, [sp, lg, seasons]] of Object.entries(S)) {
  if (only && key !== only) continue;
  const t = await j(`${B}/${sp}/${lg}/teams?limit=1000`);
  const teams = (t?.sports?.[0]?.leagues?.[0]?.teams ?? []).map((x) => x.team.id);
  const games = new Map();
  for (const season of seasons) {
    const jobs = teams.flatMap((id) => [2, 3].map((st) => ({ id, st })));
    await pool(jobs, 12, async ({ id, st }) => {
      const d = await j(`${B}/${sp}/${lg}/teams/${id}/schedule?season=${season}&seasontype=${st}`);
      for (const e of d?.events ?? []) {
        const c = e.competitions?.[0]; if (!c) continue;
        const h = c.competitors?.find((x) => x.homeAway === "home"), a = c.competitors?.find((x) => x.homeAway === "away");
        if (!h || !a || !c.status?.type?.completed) continue;
        const hs = Number(h.score?.value ?? h.score), as = Number(a.score?.value ?? a.score);
        if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;
        games.set(e.id, { season, st, t: e.date, h: h.team.abbreviation, a: a.team.abbreviation, hs, as, n: !!c.neutralSite });
      }
    });
    console.log(key, season, games.size);
  }
  fs.writeFileSync(`${key}.json`, JSON.stringify([...games.values()].sort((x, y) => x.t.localeCompare(y.t))));
}
