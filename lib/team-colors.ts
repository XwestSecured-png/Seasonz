// Public NFL team brand colors (primary/secondary), used only as accent
// colors in the UI — no logos or marks are reproduced anywhere.
export interface Team {
  code: string;
  name: string;
  primary: string;
  secondary: string;
}

export const TEAMS: Team[] = [
  { code: "ARI", name: "Arizona Cardinals", primary: "#97233F", secondary: "#000000" },
  { code: "ATL", name: "Atlanta Falcons", primary: "#A71930", secondary: "#000000" },
  { code: "BAL", name: "Baltimore Ravens", primary: "#241773", secondary: "#000000" },
  { code: "BUF", name: "Buffalo Bills", primary: "#00338D", secondary: "#C60C30" },
  { code: "CAR", name: "Carolina Panthers", primary: "#0085CA", secondary: "#101820" },
  { code: "CHI", name: "Chicago Bears", primary: "#0B162A", secondary: "#C83803" },
  { code: "CIN", name: "Cincinnati Bengals", primary: "#FB4F14", secondary: "#000000" },
  { code: "CLE", name: "Cleveland Browns", primary: "#311D00", secondary: "#FF3C00" },
  { code: "DAL", name: "Dallas Cowboys", primary: "#041E42", secondary: "#869397" },
  { code: "DEN", name: "Denver Broncos", primary: "#FB4F14", secondary: "#002244" },
  { code: "DET", name: "Detroit Lions", primary: "#0076B6", secondary: "#B0B7BC" },
  { code: "GB", name: "Green Bay Packers", primary: "#203731", secondary: "#FFB612" },
  { code: "HOU", name: "Houston Texans", primary: "#03202F", secondary: "#A71930" },
  { code: "IND", name: "Indianapolis Colts", primary: "#002C5F", secondary: "#A2AAAD" },
  { code: "JAX", name: "Jacksonville Jaguars", primary: "#101820", secondary: "#D7A22A" },
  { code: "KC", name: "Kansas City Chiefs", primary: "#E31837", secondary: "#FFB81C" },
  { code: "LV", name: "Las Vegas Raiders", primary: "#000000", secondary: "#A5ACAF" },
  { code: "LAC", name: "Los Angeles Chargers", primary: "#0080C6", secondary: "#FFC20E" },
  { code: "LA", name: "Los Angeles Rams", primary: "#003594", secondary: "#FFA300" },
  { code: "MIA", name: "Miami Dolphins", primary: "#008E97", secondary: "#FC4C02" },
  { code: "MIN", name: "Minnesota Vikings", primary: "#4F2683", secondary: "#FFC62F" },
  { code: "NE", name: "New England Patriots", primary: "#002244", secondary: "#C60C30" },
  { code: "NO", name: "New Orleans Saints", primary: "#D3BC8D", secondary: "#101820" },
  { code: "NYG", name: "New York Giants", primary: "#0B2265", secondary: "#A71930" },
  { code: "NYJ", name: "New York Jets", primary: "#125740", secondary: "#000000" },
  { code: "PHI", name: "Philadelphia Eagles", primary: "#004C54", secondary: "#A5ACAF" },
  { code: "PIT", name: "Pittsburgh Steelers", primary: "#FFB612", secondary: "#101820" },
  { code: "SF", name: "San Francisco 49ers", primary: "#AA0000", secondary: "#B3995D" },
  { code: "SEA", name: "Seattle Seahawks", primary: "#002244", secondary: "#69BE28" },
  { code: "TB", name: "Tampa Bay Buccaneers", primary: "#D50A0A", secondary: "#FF7900" },
  { code: "TEN", name: "Tennessee Titans", primary: "#4B92DB", secondary: "#C8102E" },
  { code: "WAS", name: "Washington Commanders", primary: "#5A1414", secondary: "#FFB612" },
];

export function getTeam(code: string | undefined | null): Team | null {
  if (!code) return null;
  return TEAMS.find((t) => t.code === code) ?? null;
}

/**
 * A faint tinted background + colored left edge for any row/card that
 * belongs to the viewer's favorite team — used across Model Tracker, Player
 * Props, Elo Ratings, and Parlays so that team is easy to spot wherever it
 * shows up, not just in the header. Returns undefined (no styling) when
 * there's no favorite team set or this particular row isn't theirs.
 */
export function favoriteHighlightStyle(
  team: Team | null,
  isMatch: boolean
): { backgroundColor: string; boxShadow: string } | undefined {
  if (!team || !isMatch) return undefined;
  return {
    backgroundColor: `${team.primary}17`,
    boxShadow: `inset 3px 0 0 0 ${team.primary}`,
  };
}

/** Reverse lookup — full franchise name (as odds feeds give it, e.g. "Kansas City Chiefs") to our team abbreviation. */
export function getTeamByFullName(name: string | undefined | null): Team | null {
  if (!name) return null;
  return TEAMS.find((t) => t.name === name) ?? null;
}
