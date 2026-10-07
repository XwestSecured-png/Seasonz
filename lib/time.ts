// Small timezone helper — nflverse's schedule data publishes gameday
// ("YYYY-MM-DD") and gametime ("HH:MM", 24h) as naive Eastern local time
// (confirmed against nflverse's own schedule-timezone fix notes: "nflverse's
// gametime is Eastern local time" — America/New_York, DST included). Turning
// that into a real UTC instant needs a DST-aware conversion, which Node's
// built-in Intl can do without pulling in a timezone-database npm package
// (kept consistent with this app's no-new-dependency convention — see
// app/(app)/icons.tsx).

/**
 * Converts a "YYYY-MM-DD" date + "HH:MM" time, both given as
 * America/New_York local time, into the equivalent UTC Date. Uses the
 * "guess then correct" trick: treat the wall-clock numbers as if they were
 * already UTC, see what that instant actually renders as in New York, and
 * shift by the difference — this picks up the right EST/EDT offset for
 * that specific date automatically, no hardcoded offset or DST table.
 */
export function nyLocalToUtc(dateStr: string, timeStr: string): Date | null {
  const dateMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (!dateMatch || !timeMatch) return null;

  const [, y, mo, d] = dateMatch.map(Number) as unknown as [number, number, number, number];
  const [, hh, mm] = timeMatch.map(Number) as unknown as [number, number, number];

  const guessMs = Date.UTC(y, mo - 1, d, hh, mm);

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(guessMs));

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  // formatToParts can render hour "24" for midnight — Date.UTC handles that fine.
  const renderedMs = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));

  const deltaMs = guessMs - renderedMs;
  return new Date(guessMs + deltaMs);
}

export const PICK_LOCK_MINUTES_BEFORE_KICKOFF = 5;

/** True once we're inside the lock window before kickoff (or kickoff has passed). A null kickoff time (not yet synced) never locks — picks stay open rather than silently blocking. */
export function isPickLocked(kickoffAt: Date | null, now: Date = new Date()): boolean {
  if (!kickoffAt) return false;
  const locksAt = kickoffAt.getTime() - PICK_LOCK_MINUTES_BEFORE_KICKOFF * 60 * 1000;
  return now.getTime() >= locksAt;
}
