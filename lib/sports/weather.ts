/* eslint-disable @typescript-eslint/no-explicit-any */
// Game-time weather for outdoor MLB and college football games, from
// Open-Meteo (free, no key): the venue's city is geocoded once, then the
// hourly forecast is read at first pitch / kickoff.
export interface GameWeather {
  tempF: number;
  windMph: number;
  precipPct: number | null; // chance of precipitation that hour
  fetchedAt: string;
}

const geoCache = new Map<string, { lat: number; lon: number } | null>();

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  return res.json();
}

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

export async function geocodeCity(city: string, state: string | null): Promise<{ lat: number; lon: number } | null> {
  const key = `${city}|${state ?? ""}`.toLowerCase();
  if (geoCache.has(key)) return geoCache.get(key)!;
  let hit: { lat: number; lon: number } | null = null;
  try {
    const data = await getJson(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=10&language=en&format=json`
    );
    const results: any[] = Array.isArray(data?.results) ? data.results : [];
    const st = state ? (STATE_NAMES[state.toUpperCase()] ?? state).toLowerCase() : null;
    const r =
      results.find((x) => st && String(x.admin1 ?? "").toLowerCase() === st) ??
      results.find((x) => x.country_code === "US") ??
      results.find((x) => x.country_code === "CA") ??
      results[0];
    if (r) hit = { lat: Number(r.latitude), lon: Number(r.longitude) };
  } catch {
    hit = null;
  }
  geoCache.set(key, hit);
  return hit;
}

/** Forecast at the given start time (up to ~7 days out). */
export async function forecastAt(lat: number, lon: number, at: Date): Promise<GameWeather | null> {
  const data = await getJson(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,wind_speed_10m,precipitation_probability&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=UTC&forecast_days=8`
  );
  const times: string[] = data?.hourly?.time ?? [];
  const hour = at.toISOString().slice(0, 13); // "2026-10-10T23"
  const i = times.findIndex((t) => t.startsWith(hour));
  if (i < 0) return null;
  return {
    tempF: Math.round(Number(data.hourly.temperature_2m[i])),
    windMph: Math.round(Number(data.hourly.wind_speed_10m[i])),
    precipPct: data.hourly.precipitation_probability?.[i] ?? null,
    fetchedAt: new Date().toISOString(),
  };
}

export function describeWeather(w: GameWeather): string {
  const parts = [`${w.tempF}°F`, `wind ${w.windMph} mph`];
  if (w.precipPct != null) parts.push(`${w.precipPct}% chance of rain`);
  return parts.join(", ");
}
