// Backtest data: schedules (Elo warmup) + per-game closing moneyline (ESPN core odds)
// + starters (MLB pitcher, NHL goalie) + venue for the tune/test seasons.
import fs from "fs";
const B = "https://site.api.espn.com/apis/site/v2/sports";
const C = "https://sports.core.api.espn.com/v2/sports";
const S = {
  nba: ["basketball", "nba", [2024, 2025, 2026], [2025, 2026]],
  wnba: ["basketball", "wnba", [2023, 2024, 2025, 2026], [2024, 2025, 2026]],
  nhl: ["hockey", "nhl", [2024, 2025, 2026], [2025, 2026]],
  mlb: ["baseball", "mlb", [2024, 2025, 2026], [2025, 2026]],
  ncaaf: ["football", "college-football", [2023, 2024, 2025], [2024, 2025]],
  ncaab: ["basketball", "mens-college-basketball", [2024, 2025, 2026], [2025, 2026]],
};
async function j(u, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(u); if (r.ok) return await r.json(); if (r.status === 404) return null; } catch {}
    await new Promise((r) => setTimeout(r, 700 * (i + 1)));
  }
  return null;
}
async function pool(items, n, fn) {
  let i = 0, done = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k]); if (++done % 1000 === 0) console.log("  ", done, "/", items.length); } }));
}
const ml = (o) => {
  const items = (o?.items ?? []).filter((x) => !/live/i.test(x.provider?.name ?? ""));
  for (const it of items) {
    const h = Number(it.homeTeamOdds?.close?.moneyLine?.american ?? it.homeTeamOdds?.moneyLine);
    const a = Number(it.awayTeamOdds?.close?.moneyLine?.american ?? it.awayTeamOdds?.moneyLine);
    if (Number.isFinite(h) && Number.isFinite(a) && h !== 0 && a !== 0) return [h, a];
  }
  return null;
};
const only = process.argv[2]?.split(",");
for (const [key, [sp, lg, seasons, detail]] of Object.entries(S)) {
  if (only && !only.includes(key)) continue;
  const t = await j(`${B}/${sp}/${lg}/teams?limit=1000`);
  const teams = (t?.sports?.[0]?.leagues?.[0]?.teams ?? []).map((x) => x.team.id);
  const games = new Map();
  for (const season of seasons) {
    const jobs = teams.flatMap((id) => [2, 3].map((st) => ({ id, st })));
    await pool(jobs, 16, async ({ id, st }) => {
      const d = await j(`${B}/${sp}/${lg}/teams/${id}/schedule?season=${season}&seasontype=${st}`);
      for (const e of d?.events ?? []) {
        const c = e.competitions?.[0]; if (!c) continue;
        const h = c.competitors?.find((x) => x.homeAway === "home"), a = c.competitors?.find((x) => x.homeAway === "away");
        if (!h || !a || !c.status?.type?.completed) continue;
        const hs = Number(h.score?.value ?? h.score), as = Number(a.score?.value ?? a.score);
        if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;
        games.set(e.id, { id: e.id, season, st, t: e.date, h: h.team.abbreviation, a: a.team.abbreviation, hs, as, n: !!c.neutralSite,
          city: c.venue?.address?.city ?? null, state: c.venue?.address?.state ?? null, indoor: c.venue?.indoor ?? null });
      }
    });
    console.log(key, season, games.size);
  }
  const list = [...games.values()].sort((x, y) => x.t.localeCompare(y.t));
  const det = list.filter((g) => detail.includes(g.season));
  console.log(key, "detail games", det.length);
  const needBox = key === "mlb" || key === "nhl";
  await pool(det, 16, async (g) => {
    const o = await j(`${C}/${sp}/leagues/${lg}/events/${g.id}/competitions/${g.id}/odds`);
    g.ml = ml(o);
    if (needBox) {
      const s = await j(`${B}/${sp}/${lg}/summary?event=${g.id}`);
      for (const tp of s?.boxscore?.players ?? []) {
        const ab = tp.team?.abbreviation; const side = ab === g.h ? "hp" : ab === g.a ? "ap" : null; if (!side) continue;
        const grp = (tp.statistics ?? []).find((x) => key === "mlb" ? /pitch/i.test(x.type ?? x.name ?? "") || (x.labels ?? []).includes("IP") : (x.labels ?? []).includes("SA") || /goal/i.test(x.name ?? ""));
        if (!grp) continue;
        const rows = (grp.athletes ?? []).map((at) => { const r = { name: at.athlete?.displayName }; (grp.labels ?? []).forEach((l, i) => (r[l] = at.stats?.[i])); return r; });
        if (key === "mlb") g[side] = rows[0] ?? null;
        else { const toi = (x) => { const [m, s2] = String(x.TOI ?? "0:0").split(":").map(Number); return m * 60 + (s2 || 0); }; rows.sort((x, y) => toi(y) - toi(x)); g[side] = rows[0] ?? null; g[side + "2"] = rows.length > 1; }
      }
    }
  });
  console.log(key, "with odds", det.filter((g) => g.ml).length);
  fs.writeFileSync(`${key}.json`, JSON.stringify(list));
}
console.log("DONE");
