// Static home-stadium coordinates + roof type for every team, keyed by the
// same team codes as lib/team-colors.ts. This barely ever changes (a team
// relocating stadiums is a once-a-decade event), so it's a plain hardcoded
// table rather than something fetched — same philosophy as this app's other
// small reference tables.
//
// `indoor` marks a fixed dome OR a stadium whose roof is closed for the
// large majority of games (retractable roofs are almost always closed in
// bad weather, which is exactly when it would matter) — used to skip the
// weather-forecast fetch entirely for these venues. nflverse's own
// game-by-game `roof` field (once known) is still the authority on any
// individual game; this table is only a quick, free pre-filter for which
// teams are even worth fetching a forecast for.
export interface StadiumCoord {
  lat: number;
  lon: number;
  indoor: boolean;
}

export const STADIUM_COORDS: Record<string, StadiumCoord> = {
  ARI: { lat: 33.5276, lon: -112.2626, indoor: true }, // State Farm Stadium (retractable, closed most games)
  ATL: { lat: 33.7554, lon: -84.4008, indoor: true }, // Mercedes-Benz Stadium (dome)
  BAL: { lat: 39.278, lon: -76.6227, indoor: false }, // M&T Bank Stadium
  BUF: { lat: 42.7738, lon: -78.787, indoor: false }, // Highmark Stadium
  CAR: { lat: 35.2258, lon: -80.8528, indoor: false }, // Bank of America Stadium
  CHI: { lat: 41.8623, lon: -87.6167, indoor: false }, // Soldier Field
  CIN: { lat: 39.0954, lon: -84.516, indoor: false }, // Paycor Stadium
  CLE: { lat: 41.5061, lon: -81.6995, indoor: false }, // Huntington Bank Field
  DAL: { lat: 32.7473, lon: -97.0945, indoor: true }, // AT&T Stadium (retractable, usually closed)
  DEN: { lat: 39.7439, lon: -105.0201, indoor: false }, // Empower Field at Mile High
  DET: { lat: 42.34, lon: -83.0456, indoor: true }, // Ford Field (dome)
  GB: { lat: 44.5013, lon: -88.0622, indoor: false }, // Lambeau Field
  HOU: { lat: 29.6847, lon: -95.4107, indoor: true }, // NRG Stadium (retractable, usually closed)
  IND: { lat: 39.7601, lon: -86.1639, indoor: true }, // Lucas Oil Stadium (retractable, usually closed)
  JAX: { lat: 30.3239, lon: -81.6373, indoor: false }, // EverBank Stadium
  KC: { lat: 39.0489, lon: -94.4839, indoor: false }, // GEHA Field at Arrowhead Stadium
  LV: { lat: 36.0909, lon: -115.1833, indoor: true }, // Allegiant Stadium (dome)
  LAC: { lat: 33.9535, lon: -118.3392, indoor: true }, // SoFi Stadium (fixed roof)
  LA: { lat: 33.9535, lon: -118.3392, indoor: true }, // SoFi Stadium (fixed roof)
  MIA: { lat: 25.958, lon: -80.2389, indoor: false }, // Hard Rock Stadium (canopy over seats, field is open)
  MIN: { lat: 44.9735, lon: -93.2575, indoor: true }, // U.S. Bank Stadium (dome)
  NE: { lat: 42.0909, lon: -71.2643, indoor: false }, // Gillette Stadium
  NO: { lat: 29.9511, lon: -90.0812, indoor: true }, // Caesars Superdome (dome)
  NYG: { lat: 40.8135, lon: -74.0744, indoor: false }, // MetLife Stadium
  NYJ: { lat: 40.8135, lon: -74.0744, indoor: false }, // MetLife Stadium
  PHI: { lat: 39.9008, lon: -75.1675, indoor: false }, // Lincoln Financial Field
  PIT: { lat: 40.4468, lon: -80.0158, indoor: false }, // Acrisure Stadium
  SF: { lat: 37.403, lon: -121.97, indoor: false }, // Levi's Stadium
  SEA: { lat: 47.5952, lon: -122.3316, indoor: false }, // Lumen Field (open-air, partial canopy over seats)
  TB: { lat: 27.9759, lon: -82.5033, indoor: false }, // Raymond James Stadium
  TEN: { lat: 36.1665, lon: -86.7713, indoor: false }, // Nissan Stadium
  WAS: { lat: 38.9076, lon: -76.8645, indoor: false }, // Northwest Stadium
};
