// Matches a sportsbook's team name to one of our teams. Books differ: some
// send "Alabama Crimson Tide", some just "Alabama" or "Florida State".
// Exact match first; otherwise the team whose full name starts with the
// book's name followed by a space, preferring the shortest (so "Iowa" is the
// Hawkeyes, not Iowa State). Only teams in `candidates` are considered when
// given, which keeps a short name from matching the wrong school.
export function makeTeamResolver(teams: { abbr: string; name: string }[]) {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const exact = new Map(teams.map((t) => [norm(t.name), t.abbr]));
  return (bookName: string, candidates?: Set<string>): string | undefined => {
    const n = norm(bookName);
    const hit = exact.get(n);
    if (hit && (!candidates || candidates.has(hit))) return hit;
    const pool = teams.filter((t) => (!candidates || candidates.has(t.abbr)) && norm(t.name).startsWith(n + " "));
    if (pool.length === 0) return hit;
    pool.sort((a, b) => a.name.length - b.name.length);
    return pool[0].abbr;
  };
}
