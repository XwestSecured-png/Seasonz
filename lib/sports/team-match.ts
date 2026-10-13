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
  const ALIAS: Record<string, string> = {
    "appalachian state": "app state",
    "miami fl": "miami",
    "miami (fl)": "miami",
    "louisiana-monroe": "ul monroe",
    "louisiana monroe": "ul monroe",
    "louisiana-lafayette": "louisiana",
    "southern miss": "southern miss",
    "ole miss": "ole miss",
    umass: "massachusetts",
    connecticut: "uconn",
    "central florida": "ucf",
    fiu: "florida international",
    "florida intl": "florida international",
    "southern methodist": "smu",
    "brigham young": "byu",
    "north carolina state": "nc state",
    "texas-san antonio": "utsa",
    "texas-el paso": "utep",
  };
  const norm = (s: string) =>
    (ALIAS[s.trim().toLowerCase()] ?? s)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // "San José" -> "San Jose"
      .replace(/['\u2019]/g, "") // "Hawai'i" -> "Hawaii"
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/\bst\.?$/, "state") // "Mississippi St." -> "mississippi state"
      .replace(/\bst\. /g, "state ") // "Michigan St. Spartans"
      .replace(/^los angeles /, "la ");
  const exact = new Map(teams.map((t) => [norm(t.name), t.abbr]));
  const resolve = (bookName: string, candidates?: Set<string>): string | undefined => {
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

  /**
   * Every team in `candidates` the book's name could mean: exact name,
   * name prefix ("Alabama" -> Crimson Tide AND Alabama A&M), nickname,
   * first word, and abbreviation variants ("UTAH" vs the schedule's "UTA").
   * The caller keeps the pairing that is an actual scheduled game, which
   * settles names that are ambiguous on their own.
   */
  const resolveAll = (bookName: string, candidates: Set<string>): string[] => {
    const n = norm(bookName);
    const words = n.split(" ");
    const out = new Set<string>();
    for (const t of teams) {
      const tn = norm(t.name);
      if (tn === n || tn.startsWith(n + " ") || tn.split(" ").pop() === words[words.length - 1] || tn.split(" ")[0] === words[0]) out.add(t.abbr);
    }
    const one = resolve(bookName, candidates);
    if (one) out.add(one);
    const res = new Set<string>();
    for (const c of candidates) {
      const cl = c.toLowerCase();
      if (out.has(c)) res.add(c);
      // Same team under a slightly different abbreviation (UTAH / UTA).
      else if ([...out].some((r) => r.length >= 2 && (r.startsWith(c) || c.startsWith(r)))) res.add(c);
      // No team row at all: the abbreviation starts the book's name ("Utah" -> UTA).
      else if (cl.length >= 3 && words[0].startsWith(cl)) res.add(c);
    }
    return [...res];
  };
  return Object.assign(resolve, { all: resolveAll });
}
