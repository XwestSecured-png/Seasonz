// Pre-game weather forecast, via Open-Meteo (https://open-meteo.com) — free,
// no API key, no signup, plain HTTP GET. This exists to close a real gap:
// nflverse's games.csv tempF/windMph columns are the ACTUAL conditions,
// recorded only once a game has been played — so lib/weather.ts's
// adjustment was always a no-op for upcoming games, the only games anyone
// actually wants a pick for. This gives those games a real forecast instead.
//
// Open-Meteo's hourly forecast only reaches about 16 days out, so a game
// further away than that simply gets no forecast yet (same fail-open
// convention as the rest of this app's optional data — null, not an error,
// and the sync just tries again on a later run once the game is in range).

const FORECAST_BASE = "https://api.open-meteo.com/v1/forecast";

interface OpenMeteoHourlyResponse {
  hourly?: {
    time: string[];
    temperature_2m: (number | null)[];
    wind_speed_10m: (number | null)[];
    precipitation_probability: (number | null)[];
  };
}

export interface ForecastWeather {
  tempF: number;
  windMph: number;
  precipPct: number; // chance of rain/snow, 0-100
}

/**
 * Forecast temp (F) + sustained wind speed (mph) for the hour nearest
 * kickoff, at the given lat/lon. Returns null when the game is outside
 * Open-Meteo's forecast window, or if the request fails for any reason —
 * weather is a small nudge, not something worth failing a sync run over.
 */
export async function fetchWeatherForecast(
  lat: number,
  lon: number,
  kickoffAt: Date
): Promise<ForecastWeather | null> {
  const dateStr = kickoffAt.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)

  const url =
    `${FORECAST_BASE}?latitude=${lat}&longitude=${lon}` +
    `&hourly=temperature_2m,wind_speed_10m,precipitation_probability` +
    `&temperature_unit=fahrenheit&wind_speed_unit=mph` +
    `&timezone=UTC&start_date=${dateStr}&end_date=${dateStr}`;

  let data: OpenMeteoHourlyResponse;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "seasonz (personal use)" } });
    if (!res.ok) return null;
    data = await res.json();
  } catch {
    return null;
  }

  const times = data.hourly?.time;
  const temps = data.hourly?.temperature_2m;
  const winds = data.hourly?.wind_speed_10m;
  const precips = data.hourly?.precipitation_probability;
  if (!times || !temps || !winds || times.length === 0) return null;

  // Open-Meteo's hourly `time` values are plain "YYYY-MM-DDTHH:mm" with no
  // offset, already in the `timezone=UTC` we asked for above — comparable
  // directly against kickoffAt's own UTC hour.
  const kickoffHourIso = kickoffAt.toISOString().slice(0, 13); // "YYYY-MM-DDTHH"
  let idx = times.findIndex((t) => t.startsWith(kickoffHourIso));
  if (idx === -1) {
    // Kickoff hour fell between/outside the hourly rows for some reason —
    // fall back to the closest available hour rather than giving up.
    idx = 0;
    let bestDiff = Infinity;
    const kickoffMs = kickoffAt.getTime();
    times.forEach((t, i) => {
      const diff = Math.abs(new Date(`${t}:00Z`).getTime() - kickoffMs);
      if (diff < bestDiff) {
        bestDiff = diff;
        idx = i;
      }
    });
  }

  const tempF = temps[idx];
  const windMph = winds[idx];
  if (tempF === null || tempF === undefined || windMph === null || windMph === undefined) return null;

  const precipRaw = precips?.[idx];
  const precipPct = precipRaw === null || precipRaw === undefined ? 0 : Math.round(precipRaw);

  return { tempF: Math.round(tempF), windMph: Math.round(windMph), precipPct };
}
