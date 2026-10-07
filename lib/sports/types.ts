// Shared types for the multi-sport pipeline (NBA/NHL/MLB/NCAAF/NCAAB) — see
// db/schema.ts's "Multi-sport tables" section for why this is a parallel,
// more generic pipeline rather than a reuse of the NFL-only tables.

export type SportKey = "nba" | "wnba" | "nhl" | "mlb" | "ncaaf" | "ncaab";

export interface SportDef {
  key: SportKey;
  label: string; // "NBA"
  // ESPN's own URL path segments: site.api.espn.com/apis/site/v2/sports/{espnSport}/{espnLeague}/...
  espnSport: string;
  espnLeague: string;
  // Real numbered weeks (NCAAF) vs. a synthetic ISO-week-of-season bucket
  // used only for UI grouping (NBA/NHL/MLB/NCAAB) — see weekBucketFor.
  hasRealWeeks: boolean;
}

export const SPORTS: Record<SportKey, SportDef> = {
  nba: { key: "nba", label: "NBA", espnSport: "basketball", espnLeague: "nba", hasRealWeeks: false },
  wnba: { key: "wnba", label: "WNBA", espnSport: "basketball", espnLeague: "wnba", hasRealWeeks: false },
  nhl: { key: "nhl", label: "NHL", espnSport: "hockey", espnLeague: "nhl", hasRealWeeks: false },
  mlb: { key: "mlb", label: "MLB", espnSport: "baseball", espnLeague: "mlb", hasRealWeeks: false },
  ncaaf: {
    key: "ncaaf",
    label: "College Football",
    espnSport: "football",
    espnLeague: "college-football",
    hasRealWeeks: true,
  },
  ncaab: {
    key: "ncaab",
    label: "College Basketball",
    espnSport: "basketball",
    espnLeague: "mens-college-basketball",
    hasRealWeeks: false,
  },
};

// One row per game, already mapped out of ESPN's shape — what everything
// downstream (Elo, sync, UI) actually works with. Satisfies lib/elo.ts's
// EloInputGame structurally, so replayElo() works unchanged on this type.
export interface GenericGame {
  sport: SportKey;
  espnEventId: string;
  season: number;
  week: number;
  gameDate: string | null; // YYYY-MM-DD
  kickoffAt: Date | null;
  homeTeam: string; // this sport's own abbreviation, as ESPN reports it
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  isFinal: boolean;
  neutralSite: boolean;
}

export interface GenericTeam {
  sport: SportKey;
  abbr: string;
  name: string;
  conference: string | null;
  division: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  espnTeamId: string;
}
