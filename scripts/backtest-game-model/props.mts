// @ts-nocheck -- standalone Node script (run with type stripping), not part of the app build
import fs from "fs";
import { projectProp, overProbability, type PropModelConfig, type DistKind } from "../../lib/prop-dist.ts";

type Series = { v: number[]; m?: number[] };
const clamp = (p: number) => Math.min(0.999, Math.max(0.001, p));

function evaluate(series: Series[], floorAbs: number, base: PropModelConfig, variants: Record<string, PropModelConfig>, isCount: boolean) {
  const acc: Record<string, { ll: number; n: number; bn: number; bp: number; ba: number }> = {};
  for (const k of Object.keys(variants)) acc[k] = { ll: 0, n: 0, bn: 0, bp: 0, ba: 0 };
  for (const s of series) {
    for (let i = 3; i < s.v.length; i++) {
      const lo = Math.max(0, i - 20);
      const prior = s.v.slice(lo, i);
      const pm = s.m ? s.m.slice(lo, i) : undefined;
      if (s.m && !(s.m[i] > 0)) continue; // didn't play
      const b = projectProp(prior, base, floorAbs, pm);
      if (!b || b.mean <= 0) continue;
      const actual = s.v[i];
      const projs: Record<string, ReturnType<typeof projectProp>> = {};
      for (const [k, cfg] of Object.entries(variants)) projs[k] = projectProp(prior, cfg, floorAbs, pm);
      if (Object.values(projs).some((p) => !p)) continue;
      for (const d of [-1, -0.5, 0, 0.5, 1]) {
        const line = Math.max(0.5, Math.floor(b.mean + d * (b.sd / base.sdMult)) + 0.5);
        const hit = actual > line ? 1 : 0;
        for (const [k, cfg] of Object.entries(variants)) {
          if (!isCount && cfg.dist !== "normal") continue;
          const p = clamp(overProbability(projs[k]!, line, cfg.dist));
          const a = acc[k];
          a.ll -= hit * Math.log(p) + (1 - hit) * Math.log(1 - p);
          a.n++;
          const pick = Math.max(p, 1 - p);
          if (pick >= 0.7) { a.bn++; a.bp += pick; a.ba += p >= 0.5 ? hit : 1 - hit; }
        }
      }
    }
  }
  const out: Record<string, unknown> = {};
  for (const [k, a] of Object.entries(acc)) if (a.n) out[k] = { ll: +(a.ll / a.n).toFixed(4), n: a.n, b70: a.bn ? `${(100 * a.bp / a.bn).toFixed(1)}/${(100 * a.ba / a.bn).toFixed(1)} (${a.bn})` : "-" };
  return out;
}

function variantsFor(sdMult: number, minutes: boolean): Record<string, PropModelConfig> {
  const v: Record<string, PropModelConfig> = {};
  for (const dist of ["normal", "poisson", "negbin"] as DistKind[])
    for (const k of [0, 5, 15, 40])
      for (const mm of minutes ? [false, true] : [false])
        v[`${dist}|k${k}${mm ? "|min" : ""}`] = { dist, sdMult, shrinkK: k, useMinutes: mm };
  return v;
}

const results: Record<string, unknown> = {};
// Basketball
const BB: [string, number, number, number, boolean][] = [
  // stat, index in box row, floor, current sdMult, isCount
  ["Points", 4, 4, 1.2, true], ["Rebounds", 5, 2, 1.1, true], ["Assists", 6, 1.5, 1.1, true], ["3-Pointers Made", 7, 1, 1.3, true],
  ["Steals", 8, 0.7, 1.5, true], ["Blocks", 9, 0.7, 1.5, true], ["Turnovers", 10, 0.8, 1.4, true],
];
for (const file of (process.argv[2] ?? "nba,wnba").split(",")) {
  if (file === "nfl") continue;
  const G = JSON.parse(fs.readFileSync(`${file}-box.json`, "utf8")) as { P: (string | number)[][] }[];
  const byPlayer = new Map<string, { v: number[][] }>();
  for (const g of G) for (const p of g.P) { const e = byPlayer.get(p[1] as string) ?? { v: [] }; e.v.push(p as unknown as number[]); byPlayer.set(p[1] as string, e); }
  const res: Record<string, unknown> = {};
  for (const [stat, idx, floor, mult] of BB) {
    const series: Series[] = [];
    for (const e of byPlayer.values()) {
      const vals = e.v.map((r) => Number(r[idx]));
      if (vals.filter((x) => x > 0).length < vals.length * 0.5) continue;
      series.push({ v: vals, m: e.v.map((r) => Number(r[2])) });
    }
    res[stat] = evaluate(series, floor, { dist: "normal", sdMult: mult, shrinkK: 0, useMinutes: false }, variantsFor(mult, true), true);
  }
  results[file] = res;
}
if ((process.argv[2] ?? "").includes("nfl")) {
  const parse = (t: string) => { const out: string[][] = []; let row: string[] = [], f = "", q = false; for (let i = 0; i < t.length; i++) { const c = t[i]; if (q) { if (c === '"') { if (t[i + 1] === '"') { f += c; i++; } else q = false; } else f += c; } else if (c === '"') q = true; else if (c === ",") { row.push(f); f = ""; } else if (c === "\n") { row.push(f); out.push(row); row = []; f = ""; } else if (c !== "\r") f += c; } if (f || row.length) { row.push(f); out.push(row); } return out; };
  const rows: Record<string, string>[] = [];
  for (let s = 2021; s <= 2025; s++) { const t = await (await fetch(`https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${s}.csv`)).text(); const L = parse(t); const H = L[0]; for (const c of L.slice(1)) if (c.length === H.length) rows.push(Object.fromEntries(H.map((h, i) => [h, c[i]]))); }
  rows.sort((a, b) => +a.season - +b.season || +a.week - +b.week);
  const NF: [string, (r: Record<string, string>) => number, number, number, boolean][] = [
    ["Pass Yds", (r) => +r.passing_yards || 0, 15, 1.3, false], ["Rush Yds", (r) => +r.rushing_yards || 0, 8, 1.3, false], ["Rec Yds", (r) => +r.receiving_yards || 0, 8, 1.4, false],
    ["Receptions", (r) => +r.receptions || 0, 1, 1.3, true], ["Pass TDs", (r) => +r.passing_tds || 0, 0.5, 1.5, true], ["Rush+Rec TDs", (r) => (+r.rushing_tds || 0) + (+r.receiving_tds || 0), 0.4, 1.5, true],
    ["Rush Attempts", (r) => +r.carries || 0, 2, 1.3, true], ["Completions", (r) => +r.completions || 0, 2, 1.3, true],
  ];
  const res: Record<string, unknown> = {};
  for (const [stat, f, floor, mult, isCount] of NF) {
    const byP = new Map<string, number[]>();
    for (const r of rows) { if (r.season_type !== "REG") continue; const l = byP.get(r.player_id) ?? []; l.push(f(r)); byP.set(r.player_id, l); }
    const series: Series[] = [...byP.values()].filter((v) => stat === "Rush+Rec TDs" ? v.length >= 8 : v.filter((x) => x > 0).length >= v.length * 0.5).map((v) => ({ v }));
    res[stat] = evaluate(series, floor, { dist: "normal", sdMult: mult, shrinkK: 0, useMinutes: false }, variantsFor(mult, false), isCount);
  }
  results.nfl = res;
}
fs.writeFileSync(`propvar-${process.argv[2] ?? "bb"}.json`, JSON.stringify(results));
for (const [f, r] of Object.entries(results)) for (const [s, v] of Object.entries(r as object)) {
  const e = Object.entries(v as Record<string, { ll: number; b70: string }>).sort((a, b) => a[1].ll - b[1].ll);
  const cur = (v as Record<string, { ll: number; b70: string }>)["normal|k0"];
  console.log(f, s, "current", cur?.ll, cur?.b70, "| best", e.slice(0, 3).map(([k, x]) => `${k} ${x.ll} ${x.b70}`).join(" ; "));
}
