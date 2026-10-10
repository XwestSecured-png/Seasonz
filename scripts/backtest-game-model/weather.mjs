// Adds hourly weather at first pitch/kickoff (Open-Meteo archive) to <sport>.json for outdoor games.
import fs from "fs";
const sport = process.argv[2];
const G = JSON.parse(fs.readFileSync(`${sport}.json`, "utf8"));
const seasons = [...new Set(G.filter((g) => g.ml !== undefined).map((g) => g.season))];
async function j(u, tries = 4) { for (let i = 0; i < tries; i++) { try { const r = await fetch(u); if (r.ok) return await r.json(); } catch {} await new Promise((r) => setTimeout(r, 1500 * (i + 1))); } return null; }
const geo = new Map();
const venues = new Map();
for (const g of G) if (seasons.includes(g.season) && g.city && g.indoor !== true) { const k = `${g.city}|${g.state ?? ""}`; (venues.get(k) ?? venues.set(k, []).get(k)).push(g); }
console.log("venues", venues.size);
let n = 0;
for (const [k, games] of venues) {
  const [city, state] = k.split("|");
  const q = await j(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=10&countryCode=US`);
  const st = (state || "").toLowerCase();
  const hit = (q?.results ?? []).find((r) => !st || (r.admin1 ?? "").toLowerCase().startsWith(st) || (r.admin1 ?? "").toLowerCase() === st) ?? q?.results?.[0];
  if (!hit) continue;
  const ds = games.map((g) => g.t.slice(0, 10)).sort();
  const w = await j(`https://archive-api.open-meteo.com/v1/archive?latitude=${hit.latitude}&longitude=${hit.longitude}&start_date=${ds[0]}&end_date=${ds.at(-1)}&hourly=temperature_2m,wind_speed_10m,precipitation&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=UTC`);
  if (!w?.hourly) continue;
  const idx = new Map(w.hourly.time.map((t, i) => [t.slice(0, 13), i]));
  for (const g of games) { const i = idx.get(g.t.slice(0, 13)); if (i === undefined) continue; g.wx = { temp: w.hourly.temperature_2m[i], wind: w.hourly.wind_speed_10m[i], precip: w.hourly.precipitation[i] }; n++; }
  await new Promise((r) => setTimeout(r, 150));
}
console.log("games with weather", n);
fs.writeFileSync(`${sport}.json`, JSON.stringify(G));
