// ESPN's analyst metrics — Football Power Index (FPI) and Total QBR.
//
// IMPORTANT CAVEAT: unlike nflverse (a published GitHub release) or The Odds
// API (a documented, versioned product), ESPN does not publish these as a
// supported public API. This talks to the same undocumented endpoints
// ESPN's own site/app use internally. That means: no key, no SLA, no
// guarantee the response shape below stays correct, and it can be rate
// limited or change without notice. This sandbox's own egress proxy blocks
// `site.api.espn.com` and `site.web.api.espn.com` outright ("organization
// policy"), so none of this could be test-fetched against live data before
// shipping — it's built from best-recollection of the public shape and
// parsed defensively (every per-team/per-athlete extraction is wrapped so
// one unexpected field never kills the whole sync stage). The first real
// sync run on Vercel (which has normal outbound access) will tell us if the
// shape guess was right — check the "espn" row in Sync Runs; if it shows
// 0 teams matched, the field names below need adjusting against the real
// response.
const FPI_URL = "https://site.api.espn.com/apis/v2/sports/football/nfl/powerindex";
const QBR_URL_BASE =
  "https://site.web.api.espn.com/apis/fitt/v3/sports/football/nfl/qbr/seasontypes/2/weeks";

// ESPN's team abbreviations differ from ours in exactly two spots.
const ESPN_ABBR_TO_CODE: Record<string, string> = {
  WSH: "WAS",
  LAR: "LA",
};

function toOurCode(espnAbbr: string | undefined | null): string | null {
  if (!espnAbbr) return null;
  const upper = espnAbbr.toUpperCase();
  return ESPN_ABBR_TO_CODE[upper] ?? upper;
}

export interface TeamFpi {
  fpi: number;
  sos: number | null; // strength of schedule — stored for context, not weighted (see lib/espn-factors.ts)
}

/**
 * ESPN's Football Power Index per team for the season, plus their
 * strength-of-schedule number. Returns an empty map (never throws past this
 * point) if the response shape doesn't match what we expect — the sync
 * stage treats that as "ESPN unavailable this run," same as a network
 * failure.
 */
export async function fetchTeamFpi(season: number): Promise<Map<string, TeamFpi>> {
  const url = `${FPI_URL}?season=${season}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`ESPN FPI fetch failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();

  const out = new Map<string, TeamFpi>();
  const teamEntries: unknown[] = Array.isArray(data?.teams) ? data.teams : [];

  for (const entry of teamEntries) {
    try {
      const abbr = (entry as any)?.team?.abbreviation as string | undefined;
      const code = toOurCode(abbr);
      if (!code) continue;

      const stats: unknown[] = Array.isArray((entry as any)?.stats) ? (entry as any).stats : [];
      let fpiValue: number | null = null;
      let sosValue: number | null = null;
      for (const s of stats) {
        const name = String((s as any)?.name ?? "").toLowerCase();
        const value = Number((s as any)?.value);
        if (!Number.isFinite(value)) continue;
        if (name === "fpi") fpiValue = value;
        else if (name.includes("strengthofschedule") || name === "sos") sosValue = value;
      }
      if (fpiValue === null) continue;
      out.set(code, { fpi: fpiValue, sos: sosValue });
    } catch {
      // One malformed team entry shouldn't take down the rest.
      continue;
    }
  }
  return out;
}

/**
 * ESPN's Total QBR, best value among each team's quarterbacks for a given
 * week (a reasonable stand-in for "the starter" without needing a separate
 * depth-chart lookup). Returns an empty map on any shape mismatch.
 */
export async function fetchTeamQbr(season: number, week: number): Promise<Map<string, number>> {
  const url = `${QBR_URL_BASE}/${week}?region=us&lang=en&season=${season}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`ESPN QBR fetch failed: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();

  const best = new Map<string, number>();
  const athletes: unknown[] = Array.isArray(data?.athletes) ? data.athletes : [];

  for (const entry of athletes) {
    try {
      const abbr = (entry as any)?.athlete?.team?.abbreviation as string | undefined;
      const code = toOurCode(abbr);
      if (!code) continue;

      const categories: unknown[] = Array.isArray((entry as any)?.splits?.categories)
        ? (entry as any).splits.categories
        : [];
      let qbrValue: number | null = null;
      for (const cat of categories) {
        const labels: unknown[] = Array.isArray((cat as any)?.labels) ? (cat as any).labels : [];
        const totals: unknown[] = Array.isArray((cat as any)?.totals) ? (cat as any).totals : [];
        const idx = labels.findIndex((l) => String(l).toUpperCase() === "QBR");
        if (idx >= 0 && totals[idx] !== undefined) {
          const parsed = Number(totals[idx]);
          if (Number.isFinite(parsed)) qbrValue = parsed;
          break;
        }
      }
      if (qbrValue === null) continue;

      const existing = best.get(code);
      if (existing === undefined || qbrValue > existing) best.set(code, qbrValue);
    } catch {
      continue;
    }
  }
  return best;
}
