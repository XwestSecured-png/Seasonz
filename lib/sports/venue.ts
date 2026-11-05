// Where a game is played (1.41.0), from ESPN's game preview saved on each
// game: "M. M. Roberts Stadium · Hattiesburg, MS". Neutral-site games (bowls,
// kickoff classics, rivalry games at a third stadium) are flagged, since
// home-field edge doesn't apply there.
export interface VenueInfo {
  label: string;
  neutral: boolean;
}

export function venueOf(extra: unknown, neutralSite: boolean): VenueInfo | null {
  const v = (extra as { preview?: { venue?: { name?: string | null; city?: string | null; state?: string | null } | null } } | null)?.preview?.venue;
  const place = [v?.city, v?.state].filter(Boolean).join(", ");
  const label = [v?.name, place].filter(Boolean).join(" · ");
  if (!label && !neutralSite) return null;
  return { label: label || "Neutral site", neutral: neutralSite };
}
