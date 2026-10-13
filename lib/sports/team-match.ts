// Matches a sportsbook's team name to one of our teams. Books differ: some
// send "Alabama Crimson Tide", some just "Alabama", "Mississippi St." or
// "Los Angeles Clippers" (ESPN: "LA Clippers"). In order:
//   1. exact full name
//   2. a team whose full name starts with the book's name ("Iowa" -> the
//      Hawkeyes, shortest wins so it isn't Iowa State)
//   3. the same nickname (last word: "Clippers"), if only one candidate has it
//   4. the same first word ("Utah"), if only one candidate has it
// Only teams in `candidates` are considered when given (the teams playing
// around that start time), which keeps a short name from matching the
// wrong school.
export function makeTeamResolver(teams: { abbr: string; name: string }[]) {
  const norm = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/\bst\.?$/, "state") // "Mississippi St." -> "mississippi state"
      .replace(/\bst\. /g, "state ") // "Michigan St. Spartans"
      .replace(/^los angeles /, "la ");
  const exact = new Map(teams.map((t) => [norm(t.name), t.abbr]));
  return (bookName: string, candidates?: Set<string>): string | undefined => {
    const n = norm(bookName);
    const pool = teams.filter((t) => !candidates || candidates.has(t.abbr));
    const hit = exact.get(n);
    if (hit && (!candidates || candidates.has(hit))) return hit;
    const prefix = pool.filter((t) => norm(t.name).startsWith(n + " "));
    if (prefix.length) return [...prefix].sort((a, b) => a.name.length - b.name.length)[0].abbr;
    if (!candidates) return hit;
    const words = n.split(" ");
    const last = words[words.length - 1];
    const byNick = pool.filter((t) => norm(t.name).split(" ").pop() === last);
    if (byNick.length === 1) return byNick[0].abbr;
    const first = words[0];
    const byFirst = pool.filter((t) => norm(t.name).split(" ")[0] === first);
    if (byFirst.length === 1) return byFirst[0].abbr;
    return hit;
  };
}
