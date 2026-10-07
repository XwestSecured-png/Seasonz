import { parse } from "csv-parse/sync";
import { nyLocalToUtc } from "./time";

// nflverse publishes season data as plain CSVs on GitHub releases — the same
// source the original Google Sheet project used (injuries_{season}.csv,
// stats_player_week_{season}.csv, games.csv). No API key needed.
const NFLVERSE_BASE =
  "https://github.com/nflverse/nflverse-data/releases/download";

async function fetchCsv(url: string): Promise<Record<string, string>[]> {
  const res = await fetch(url, {
    headers: { "User-Agent": "seasonz (personal use)" },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  return parse(text, { columns: true, skip_empty_lines: true });
}

export interface ScheduleGame {
  season: number;
  week: number;
  gameDate: string | null;
  // Real kickoff instant (UTC), derived from nflverse's gameday+gametime
  // (both published as America/New_York local time — see lib/time.ts) —
  // null for the rare row missing a gametime (e.g. not yet scheduled).
  // Powers the 5-minutes-before-kickoff pick lock on Model Tracker.
  kickoffAt: Date | null;
  // Rain/snow chance (0-100) for the game — nflverse has no such column, so
  // this always starts null here and is only ever filled in afterward, in
  // lib/sync.ts's schedule stage, from an Open-Meteo forecast for an
  // upcoming outdoor game. Carried on this type (rather than computed
  // separately) so the weather adjustment downstream in the "elo" stage
  // sees the same merged value the database does.
  precipPct: number | null;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  isFinal: boolean;
  // Venue/conditions + officiating — nflverse's games.csv carries these for
  // every game back to 1999 already, no separate data source needed. roof/
  // surface/temp/wind are blank for dome/closed-roof games (no weather to
  // speak of indoors).
  roof: string | null; // "outdoors" | "dome" | "closed" | "open" | etc.
  surface: string | null;
  tempF: number | null;
  windMph: number | null;
  referee: string | null;
}

function mapScheduleRow(r: Record<string, string>): ScheduleGame {
  const homeScore = r.home_score ? Number(r.home_score) : null;
  const awayScore = r.away_score ? Number(r.away_score) : null;
  return {
    season: Number(r.season),
    week: Number(r.week),
    gameDate: r.gameday || null,
    kickoffAt: r.gameday && r.gametime ? nyLocalToUtc(r.gameday, r.gametime) : null,
    precipPct: null,
    homeTeam: r.home_team,
    awayTeam: r.away_team,
    homeScore,
    awayScore,
    isFinal: homeScore !== null && awayScore !== null,
    roof: r.roof || null,
    surface: r.surface || null,
    tempF: r.temp ? Number(r.temp) : null,
    windMph: r.wind ? Number(r.wind) : null,
    referee: r.referee || null,
  };
}

// The "schedules" release is a single all-seasons file (games.csv), not one
// file per season — there's no sched_{season}.csv asset. Fetch once and
// filter client-side.
async function fetchAllGames(): Promise<Record<string, string>[]> {
  return fetchCsv(`${NFLVERSE_BASE}/schedules/games.csv`);
}

/** Full season schedule, including future (unplayed) games. */
export async function fetchSchedule(season: number): Promise<ScheduleGame[]> {
  const rows = await fetchAllGames();
  return rows
    .filter((r) => Number(r.season) === season && r.game_type === "REG")
    .map(mapScheduleRow);
}

/**
 * Every regular-season game nflverse has on record, every season — used to
 * build a referee's historical home-win-rate tendency (see lib/referee.ts),
 * which needs a much bigger sample than just the current season.
 */
export async function fetchAllRegSeasonGames(): Promise<ScheduleGame[]> {
  const rows = await fetchAllGames();
  return rows.filter((r) => r.game_type === "REG").map(mapScheduleRow);
}

export type InjuryStatus = "Out" | "Doubtful" | "Questionable";

export interface InjuryRow {
  season: number;
  week: number;
  team: string;
  player: string;
  position: string;
  status: InjuryStatus;
  isEstimate: boolean; // true when the official designation isn't out yet and
  // practice participation was used as an early estimate instead
}

const OFFICIAL_STATUS_MAP: Record<string, InjuryStatus> = {
  Out: "Out",
  Doubtful: "Doubtful",
  Questionable: "Questionable",
};

/** This week's injury designations, with a practice-status fallback when the official tag isn't published yet. */
export async function fetchInjuries(season: number): Promise<InjuryRow[]> {
  const allRows = await fetchCsv(`${NFLVERSE_BASE}/injuries/injuries_${season}.csv`);
  const regRows = allRows.filter((r) => r.season_type === "REG" || r.game_type === "REG");
  const out: InjuryRow[] = [];

  // injuries_{season}.csv accumulates one row per player per week across
  // the whole season so far — "this week's" report is just the rows at the
  // highest week number currently present (the file's own schema has no
  // separate report-date column to dedupe by).
  const currentWeek = Math.max(0, ...regRows.map((r) => Number(r.week) || 0));
  const thisWeekRows = regRows.filter((r) => Number(r.week) === currentWeek);

  for (const r of thisWeekRows) {
    const official = r.report_status ? OFFICIAL_STATUS_MAP[r.report_status] : undefined;
    let status = official;
    let isEstimate = false;

    if (!status) {
      // No official designation yet — fall back to practice participation
      // as an early, unofficial estimate (matches the original Sheet logic).
      const practice = (r.practice_status || "").toLowerCase();
      if (practice.includes("did not participate")) {
        status = "Questionable";
        isEstimate = true;
      } else if (practice.includes("limited")) {
        status = "Questionable";
        isEstimate = true;
      } else {
        continue; // full participation / no concern — not injury-report-worthy
      }
    }

    out.push({
      season,
      week: Number(r.week),
      team: r.team,
      player: r.full_name,
      position: r.position || "",
      status,
      isEstimate,
    });
  }

  return out;
}

export interface PlayerWeekStats {
  season: number;
  week: number;
  team: string;
  player: string;
  position: string;
  epa: number; // this player's total EPA contribution that week
  // Raw per-game counting stats — used for player prop projections
  // (season-average yards/receptions), not just the EPA-share estimate.
  passYds: number;
  rushYds: number;
  recYds: number;
  receptions: number;
  // Touchdowns scored BY this player (rushing + receiving only — not
  // passing, since "anytime TD scorer" props are about the player crossing
  // the goal line themselves). Used for the Anytime TD / 2+ TDs projections
  // in lib/props-model.ts.
  rushingTds: number;
  receivingTds: number;
  // Negative/turnover events, for the INT Thrown / Fumble Lost / QB Sacked
  // player props (also in lib/props-model.ts). sacksTaken and
  // interceptionsThrown are only ever nonzero for QBs; fumblesLost sums all
  // three fumble-lost columns (rushing/receiving/sack) so it applies to any
  // skill position, QB included.
  sacksTaken: number;
  interceptionsThrown: number;
  fumblesLost: number;
}

/** Weekly player-level EPA + raw counting stats, used for the EPA-share injury estimate and for prop projections. */
export async function fetchPlayerWeekStats(season: number): Promise<PlayerWeekStats[]> {
  const rows = await fetchCsv(
    `${NFLVERSE_BASE}/stats_player/stats_player_week_${season}.csv`
  );
  return rows
    .filter(
      (r) =>
        ["QB", "RB", "WR", "TE"].includes(r.position) &&
        (r.season_type === "REG" || r.season_type === undefined)
    )
    .map((r) => ({
      season,
      week: Number(r.week),
      team: r.team || r.recent_team,
      player: r.player_display_name || r.player_name,
      position: r.position,
      // nflverse's player_stats CSV doesn't publish a single "total EPA"
      // column directly — approximate with passing + rushing + receiving EPA,
      // falling back to 0 for columns that don't apply to this position.
      epa:
        Number(r.passing_epa || 0) +
        Number(r.rushing_epa || 0) +
        Number(r.receiving_epa || 0),
      passYds: Number(r.passing_yards || 0),
      rushYds: Number(r.rushing_yards || 0),
      recYds: Number(r.receiving_yards || 0),
      receptions: Number(r.receptions || 0),
      rushingTds: Number(r.rushing_tds || 0),
      receivingTds: Number(r.receiving_tds || 0),
      sacksTaken: Number(r.sacks_suffered || 0),
      interceptionsThrown: Number(r.passing_interceptions || 0),
      fumblesLost:
        Number(r.rushing_fumbles_lost || 0) +
        Number(r.receiving_fumbles_lost || 0) +
        Number(r.sack_fumbles_lost || 0),
    }));
}

// Every non-offense, non-specialist position nflverse's player-stats CSV
// uses — covers the full defensive front seven and secondary. Specialists
// (K/P/LS) and offensive linemen (C/G/OL/OT) are excluded since they don't
// record sacks or interceptions.
const DEFENSIVE_POSITIONS = [
  "CB",
  "DB",
  "DE",
  "DL",
  "DT",
  "FS",
  "ILB",
  "LB",
  "MLB",
  "NT",
  "OLB",
  "S",
  "SAF",
];

export interface DefensivePlayerWeekStats {
  season: number;
  week: number;
  team: string;
  player: string;
  position: string;
  sacks: number;
  interceptions: number;
}

/** Weekly defensive-player counting stats (sacks, interceptions) — used for the Anytime Sack / Anytime INT player props in lib/props-model.ts. */
export async function fetchDefPlayerWeekStats(season: number): Promise<DefensivePlayerWeekStats[]> {
  const rows = await fetchCsv(
    `${NFLVERSE_BASE}/stats_player/stats_player_week_${season}.csv`
  );
  return rows
    .filter(
      (r) =>
        DEFENSIVE_POSITIONS.includes(r.position) &&
        (r.season_type === "REG" || r.season_type === undefined)
    )
    .map((r) => ({
      season,
      week: Number(r.week),
      team: r.team || r.recent_team,
      player: r.player_display_name || r.player_name,
      position: r.position,
      sacks: Number(r.def_sacks || 0),
      interceptions: Number(r.def_interceptions || 0),
    }));
}

export interface TeamWeekStats {
  season: number;
  week: number;
  team: string;
  opponentTeam: string;
  offEpa: number; // this team's own offensive output that week (passing+rushing+receiving EPA)
  giveaways: number; // interceptions thrown + fumbles lost
  takeaways: number; // interceptions + opponent fumbles recovered
  penalties: number;
  sacksAllowed: number; // O-line proxy — sacks their own QB took
  pressuresGenerated: number; // D-line proxy — sacks + QB hits produced
  twoPtConversions: number; // aggressiveness proxy — made, not attempted (see lib/team-factors.ts)
}

/** Team-level weekly stats (one row per team per game) — turnovers, penalties, trenches, and offensive output, all from nflverse's team-week release. */
export async function fetchTeamWeekStats(season: number): Promise<TeamWeekStats[]> {
  const rows = await fetchCsv(`${NFLVERSE_BASE}/stats_team/stats_team_week_${season}.csv`);
  return rows
    .filter((r) => Number(r.season) === season && (r.season_type === "REG" || r.season_type === undefined))
    .map((r) => ({
      season,
      week: Number(r.week),
      team: r.team,
      opponentTeam: r.opponent_team,
      offEpa: Number(r.passing_epa || 0) + Number(r.rushing_epa || 0) + Number(r.receiving_epa || 0),
      giveaways: Number(r.passing_interceptions || 0) + Number(r.fumbles_lost_total || 0),
      takeaways: Number(r.def_interceptions || 0) + Number(r.fumble_recovery_opp || 0),
      penalties: Number(r.penalties || 0),
      sacksAllowed: Number(r.sacks_suffered || 0),
      pressuresGenerated: Number(r.def_sacks || 0) + Number(r.def_qb_hits || 0),
      // passing_2pt_conversions + rushing_2pt_conversions only — a passing
      // 2pt conversion is also credited to the receiver
      // (receiving_2pt_conversions), so adding that in would double-count it.
      twoPtConversions: Number(r.passing_2pt_conversions || 0) + Number(r.rushing_2pt_conversions || 0),
    }));
}
