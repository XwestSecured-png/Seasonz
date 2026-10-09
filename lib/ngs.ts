// Next Gen Stats (player tracking) + Pro Football Reference advanced stats,
// both republished free by nflverse as GitHub release files. No API key.
//
//   NGS passing   — completion % over expected (CPOE), time to throw
//   NGS rushing   — rush yards over expected (RYOE) per carry
//   NGS receiving — average separation, YAC over expected
//   PFR advanced  — QB pressure rate allowed, defensive pressures generated
//
// These become team-level, season-to-date numbers (only weeks BEFORE the
// game being predicted), then lib/ngs-matchup.ts turns the home/away gaps
// into small, capped win% nudges — the same pattern as lib/team-matchup.ts.
import { gunzipSync } from "zlib";
import { parse } from "csv-parse/sync";

const BASE = "https://github.com/nflverse/nflverse-data/releases/download";

// NGS uses "LAR" for the Rams; nflverse schedules/PFR use "LA".
const ABBR_FIX: Record<string, string> = { LAR: "LA" };
const fixTeam = (t: string) => ABBR_FIX[t] ?? t;

async function fetchText(url: string, gz: boolean): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": "seasonz (personal use)" } });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  if (!gz) return res.text();
  return gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8");
}

async function fetchRows(url: string, gz: boolean): Promise<Record<string, string>[]> {
  return parse(await fetchText(url, gz), { columns: true, skip_empty_lines: true });
}

const num = (v: string | undefined): number | null => {
  if (v === undefined || v === "" || v === "NA") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** One team's tracking/charting inputs for one week (summed across its players). */
export interface NgsTeamWeek {
  season: number;
  week: number;
  team: string;
  // passing
  passAttempts: number;
  cpoeWeighted: number; // sum(CPOE * attempts)
  timeToThrowWeighted: number; // sum(avg_time_to_throw * attempts)
  // rushing
  rushAttempts: number;
  ryoe: number; // sum of rush yards over expected
  // receiving
  targets: number;
  separationWeighted: number; // sum(avg_separation * targets)
  receptions: number;
  yacoeWeighted: number; // sum(avg_yac_above_expectation * receptions)
  // PFR pressure
  dropbacks: number; // estimated from times_pressured / times_pressured_pct
  timesPressured: number;
  defPressures: number; // pressures this team's DEFENSE generated
}

function blank(season: number, week: number, team: string): NgsTeamWeek {
  return {
    season,
    week,
    team,
    passAttempts: 0,
    cpoeWeighted: 0,
    timeToThrowWeighted: 0,
    rushAttempts: 0,
    ryoe: 0,
    targets: 0,
    separationWeighted: 0,
    receptions: 0,
    yacoeWeighted: 0,
    dropbacks: 0,
    timesPressured: 0,
    defPressures: 0,
  };
}

// The three NGS files cover every season back to 2016 in one download each,
// so cache them for the life of the server instance instead of refetching
// per season.
let ngsCache: Promise<{
  passing: Record<string, string>[];
  rushing: Record<string, string>[];
  receiving: Record<string, string>[];
}> | null = null;

function loadNgs() {
  if (!ngsCache) {
    ngsCache = Promise.all([
      fetchRows(`${BASE}/nextgen_stats/ngs_passing.csv.gz`, true),
      fetchRows(`${BASE}/nextgen_stats/ngs_rushing.csv.gz`, true),
      fetchRows(`${BASE}/nextgen_stats/ngs_receiving.csv.gz`, true),
    ]).then(([passing, rushing, receiving]) => ({ passing, rushing, receiving }));
    ngsCache.catch(() => {
      ngsCache = null; // let the next run retry after a failure
    });
  }
  return ngsCache;
}

/**
 * Team-week NGS + PFR inputs for one regular season. NGS week 0 rows are
 * season totals and are skipped — only real weekly rows are used, so a
 * caller can cut off at any week without lookahead. PFR advanced stats are
 * optional: if that file fails to load, pressure fields just stay 0.
 */
export async function fetchNgsTeamWeeks(season: number): Promise<NgsTeamWeek[]> {
  const ngs = await loadNgs();
  const byKey = new Map<string, NgsTeamWeek>();
  const get = (week: number, team: string) => {
    const t = fixTeam(team);
    const key = `${week}|${t}`;
    let row = byKey.get(key);
    if (!row) {
      row = blank(season, week, t);
      byKey.set(key, row);
    }
    return row;
  };
  const isReg = (r: Record<string, string>) =>
    Number(r.season) === season && r.season_type === "REG" && Number(r.week) > 0;

  for (const r of ngs.passing) {
    if (!isReg(r)) continue;
    const att = num(r.attempts);
    const cpoe = num(r.completion_percentage_above_expectation);
    const ttt = num(r.avg_time_to_throw);
    if (!att || cpoe === null) continue;
    const t = get(Number(r.week), r.team_abbr);
    t.passAttempts += att;
    t.cpoeWeighted += cpoe * att;
    if (ttt !== null) t.timeToThrowWeighted += ttt * att;
  }
  for (const r of ngs.rushing) {
    if (!isReg(r)) continue;
    const att = num(r.rush_attempts);
    const ryoe = num(r.rush_yards_over_expected);
    if (!att || ryoe === null) continue;
    const t = get(Number(r.week), r.team_abbr);
    t.rushAttempts += att;
    t.ryoe += ryoe;
  }
  for (const r of ngs.receiving) {
    if (!isReg(r)) continue;
    const tgt = num(r.targets);
    const sep = num(r.avg_separation);
    const rec = num(r.receptions);
    const yacoe = num(r.avg_yac_above_expectation);
    const t = get(Number(r.week), r.team_abbr);
    if (tgt && sep !== null) {
      t.targets += tgt;
      t.separationWeighted += sep * tgt;
    }
    if (rec && yacoe !== null) {
      t.receptions += rec;
      t.yacoeWeighted += yacoe * rec;
    }
  }

  try {
    const [pfrPass, pfrDef] = await Promise.all([
      fetchRows(`${BASE}/pfr_advstats/advstats_week_pass_${season}.csv`, false),
      fetchRows(`${BASE}/pfr_advstats/advstats_week_def_${season}.csv`, false),
    ]);
    for (const r of pfrPass) {
      if (Number(r.season) !== season || r.game_type !== "REG") continue;
      const pressured = num(r.times_pressured);
      const pct = num(r.times_pressured_pct);
      if (pressured === null || !pct) continue;
      const t = get(Number(r.week), r.team);
      t.timesPressured += pressured;
      t.dropbacks += pressured / pct;
    }
    for (const r of pfrDef) {
      if (Number(r.season) !== season || r.game_type !== "REG") continue;
      const p = num(r.def_pressures);
      if (p === null) continue;
      get(Number(r.week), r.team).defPressures += p;
    }
  } catch {
    // PFR file missing for this season (or not published yet) — the
    // pressure factor simply doesn't fire.
  }

  return Array.from(byKey.values());
}

/** Season-to-date team profile built from NgsTeamWeek rows. */
export interface NgsTeamProfile {
  team: string;
  weeks: number;
  cpoe: number | null; // offense: QB completion % over expected
  cpoeAllowed: number | null; // defense: CPOE opponents' QBs had against this team
  timeToThrow: number | null;
  ryoePerCarry: number | null; // offense
  ryoeAllowedPerCarry: number | null; // defense
  separation: number | null; // receivers' average separation (yards)
  separationAllowed: number | null; // separation this defense allowed
  yacoe: number | null; // YAC over expected per catch
  pressureRateAllowed: number | null; // share of dropbacks under pressure (offensive line)
  pressuresPerGame: number | null; // pressures this defense generates per game
}

/**
 * Builds each team's profile from weekly rows. `opponents` maps
 * "week|team" → opponent for that week (from the schedule) so defensive
 * "allowed" numbers can be read off the other team's offensive rows.
 */
export function computeNgsProfiles(
  rows: NgsTeamWeek[],
  opponents: Map<string, string>
): Map<string, NgsTeamProfile> {
  type Acc = {
    weeks: Set<number>;
    att: number;
    cpoe: number;
    ttt: number;
    attAllowed: number;
    cpoeAllowed: number;
    rush: number;
    ryoe: number;
    rushAllowed: number;
    ryoeAllowed: number;
    tgt: number;
    sep: number;
    tgtAllowed: number;
    sepAllowed: number;
    rec: number;
    yacoe: number;
    dropbacks: number;
    pressured: number;
    defPressures: number;
    pfrWeeks: number;
  };
  const acc = new Map<string, Acc>();
  const getAcc = (team: string) => {
    let a = acc.get(team);
    if (!a) {
      a = {
        weeks: new Set(),
        att: 0,
        cpoe: 0,
        ttt: 0,
        attAllowed: 0,
        cpoeAllowed: 0,
        rush: 0,
        ryoe: 0,
        rushAllowed: 0,
        ryoeAllowed: 0,
        tgt: 0,
        sep: 0,
        tgtAllowed: 0,
        sepAllowed: 0,
        rec: 0,
        yacoe: 0,
        dropbacks: 0,
        pressured: 0,
        defPressures: 0,
        pfrWeeks: 0,
      };
      acc.set(team, a);
    }
    return a;
  };

  for (const r of rows) {
    const own = getAcc(r.team);
    own.weeks.add(r.week);
    own.att += r.passAttempts;
    own.cpoe += r.cpoeWeighted;
    own.ttt += r.timeToThrowWeighted;
    own.rush += r.rushAttempts;
    own.ryoe += r.ryoe;
    own.tgt += r.targets;
    own.sep += r.separationWeighted;
    own.rec += r.receptions;
    own.yacoe += r.yacoeWeighted;
    own.dropbacks += r.dropbacks;
    own.pressured += r.timesPressured;
    own.defPressures += r.defPressures;
    if (r.dropbacks > 0 || r.defPressures > 0) own.pfrWeeks += 1;

    const opp = opponents.get(`${r.week}|${r.team}`);
    if (opp) {
      const d = getAcc(opp);
      d.attAllowed += r.passAttempts;
      d.cpoeAllowed += r.cpoeWeighted;
      d.rushAllowed += r.rushAttempts;
      d.ryoeAllowed += r.ryoe;
      d.tgtAllowed += r.targets;
      d.sepAllowed += r.separationWeighted;
    }
  }

  const ratio = (a: number, b: number, min = 1) => (b >= min ? a / b : null);
  const out = new Map<string, NgsTeamProfile>();
  for (const [team, a] of acc) {
    out.set(team, {
      team,
      weeks: a.weeks.size,
      cpoe: ratio(a.cpoe, a.att, 40),
      cpoeAllowed: ratio(a.cpoeAllowed, a.attAllowed, 40),
      timeToThrow: ratio(a.ttt, a.att, 40),
      ryoePerCarry: ratio(a.ryoe, a.rush, 20),
      ryoeAllowedPerCarry: ratio(a.ryoeAllowed, a.rushAllowed, 20),
      separation: ratio(a.sep, a.tgt, 30),
      separationAllowed: ratio(a.sepAllowed, a.tgtAllowed, 30),
      yacoe: ratio(a.yacoe, a.rec, 20),
      pressureRateAllowed: ratio(a.pressured, a.dropbacks, 40),
      pressuresPerGame: a.pfrWeeks > 0 ? a.defPressures / a.pfrWeeks : null,
    });
  }
  return out;
}

/** "week|team" → opponent, from a season's schedule. */
export function opponentMap(games: { week: number; homeTeam: string; awayTeam: string }[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const g of games) {
    m.set(`${g.week}|${g.homeTeam}`, g.awayTeam);
    m.set(`${g.week}|${g.awayTeam}`, g.homeTeam);
  }
  return m;
}
