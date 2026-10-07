// Weather adjustment to the model's win probability — a small, documented
// nudge, same philosophy as the Elo constants in lib/elo.ts (public,
// reasonable defaults, not a precise re-derivation of anything). Indoor
// games (dome/closed roof) get zero adjustment: there's no weather to speak
// of under a roof, regardless of what nflverse's temp/wind columns say for
// that stadium.
const WIND_MIN_MPH = 15; // below this, treat wind as a non-factor
const WIND_SEVERE_MPH = 25; // at/above this, wind is at "full severity"
const COLD_MIN_F = 32; // above this, treat cold as a non-factor
const COLD_SEVERE_F = 10; // at/below this, cold is at "full severity"
// Rain/snow chance (%) — only ever populated for upcoming games via the
// Open-Meteo forecast (lib/weather-forecast.ts); nflverse's post-game
// actuals have no precipitation field, so this stays null for final games,
// same null-safe convention as everything else here.
const PRECIP_MIN_PCT = 30; // below this, treat precip chance as a non-factor
const PRECIP_SEVERE_PCT = 80; // at/above this, precip is at "full severity"

// The whole point is that this stays small — weather nudges a close game,
// it doesn't flip a blowout.
const MAX_SWING_PCT = 0.03;
// How big a pass-share gap between the two offenses counts as "the full
// swing" — teams rarely differ by more than this in practice.
const REFERENCE_PASS_SHARE_GAP = 0.2;

function severity(value: number, min: number, severe: number): number {
  const span = severe - min; // severe can be below min (cold) or above (wind) — both work with this formula
  const t = (value - min) / span;
  return Math.max(0, Math.min(1, t));
}

export interface WeatherAdjustment {
  severity: number; // 0..1, how rough the conditions are (0 = no effect)
  adjPct: number; // signed, home-perspective win% shift
}

const INDOOR_ROOFS = new Set(["dome", "closed"]);

/**
 * Nudges home win% toward whichever team is less pass-reliant, scaled by how
 * bad the wind/cold/rain-or-snow chance is. Only applies to outdoor games
 * with at least one real reading.
 */
export function computeWeatherAdjustment(
  roof: string | null,
  tempF: number | null,
  windMph: number | null,
  passShareHome: number,
  passShareAway: number,
  precipPct: number | null = null
): WeatherAdjustment {
  if (roof && INDOOR_ROOFS.has(roof)) return { severity: 0, adjPct: 0 };

  const windSeverity = windMph !== null ? severity(windMph, WIND_MIN_MPH, WIND_SEVERE_MPH) : 0;
  const coldSeverity = tempF !== null ? severity(tempF, COLD_MIN_F, COLD_SEVERE_F) : 0;
  const precipSeverity = precipPct !== null ? severity(precipPct, PRECIP_MIN_PCT, PRECIP_SEVERE_PCT) : 0;
  const combinedSeverity = Math.max(windSeverity, coldSeverity, precipSeverity);
  if (combinedSeverity === 0) return { severity: 0, adjPct: 0 };

  const passShareGap = passShareHome - passShareAway; // positive => home is more pass-reliant
  const normalizedGap = Math.max(
    -1,
    Math.min(1, passShareGap / REFERENCE_PASS_SHARE_GAP)
  );

  // Bad weather hurts the more pass-reliant team, so its win% moves down —
  // if that's the home team, this is negative.
  const adjPct = -combinedSeverity * MAX_SWING_PCT * normalizedGap;
  return { severity: combinedSeverity, adjPct };
}
