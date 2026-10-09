// Generic data source for every non-NFL sport (NBA/NHL/MLB/NCAAF/NCAAB),
// built against ESPN's public (undocumented) site API — the same family of
// endpoints lib/espn.ts already uses for NFL's FPI/QBR factor. NFL itself
// stays on nflverse (lib/nflverse.ts); this file is only for the sports that
// have no nflverse-equivalent free CSV source.
//
// IMPORTANT CAVEAT (same situation as lib/espn.ts): this sandbox's own
// egress proxy blocks site.api.espn.com outright ("organization policy"),
// so none of this could be test-fetched against live data before shipping.
// It's built from the well-documented public shape of ESPN's site API
// (the same shape every "espn-api"-style open-source wrapper documents) and
// parsed defensively — one malformed team/event never kills the whole sync
// stage. The first real sync run on Vercel (which has normal outbound
// access) is what actually proves the shape guess right; check the
// "<sport>:schedule" row in Sync Runs after that first run — if it shows 0
// teams/games synced, the field names below need adjusting against the real
// response, same as the FPI/QBR note already says for NFL.
import type { SportKey, SportDef, GenericGame, GenericTeam } from "./types";

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports";

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`ESPN fetch failed: ${res.status} ${res.statusText} (${url})`);
  }
  return res.json();
}

/**
 * ESPN's season-year convention differs by sport and isn't the same as how
 * humans name the season. Best-guess rules below (documented per sport) —
 * same "verify against the first real sync" caveat as above.
 */
export function currentSeasonYear(sport: SportKey): number {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed
  switch (sport) {
    case "nba":
    case "ncaab":
      // Oct–June season, named by its ENDING year in ESPN's own convention
      // (e.g. the 2026-27 season is queried as season=2027). Treat Aug+ as
      // already the upcoming season.
      return month >= 7 ? year + 1 : year;
    case "nhl":
      // Same Oct–June shape/convention as NBA.
      return month >= 7 ? year + 1 : year;
    case "mlb":
    case "wnba":
      // Mar–Nov (MLB) / May–Oct (WNBA), both single-calendar-year seasons
      // unlike NBA's split-year naming. Nov-Feb offseason still refers back
      // to the just-finished year until the next season's news cycle starts.
      return month <= 1 ? year - 1 : year;
    case "ncaaf":
      // Aug–Jan, named by its STARTING year (college convention — "the 2026
      // season" runs Aug 2026 through the Jan 2027 bowls/playoff).
      return month === 0 ? year - 1 : year;
  }
}

/** Every team in this sport/league, with ESPN's internal numeric team id — what the schedule endpoint below keys on. */
export async function fetchTeams(def: SportDef): Promise<GenericTeam[]> {
  const url = `${ESPN_BASE}/${def.espnSport}/${def.espnLeague}/teams?limit=500`;
  const data = await fetchJson(url);
  const out: GenericTeam[] = [];

  const leagues: unknown[] = data?.sports?.[0]?.leagues ?? [];
  const teamEntries: unknown[] = (leagues[0] as any)?.teams ?? [];

  for (const entry of teamEntries) {
    try {
      const team = (entry as any)?.team;
      if (!team?.id || !team?.abbreviation) continue;
      out.push({
        sport: def.key,
        abbr: String(team.abbreviation).toUpperCase(),
        name: String(team.displayName ?? team.name ?? team.abbreviation),
        conference: team?.groups?.parent?.name ?? null,
        division: team?.groups?.name ?? null,
        primaryColor: team?.color ? `#${team.color}` : null,
        secondaryColor: team?.alternateColor ? `#${team.alternateColor}` : null,
        espnTeamId: String(team.id),
      });
    } catch {
      continue;
    }
  }
  return out;
}

/**
 * One team's full-season schedule (every game, past and future). Every game
 * appears in both participants' schedules, so fetchFullSeasonSchedule below
 * de-dupes by espnEventId after calling this once per team — far cheaper
 * than iterating every calendar date of the season via the scoreboard
 * endpoint, and it's the same total game count either way.
 */
export async function fetchTeamSchedule(
  def: SportDef,
  espnTeamId: string,
  season: number,
  seasonType?: 2 | 3
): Promise<GenericGame[]> {
  // seasontype 2 = regular season, 3 = postseason. Without it ESPN returns
  // only the CURRENT phase (e.g. just the playoffs in October for MLB, or
  // just preseason for the NBA), which left the model rating teams off a
  // handful of games.
  const url = `${ESPN_BASE}/${def.espnSport}/${def.espnLeague}/teams/${espnTeamId}/schedule?season=${season}${
    seasonType ? `&seasontype=${seasonType}` : ""
  }`;
  const data = await fetchJson(url);
  const events: unknown[] = Array.isArray(data?.events) ? data.events : [];
  const out: GenericGame[] = [];

  for (const event of events) {
    try {
      const e = event as any;
      const competition = e?.competitions?.[0];
      const competitors: unknown[] = Array.isArray(competition?.competitors)
        ? competition.competitors
        : [];
      const home = competitors.find((c: any) => c?.homeAway === "home") as any;
      const away = competitors.find((c: any) => c?.homeAway === "away") as any;
      if (!home?.team?.abbreviation || !away?.team?.abbreviation) continue;

      const isFinal = Boolean(competition?.status?.type?.completed);
      const homeScoreRaw = home?.score?.value ?? home?.score;
      const awayScoreRaw = away?.score?.value ?? away?.score;
      const homeScore = isFinal && homeScoreRaw !== undefined ? Number(homeScoreRaw) : null;
      const awayScore = isFinal && awayScoreRaw !== undefined ? Number(awayScoreRaw) : null;

      const dateStr: string | undefined = e?.date;
      const kickoffAt = dateStr ? new Date(dateStr) : null;

      out.push({
        sport: def.key,
        espnEventId: String(e.id),
        season,
        week: 0, // filled in by weekBucketFor() once the full-season list is sorted
        gameDate: kickoffAt ? kickoffAt.toISOString().slice(0, 10) : null,
        kickoffAt: kickoffAt && !Number.isNaN(kickoffAt.getTime()) ? kickoffAt : null,
        homeTeam: String(home.team.abbreviation).toUpperCase(),
        awayTeam: String(away.team.abbreviation).toUpperCase(),
        homeScore: Number.isFinite(homeScore) ? homeScore : null,
        awayScore: Number.isFinite(awayScore) ? awayScore : null,
        isFinal,
        neutralSite: Boolean(competition?.neutralSite),
      });
    } catch {
      continue;
    }
  }
  return out;
}

/**
 * Buckets a sorted season of games into "weeks" purely for the existing
 * week-by-week UI pattern (NextStep/"this week's games" etc). NCAAF has
 * real ESPN week numbers in theory, but the per-team schedule endpoint
 * doesn't carry them reliably, so every sport uses the same 7-day bucket
 * from the season's first game — good enough for grouping, not meant to
 * match a league's own numbering exactly.
 */
function assignWeekBuckets(sortedGames: GenericGame[]): void {
  const first = sortedGames.find((g) => g.kickoffAt)?.kickoffAt;
  if (!first) return;
  const firstMs = first.getTime();
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  for (const g of sortedGames) {
    if (!g.kickoffAt) {
      g.week = 1;
      continue;
    }
    g.week = Math.max(1, Math.floor((g.kickoffAt.getTime() - firstMs) / msPerWeek) + 1);
  }
}

export interface BoxscorePlayerLine {
  team: string; // abbreviation, uppercased
  player: string;
  position: string | null;
  // Raw ESPN label -> value pairs, in whatever order/shape that sport's box
  // score uses (see db/schema.ts's sportPlayerGameStats comment for why
  // this stays a generic blob instead of typed columns). "group" is set
  // when ESPN splits a team's box score into named sections (MLB's
  // "batting" vs "pitching" being the main case) — null for sports with
  // just one stat table.
  stats: Record<string, string>;
}

/**
 * One game's full box score, every player who appeared, both teams. Hits
 * the same site API family as fetchTeams/fetchTeamSchedule, just the
 * summary endpoint instead of schedule — same "verify after the first live
 * sync" caveat as the rest of this file, and ESPN's own boxscore.players
 * shape (team -> statistics[] groups, each with parallel `labels` and
 * per-athlete `stats` arrays) is what's being assumed here.
 */
export async function fetchBoxscorePlayers(
  def: SportDef,
  espnEventId: string
): Promise<BoxscorePlayerLine[]> {
  const url = `${ESPN_BASE}/${def.espnSport}/${def.espnLeague}/summary?event=${espnEventId}`;
  const data = await fetchJson(url);
  const teamEntries: unknown[] = Array.isArray(data?.boxscore?.players) ? data.boxscore.players : [];
  const out: BoxscorePlayerLine[] = [];

  for (const teamEntry of teamEntries) {
    try {
      const t = teamEntry as any;
      const teamAbbr = t?.team?.abbreviation ? String(t.team.abbreviation).toUpperCase() : null;
      if (!teamAbbr) continue;

      const statGroups: unknown[] = Array.isArray(t?.statistics) ? t.statistics : [];
      for (const group of statGroups) {
        try {
          const g = group as any;
          const labels: string[] = Array.isArray(g?.labels) ? g.labels.map(String) : [];
          const groupName: string | null = g?.name ? String(g.name) : null;
          const athletes: unknown[] = Array.isArray(g?.athletes) ? g.athletes : [];

          for (const a of athletes) {
            try {
              const ath = a as any;
              const name = ath?.athlete?.displayName;
              if (!name) continue;
              const rawStats: unknown[] = Array.isArray(ath?.stats) ? ath.stats : [];
              const stats: Record<string, string> = {};
              if (groupName) stats.group = groupName;
              labels.forEach((label, i) => {
                if (rawStats[i] !== undefined && rawStats[i] !== null) stats[label] = String(rawStats[i]);
              });
              if (Object.keys(stats).length === 0) continue;
              out.push({
                team: teamAbbr,
                player: String(name),
                position: ath?.athlete?.position?.abbreviation ? String(ath.athlete.position.abbreviation) : null,
                stats,
              });
            } catch {
              continue;
            }
          }
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }
  }
  return out;
}

/**
 * The full season for a sport: fetch every team's schedule, merge, de-dupe
 * by espnEventId (each game appears twice — once per participant), sort
 * chronologically, then assign week buckets.
 */
export async function fetchFullSeasonSchedule(
  def: SportDef,
  teams: GenericTeam[],
  season: number
): Promise<GenericGame[]> {
  const byEventId = new Map<string, GenericGame>();

  // Regular season + postseason for every team, a few requests at a time
  // (gentle on ESPN, but fast enough for 130+ college teams).
  const jobs = teams.flatMap((team) => ([2, 3] as const).map((st) => ({ team, st })));
  let next = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < jobs.length) {
        const { team, st } = jobs[next++];
        try {
          const games = await fetchTeamSchedule(def, team.espnTeamId, season, st);
          for (const g of games) {
            if (!byEventId.has(g.espnEventId)) byEventId.set(g.espnEventId, g);
          }
        } catch {
          // One team's schedule failing (bad id, transient error) shouldn't
          // take down the whole sync — its games still show up via whichever
          // opponent's schedule fetch succeeds.
        }
      }
    })
  );

  const merged = Array.from(byEventId.values()).sort((a, b) => {
    const at = a.kickoffAt?.getTime() ?? 0;
    const bt = b.kickoffAt?.getTime() ?? 0;
    return at - bt;
  });
  assignWeekBuckets(merged);
  return merged;
}

export interface GenericInjury {
  // ESPN's own team abbreviation, when the response gives one directly.
  // Not every shape guess below is guaranteed to carry it, so teamName
  // below is the fallback — the sync stage resolves whichever is present
  // against the already-synced sportTeams table (same name-matching
  // precedent as lib/sports/odds.ts's event-to-schedule matching).
  teamAbbr: string | null;
  teamName: string | null;
  player: string;
  position: string | null;
  // Upper-cased, as ESPN reports it (e.g. "OUT", "DOUBTFUL", "DAY-TO-DAY",
  // "QUESTIONABLE", "IR") — see db/schema.ts's sportInjuryReports comment
  // on why this is kept as free text instead of forced into NFL's fixed
  // OUT/DOUBTFUL/QUESTIONABLE vocabulary.
  status: string;
  // Injury type/location/comment, combined into one display string when
  // present — purely informational, nothing downstream parses it.
  detail: string | null;
}

/**
 * League-wide injury report for one sport
 * (site.api.espn.com/.../{sport}/{league}/injuries) — same site-API family
 * as fetchTeams/fetchTeamSchedule above, not the separate paginated
 * sports.core.api.espn.com "core API". Response shape here is the least
 * well-documented of this file's endpoints (no raw example JSON was found
 * during research — see this file's top-of-file caveat): best-effort
 * guess is a team-grouped shape (`injuries: [{ team, injuries: [...] }]`),
 * with several fallback field names tried per injury entry since the exact
 * label ESPN uses for athlete name / status / injury detail couldn't be
 * confirmed from this sandbox (site.api.espn.com is blocked by this
 * sandbox's own egress proxy). Parsed fully defensively — one malformed
 * team/entry never kills the whole stage, and if this returns 0 rows
 * against live data, the field names below are the first thing to check
 * against the real response (same "verify after the first live sync"
 * caveat as the rest of this file).
 */
export async function fetchInjuries(def: SportDef): Promise<GenericInjury[]> {
  const url = `${ESPN_BASE}/${def.espnSport}/${def.espnLeague}/injuries`;
  const data = await fetchJson(url);
  const out: GenericInjury[] = [];

  const teamEntries: unknown[] = Array.isArray(data?.injuries) ? data.injuries : [];

  for (const teamEntry of teamEntries) {
    try {
      const t = teamEntry as any;
      const teamAbbr: string | null = t?.team?.abbreviation ?? t?.abbreviation ?? null;
      const teamName: string | null = t?.team?.displayName ?? t?.displayName ?? t?.team?.name ?? null;
      const items: unknown[] = Array.isArray(t?.injuries) ? t.injuries : [];

      for (const item of items) {
        try {
          const it = item as any;
          const name: string | undefined = it?.athlete?.displayName ?? it?.athleteName ?? it?.player?.displayName;
          if (!name) continue;

          const statusRaw: string | undefined = it?.status ?? it?.injuryStatus ?? it?.type?.description;
          if (!statusRaw) continue;

          const positionRaw: string | undefined =
            it?.athlete?.position?.abbreviation ?? it?.position?.abbreviation;

          const detailParts = [
            it?.details?.type ?? it?.injuryType,
            it?.details?.location ?? it?.injuryLocation,
            it?.details?.detail ?? it?.injuryDetail,
            it?.shortComment ?? it?.comment,
          ].filter((p) => typeof p === "string" && p.trim().length > 0);

          out.push({
            teamAbbr: teamAbbr ? String(teamAbbr).toUpperCase() : null,
            teamName: teamName ? String(teamName) : null,
            player: String(name),
            position: positionRaw ? String(positionRaw) : null,
            status: String(statusRaw).trim().toUpperCase(),
            detail: detailParts.length > 0 ? detailParts.map(String).join(" — ") : null,
          });
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }
  }
  return out;
}

export interface TeamBoxLine {
  team: string; // abbreviation, uppercased
  fgm: number;
  fga: number;
  fg3m: number;
  fg3a: number;
  ftm: number;
  fta: number;
  oreb: number;
  dreb: number;
  tov: number;
  fouls: number;
  offFouls: number; // counted from the play-by-play ("Offensive Foul" / "Offensive Charge")
  paintPts: number;
  midMade: number; // (FGM - 3PM) - paint points / 2
  fastBreakPts: number;
}

/**
 * Team box score, officiating crew and offensive-foul counts for one final
 * game, from ESPN's game summary (the same endpoint fetchBoxscorePlayers
 * uses). Basketball shape; other sports return whatever stats ESPN names
 * the same way and zeros for the rest.
 */
export async function fetchGameSummaryTeams(
  def: SportDef,
  espnEventId: string
): Promise<{ teams: TeamBoxLine[]; officials: string[] }> {
  const url = `${ESPN_BASE}/${def.espnSport}/${def.espnLeague}/summary?event=${espnEventId}`;
  const data = await fetchJson(url);
  const pair = (v: unknown) => String(v ?? "0-0").split("-").map((x) => Number(x) || 0);
  const n = (v: unknown) => Number(v) || 0;
  const idToAbbr = new Map<string, string>();
  const teams: TeamBoxLine[] = [];
  for (const t of (Array.isArray(data?.boxscore?.teams) ? data.boxscore.teams : []) as any[]) {
    const abbr = t?.team?.abbreviation ? String(t.team.abbreviation).toUpperCase() : null;
    if (!abbr) continue;
    if (t?.team?.id) idToAbbr.set(String(t.team.id), abbr);
    const s: Record<string, string> = {};
    for (const x of (Array.isArray(t?.statistics) ? t.statistics : []) as any[]) {
      if (x?.name) s[String(x.name)] = String(x.displayValue ?? "");
    }
    const [fgm, fga] = pair(s["fieldGoalsMade-fieldGoalsAttempted"]);
    const [fg3m, fg3a] = pair(s["threePointFieldGoalsMade-threePointFieldGoalsAttempted"]);
    const [ftm, fta] = pair(s["freeThrowsMade-freeThrowsAttempted"]);
    const paintPts = n(s.pointsInPaint);
    teams.push({
      team: abbr,
      fgm,
      fga,
      fg3m,
      fg3a,
      ftm,
      fta,
      oreb: n(s.offensiveRebounds),
      dreb: n(s.defensiveRebounds),
      tov: n(s.totalTurnovers || s.turnovers),
      fouls: n(s.fouls),
      offFouls: 0,
      paintPts,
      midMade: Math.max(0, fgm - fg3m - paintPts / 2),
      fastBreakPts: n(s.fastBreakPoints),
    });
  }
  for (const p of (Array.isArray(data?.plays) ? data.plays : []) as any[]) {
    const type = String(p?.type?.text ?? "");
    if (type !== "Offensive Foul" && type !== "Offensive Charge") continue;
    const abbr = idToAbbr.get(String(p?.team?.id ?? ""));
    const row = teams.find((x) => x.team === abbr);
    if (row) row.offFouls++;
  }
  const officials = ((Array.isArray(data?.gameInfo?.officials) ? data.gameInfo.officials : []) as any[])
    .map((o) => String(o?.fullName ?? o?.displayName ?? ""))
    .filter(Boolean);
  return { teams, officials };
}
