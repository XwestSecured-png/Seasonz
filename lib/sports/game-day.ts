// Game-day context for the other sports' prop projections (1.17.0), each
// checked on 2025-27 box scores with /api/health/insights?signalcal=<sport>
// (log loss at lines around the projection; train = last season, test =
// this season):
//
//  MLB, the opposing starting pitcher (ESPN's probable starter): his
//    strikeouts and hits per inning over his last 15 starts vs the league,
//    shrunk with 30 innings of league average. Batter Ks gained .21% / .44%,
//    Runs .31% / .12%, RBIs .18% / .18%, Hits .14% / .06%.
//  MLB, the ballpark: each stat per team-game at the home park vs the
//    league, shrunk with 40 games. Hits, HR, RBIs, Runs gained .03-.10%.
//    Both are used at 3/4 of their best-fit strength, since the existing
//    opponent adjustment already covers part of the same ground.
//  College football: opponent strength from its pre-game Elo. Rush Yds
//    gained 1.0% (Rush + Rec .28%); passing and receiving didn't, so they
//    aren't adjusted. Used at half strength for the same overlap reason.
//
// Tested and not used: MLB batting-order slot (no gain), basketball blowout
// risk from the pre-game win chance (no gain).

export interface GameDayContext {
  /** MLB: per team this week, the opposing starter's strikeout and hit rates vs the league. */
  oppPitcher?: Map<string, { name: string; k: number; h: number }>;
  /** MLB: per team this week, the park factor per stat. */
  park?: Map<string, Record<string, number>>;
  /** College football: per team this week, the opponent's Elo vs average, in 100s. */
  oppEloZ?: Map<string, number>;
  /** Basketball: bench players moving into a starter's spot (key "team|player" -> the starter who's out). */
  backups?: Map<string, string>;
  /** Per team this week: playing at home, and on the second night of a back-to-back. */
  venue?: Map<string, { home: boolean; b2b: boolean }>;
  /** Basketball: this week's opponent's recent turnover rate (z-score, last 10 games, scaled by sqrt(games)), keyed by the team facing them. */
  oppTurnovers?: Map<string, number>;
}

export interface GameDayRow {
  /** Row id: ESPN lists starters first, so the first five saved per team-game started. */
  id?: number;
  position?: string | null;
  player: string;
  team: string;
  gameId: number;
  home: string;
  t: number;
  stats: Record<string, string>;
}

interface WeekGame {
  homeTeam: string;
  awayTeam: string;
  kickoffAt?: Date | null;
  eloHomePre: number | null;
  eloAwayPre: number | null;
  extra: unknown;
}

const N = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const innings = (ip: unknown) => {
  const x = N(ip);
  return Math.floor(x) + (x % 1) * (10 / 3);
};

export function buildGameDayContext(
  sport: string,
  weekGames: WeekGame[],
  seasonGames: { eloHomePre: number | null; eloAwayPre: number | null; homeTeam?: string; awayTeam?: string; kickoffAt?: Date | null }[],
  rows: GameDayRow[],
  extractors: { statType: string; extract: (s: Record<string, string>) => number | null }[],
  /** Players listed Out this week ("team|player"). */
  out: Set<string> = new Set()
): GameDayContext {
  const ctx: GameDayContext = {};
  if (sport === "nba" || sport === "wnba" || sport === "ncaab") ctx.backups = basketballBackups(weekGames, rows, out);
  // Home/away and back-to-backs (each team's next game this week).
  ctx.venue = new Map();
  const next = [...weekGames].filter((g) => g.kickoffAt && g.kickoffAt.getTime() > Date.now()).sort((a, b) => a.kickoffAt!.getTime() - b.kickoffAt!.getTime());
  for (const g of next) {
    for (const [team, home] of [[g.homeTeam, true], [g.awayTeam, false]] as const) {
      if (ctx.venue.has(team)) continue;
      const kick = g.kickoffAt!.getTime();
      const prev = seasonGames
        .filter((x) => (x.homeTeam === team || x.awayTeam === team) && x.kickoffAt && x.kickoffAt.getTime() < kick)
        .reduce((a, x) => Math.max(a, x.kickoffAt!.getTime()), 0);
      ctx.venue.set(team, { home, b2b: prev > 0 && kick - prev < 30 * 3600_000 });
    }
  }
  if (sport === "nba" || sport === "wnba") ctx.oppTurnovers = opponentTurnovers(weekGames, rows);
  if (sport === "mlb") {
    // Opposing probable starters.
    const starts = rows.filter((r) => "IP" in r.stats && innings(r.stats.IP) >= 3);
    let lgIp = 0, lgK = 0, lgH = 0;
    for (const r of starts) {
      lgIp += innings(r.stats.IP);
      lgK += N(r.stats.K);
      lgH += N(r.stats.H);
    }
    const lgKr = lgK / Math.max(1, lgIp);
    const lgHr = lgH / Math.max(1, lgIp);
    const byPitcher = new Map<string, GameDayRow[]>();
    for (const r of starts) (byPitcher.get(r.player.toLowerCase()) ?? byPitcher.set(r.player.toLowerCase(), []).get(r.player.toLowerCase())!).push(r);
    const rateOf = (name: string | null | undefined) => {
      if (!name) return null;
      const l = (byPitcher.get(name.toLowerCase()) ?? []).sort((a, b) => a.t - b.t).slice(-15);
      const ip = l.reduce((a, r) => a + innings(r.stats.IP), 0);
      if (ip < 10) return null;
      const k = l.reduce((a, r) => a + N(r.stats.K), 0) / ip;
      const h = l.reduce((a, r) => a + N(r.stats.H), 0) / ip;
      return { k: (k * ip + lgKr * 30) / (ip + 30) / lgKr, h: (h * ip + lgHr * 30) / (ip + 30) / lgHr };
    };
    ctx.oppPitcher = new Map();
    for (const g of weekGames) {
      const pv = (g.extra as { preview?: { homeProbable?: string | null; awayProbable?: string | null } } | null)?.preview;
      const vsHome = rateOf(pv?.awayProbable); // the home team faces the away starter
      const vsAway = rateOf(pv?.homeProbable);
      if (vsHome && pv?.awayProbable) ctx.oppPitcher.set(g.homeTeam, { name: pv.awayProbable, ...vsHome });
      if (vsAway && pv?.homeProbable) ctx.oppPitcher.set(g.awayTeam, { name: pv.homeProbable, ...vsAway });
    }
    // Park factors per stat, from batters' team-game totals at each home park.
    const parkStats = ["Hits", "Home Runs", "RBIs", "Runs Scored"];
    const ex = extractors.filter((e) => parkStats.includes(e.statType));
    const teamGame = new Map<string, { home: string; sums: Record<string, number> }>();
    for (const r of rows) {
      if ("IP" in r.stats) continue;
      const k = `${r.gameId}|${r.team}`;
      const tg = teamGame.get(k) ?? { home: r.home, sums: {} };
      for (const e of ex) tg.sums[e.statType] = (tg.sums[e.statType] ?? 0) + (e.extract(r.stats) ?? 0);
      teamGame.set(k, tg);
    }
    const parkAgg = new Map<string, { n: number; sums: Record<string, number> }>();
    const lg: Record<string, number> = {};
    let lgN = 0;
    for (const tg of teamGame.values()) {
      const p = parkAgg.get(tg.home) ?? { n: 0, sums: {} };
      p.n++;
      for (const [s, v] of Object.entries(tg.sums)) {
        p.sums[s] = (p.sums[s] ?? 0) + v;
        lg[s] = (lg[s] ?? 0) + v;
      }
      lgN++;
      parkAgg.set(tg.home, p);
    }
    ctx.park = new Map();
    for (const g of weekGames) {
      const p = parkAgg.get(g.homeTeam);
      if (!p || lgN === 0) continue;
      const f: Record<string, number> = {};
      for (const s of parkStats) {
        const lgAvg = (lg[s] ?? 0) / lgN;
        if (lgAvg <= 0) continue;
        f[s] = ((p.sums[s] ?? 0) + lgAvg * 40) / (p.n + 40) / lgAvg;
      }
      ctx.park.set(g.homeTeam, f);
      ctx.park.set(g.awayTeam, f);
    }
  }
  if (sport === "ncaaf") {
    const elos = seasonGames.flatMap((g) => [g.eloHomePre, g.eloAwayPre]).filter((x): x is number => x !== null);
    if (elos.length) {
      const avg = elos.reduce((a, b) => a + b, 0) / elos.length;
      ctx.oppEloZ = new Map();
      for (const g of weekGames) {
        if (g.eloAwayPre !== null) ctx.oppEloZ.set(g.homeTeam, (g.eloAwayPre - avg) / 100);
        if (g.eloHomePre !== null) ctx.oppEloZ.set(g.awayTeam, (g.eloHomePre - avg) / 100);
      }
    }
  }
  return ctx;
}

/**
 * Basketball (1.17.0): when a usual starter (7+ starts in his last 10
 * games, played in one of the team's last 3) is listed Out, the bench
 * player at his position (guard / forward / center) with the most minutes
 * lately moves into his spot. Live check, with box-score absences standing
 * in for the injury report: that player beat his projection by ~20% (NBA
 * Pts+Reb+Ast log loss -5.6%, Points -3.7%; WNBA Pts+Reb+Ast -4.4% / -5.8%).
 * Used a little below the best fit (the report doesn't always match who
 * actually starts).
 */
const BACKUP_BOOST: Record<string, number> = {
  Points: 1.12,
  "Pts+Reb+Ast": 1.15,
  "Pts+Reb": 1.15,
  "Reb+Ast": 1.15,
  Rebounds: 1.08,
  Assists: 1.1,
  "3-Pointers Made": 1.08,
  Steals: 1.05,
  Turnovers: 1.08,
};
const bbGroup = (p: string | null | undefined) => {
  const x = (p ?? "").toUpperCase();
  return x.startsWith("C") ? "C" : x.startsWith("G") || x === "PG" || x === "SG" ? "G" : "F";
};
function basketballBackups(weekGames: WeekGame[], rows: GameDayRow[], out: Set<string>): Map<string, string> {
  const res = new Map<string, string>();
  if (out.size === 0) return res;
  const playing = new Set(weekGames.flatMap((g) => [g.homeTeam, g.awayTeam]));
  // Starters: first five rows saved per team-game.
  const byTG = new Map<string, GameDayRow[]>();
  for (const r of rows) {
    if (!playing.has(r.team) || r.id === undefined) continue;
    (byTG.get(`${r.gameId}|${r.team}`) ?? byTG.set(`${r.gameId}|${r.team}`, []).get(`${r.gameId}|${r.team}`)!).push(r);
  }
  const started = new Set<number>();
  const teamGames = new Map<string, { gameId: number; t: number }[]>();
  for (const [k, l] of byTG) {
    l.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
    l.slice(0, 5).forEach((r) => started.add(r.id!));
    const team = k.slice(k.indexOf("|") + 1);
    (teamGames.get(team) ?? teamGames.set(team, []).get(team)!).push({ gameId: l[0].gameId, t: l[0].t });
  }
  const minutes = (r: GameDayRow) => {
    const m = Number(r.stats.MIN);
    return Number.isFinite(m) ? m : 0;
  };
  for (const [team, tg] of teamGames) {
    tg.sort((a, b) => a.t - b.t);
    const recent = new Set(tg.slice(-3).map((x) => x.gameId));
    const players = new Map<string, GameDayRow[]>();
    for (const g of tg) for (const r of byTG.get(`${g.gameId}|${team}`) ?? []) (players.get(r.player) ?? players.set(r.player, []).get(r.player)!).push(r);
    const info = [...players.entries()].map(([player, l]) => {
      const last = l.slice(-10);
      return {
        player,
        pos: bbGroup(l[l.length - 1].position),
        n: last.length,
        rate: last.filter((r) => started.has(r.id!)).length / Math.max(1, last.length),
        min: last.reduce((a, r) => a + minutes(r), 0) / Math.max(1, last.length),
        active: l.some((r) => recent.has(r.gameId)),
      };
    });
    const used = new Set<string>();
    for (const s of info) {
      if (!out.has(`${team}|${s.player}`) || s.n < 5 || s.rate < 0.7 || !s.active) continue;
      const pick = info
        .filter((c) => c.pos === s.pos && c.active && c.n >= 5 && c.rate < 0.5 && !used.has(c.player) && !out.has(`${team}|${c.player}`))
        .sort((a, b) => b.min - a.min)[0];
      if (pick) {
        used.add(pick.player);
        res.set(`${team}|${pick.player}`, s.player);
      }
    }
  }
  return res;
}

/**
 * Home/away and back-to-backs (1.17.1), kept only where the live check
 * (/api/health/insights?signalcal=<sport>&set=context) agreed on last
 * season and this one: NHL shots on goal x0.95 on the road and x0.94 on the
 * second night of a back-to-back (log loss -0.2% / -0.3%), points and
 * assists x0.92 on back-to-backs (-1.2% / -1.9% this season), goals x1.05
 * at home, goalie saves x0.97 at home (home goalies face fewer shots);
 * WNBA points x0.95 and rebounds x0.97 on the road. NBA had no current
 * season to confirm with yet, and baseball and college football showed nothing.
 */
const CONTEXT: Partial<Record<string, Record<string, { away?: number; home?: number; b2b?: number }>>> = {
  nhl: {
    "Shots on Goal": { away: 0.95, b2b: 0.94 },
    Points: { b2b: 0.92 },
    Assists: { b2b: 0.92 },
    Goals: { home: 1.05 },
    Saves: { home: 0.97 },
  },
  wnba: { Points: { away: 0.95 }, Rebounds: { away: 0.97 } },
};

/**
 * Opponent mistakes (1.18.0): a team that rarely turns the ball over gives
 * up fewer steals, fast-break points and threes. Factor = exp(c * z), z =
 * the opponent's turnovers over its last 10 games vs the league. Measured
 * in /api/health/insights?mentalcal=wnba|nba on last season and this one
 * (WNBA both, NBA last season); halved from the fitted strength because the
 * opponent adjustment already catches part of it. Fouls and hockey
 * giveaways/penalty minutes showed nothing consistent.
 */
const OPP_TO_C: Record<string, number> = { Steals: 0.04, Blocks: 0.03, "3-Pointers Made": 0.02, Assists: 0.02, Points: 0.02, Turnovers: -0.03 };

function opponentTurnovers(weekGames: WeekGame[], rows: GameDayRow[]): Map<string, number> {
  const tg = new Map<string, { team: string; t: number; to: number }>();
  for (const r of rows) {
    const k = `${r.gameId}|${r.team}`;
    const e = tg.get(k) ?? tg.set(k, { team: r.team, t: r.t, to: 0 }).get(k)!;
    e.to += N(r.stats.TO);
  }
  const all = [...tg.values()].map((x) => x.to);
  const m = all.reduce((a, b) => a + b, 0) / Math.max(1, all.length);
  const sd = Math.sqrt(all.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, all.length - 1)) || 1;
  const byTeam = new Map<string, { t: number; to: number }[]>();
  for (const x of tg.values()) (byTeam.get(x.team) ?? byTeam.set(x.team, []).get(x.team)!).push(x);
  const z = new Map<string, number>();
  for (const [team, l] of byTeam) {
    const last = l.sort((a, b) => a.t - b.t).slice(-10);
    if (last.length < 5) continue;
    const mz = last.reduce((a, x) => a + (x.to - m) / sd, 0) / last.length;
    z.set(team, Math.max(-2, Math.min(2, mz * Math.sqrt(last.length))));
  }
  const out = new Map<string, number>();
  for (const g of weekGames) {
    if (z.has(g.awayTeam) && !out.has(g.homeTeam)) out.set(g.homeTeam, z.get(g.awayTeam)!);
    if (z.has(g.homeTeam) && !out.has(g.awayTeam)) out.set(g.awayTeam, z.get(g.homeTeam)!);
  }
  return out;
}

const PITCHER_K_POW: Record<string, number> = { "Strikeouts (Batter)": 0.45 };
const PITCHER_H_POW: Record<string, number> = { Hits: 0.25, "Runs Scored": 0.4, RBIs: 0.45, "Home Runs": 0.35 };
const PARK_POW: Record<string, number> = { Hits: 0.55, "Home Runs": 0.4, RBIs: 0.45, "Runs Scored": 0.4 };
const ELO_C: Record<string, number> = { "Rush Yds": 0.04, "Rush + Rec Yds": 0.02 };

/** The combined game-day multiplier for one player's stat, with a reason when it moves the number 5%+. */
export function gameDayFactor(ctx: GameDayContext | undefined, team: string, statType: string, player?: string, sport?: string): { factor: number; reason: string | null } {
  if (!ctx) return { factor: 1, reason: null };
  let f = 1;
  const why: string[] = [];
  const ven = ctx.venue?.get(team);
  const cx = sport ? CONTEXT[sport]?.[statType] : undefined;
  if (ven && cx) {
    if (ven.home && cx.home) f *= cx.home;
    if (!ven.home && cx.away) {
      f *= cx.away;
      why.push("on the road");
    }
    if (ven.b2b && cx.b2b) {
      f *= cx.b2b;
      why.push("second night of a back-to-back");
    }
  }
  const replacing = player ? ctx.backups?.get(`${team}|${player}`) : undefined;
  if (replacing && BACKUP_BOOST[statType]) {
    f *= BACKUP_BOOST[statType];
    why.push(`stepping in for ${replacing} (Out)`);
  }
  const oz = ctx.oppTurnovers?.get(team);
  if (oz !== undefined && OPP_TO_C[statType]) {
    const x = Math.exp(OPP_TO_C[statType] * oz);
    if (Math.abs(x - 1) >= 0.04) why.push(oz > 0 ? "opponent turns it over a lot" : "opponent rarely turns it over");
    f *= x;
  }
  const op = ctx.oppPitcher?.get(team);
  if (op) {
    const k = PITCHER_K_POW[statType] ? Math.pow(op.k, PITCHER_K_POW[statType]) : 1;
    const h = PITCHER_H_POW[statType] ? Math.pow(op.h, PITCHER_H_POW[statType]) : 1;
    if (Math.abs(k * h - 1) >= 0.05) why.push(`facing ${op.name}`);
    f *= k * h;
  }
  const pf = ctx.park?.get(team)?.[statType];
  if (pf && PARK_POW[statType]) {
    const x = Math.pow(pf, PARK_POW[statType]);
    if (Math.abs(x - 1) >= 0.05) why.push(x > 1 ? "hitter-friendly park" : "pitcher-friendly park");
    f *= x;
  }
  const z = ctx.oppEloZ?.get(team);
  if (z !== undefined && ELO_C[statType]) {
    const x = Math.min(1.2, Math.max(0.8, 1 - ELO_C[statType] * z));
    if (Math.abs(x - 1) >= 0.05) why.push(x < 1 ? "strong opponent" : "weak opponent");
    f *= x;
  }
  return { factor: f, reason: why.length ? `Game-day: ${why.join(", ")} (projection ${f >= 1 ? "+" : ""}${Math.round((f - 1) * 100)}%)` : null };
}
