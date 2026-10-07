// Short rest + travel distance — two well-documented scheduling effects
// that nothing in the model accounted for before: a team on a short week
// (classically, Thursday Night Football off a Sunday game) plays at a real
// disadvantage, and a team that had to fly further to get to the game
// carries some fatigue into it. Same philosophy as lib/weather.ts and
// lib/referee.ts — a small, capped, documented nudge, not a precise
// re-derivation of anything.
import type { ScheduleGame } from "./nflverse";
import { STADIUM_COORDS } from "./stadium-coords";

const MAX_REST_DIFF_DAYS = 4; // beyond this, more rest-day gap doesn't count for more
const MAX_REST_SWING_PCT = 0.02;

const REFERENCE_TRAVEL_MILES = 2000; // roughly coast-to-coast — "the full swing"
const MAX_TRAVEL_SWING_PCT = 0.015;

const CAP_TOTAL_PCT = 0.03; // overall ceiling across both combined

// A rest gap bigger than this isn't a bye week, it's the start of a new
// season (or a team's first game ever) — not a meaningful signal either way.
const MAX_PLAUSIBLE_REST_DAYS = 21;

export interface RestTravelAdjustment {
  homeRestDays: number | null;
  awayRestDays: number | null;
  awayTravelMiles: number | null;
  adjPct: number; // signed, home-perspective, capped
}

const ZERO: RestTravelAdjustment = {
  homeRestDays: null,
  awayRestDays: null,
  awayTravelMiles: null,
  adjPct: 0,
};

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8; // Earth radius, miles
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * One pass over the full season schedule (in actual kickoff order, not just
 * week number, since multiple games share a week), tracking each team's
 * previous kickoff to compute days of rest, plus the away team's travel
 * distance from its own home city to this game's site. Returns a lookup by
 * the same "season|week|home|away" key every other per-game adjustment
 * uses.
 */
export function computeRestTravelAdjustments(
  schedule: ScheduleGame[]
): Map<string, RestTravelAdjustment> {
  const out = new Map<string, RestTravelAdjustment>();
  const lastKickoffByTeam = new Map<string, Date>();

  const sorted = schedule
    .filter((g): g is ScheduleGame & { kickoffAt: Date } => g.kickoffAt !== null)
    .sort((a, b) => a.kickoffAt.getTime() - b.kickoffAt.getTime());

  for (const g of sorted) {
    const key = `${g.season}|${g.week}|${g.homeTeam}|${g.awayTeam}`;

    const dayMs = 24 * 60 * 60 * 1000;
    const rawHomeRest = lastKickoffByTeam.has(g.homeTeam)
      ? Math.round((g.kickoffAt.getTime() - lastKickoffByTeam.get(g.homeTeam)!.getTime()) / dayMs)
      : null;
    const rawAwayRest = lastKickoffByTeam.has(g.awayTeam)
      ? Math.round((g.kickoffAt.getTime() - lastKickoffByTeam.get(g.awayTeam)!.getTime()) / dayMs)
      : null;
    const homeRestDays = rawHomeRest !== null && rawHomeRest <= MAX_PLAUSIBLE_REST_DAYS ? rawHomeRest : null;
    const awayRestDays = rawAwayRest !== null && rawAwayRest <= MAX_PLAUSIBLE_REST_DAYS ? rawAwayRest : null;

    let adjPct = 0;
    if (homeRestDays !== null && awayRestDays !== null) {
      const diff = awayRestDays - homeRestDays; // positive => away had more rest
      const normalized = Math.max(-1, Math.min(1, diff / MAX_REST_DIFF_DAYS));
      adjPct += normalized * MAX_REST_SWING_PCT;
    }

    let awayTravelMiles: number | null = null;
    const homeCoord = STADIUM_COORDS[g.homeTeam];
    const awayCoord = STADIUM_COORDS[g.awayTeam];
    if (homeCoord && awayCoord) {
      awayTravelMiles = Math.round(
        haversineMiles(homeCoord.lat, homeCoord.lon, awayCoord.lat, awayCoord.lon)
      );
      // Always favors the home team — the away team is the one who traveled.
      const travelSeverity = Math.max(0, Math.min(1, awayTravelMiles / REFERENCE_TRAVEL_MILES));
      adjPct += travelSeverity * MAX_TRAVEL_SWING_PCT;
    }

    adjPct = Math.max(-CAP_TOTAL_PCT, Math.min(CAP_TOTAL_PCT, adjPct));
    out.set(key, { homeRestDays, awayRestDays, awayTravelMiles, adjPct });

    lastKickoffByTeam.set(g.homeTeam, g.kickoffAt);
    lastKickoffByTeam.set(g.awayTeam, g.kickoffAt);
  }

  return out;
}

export { ZERO as ZERO_REST_TRAVEL_ADJUSTMENT };
