// Matching sportsbook player names to box-score names (1.22.1).
//
// Books spell players their own way: accents ("Nikola Jokić" vs "Nikola
// Jokic"), a team tag ("Donovan Mitchell (CLE)"), suffixes ("Michael Porter
// Jr." vs "Michael Porter"), punctuation ("Day Ron Sharpe" vs "Day'Ron
// Sharpe"), stray capitals ("NIkola Jokic") and even legal first names
// ("Edrice Adebayo" for Bam Adebayo, "Nazreon Reid" for Naz Reid). Before,
// only an exact match counted, so about 1 in 5 NBA lines (many of them
// stars) got no projection and no pick.
//
// Order: exact name; then the same name with accents, team tags, suffixes,
// punctuation and case ignored; then a unique player with the same last name
// on one of the game's two teams.

const SUFFIX = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

export function nameTokens(name: string): string[] {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .toLowerCase()
    .replace(/[^a-z\s'.-]/g, " ")
    .replace(/['.]/g, "")
    .replace(/-/g, " ")
    .split(/\s+/)
    .filter((t) => t && !SUFFIX.has(t));
}

export const nameKey = (name: string) => nameTokens(name).join("");

export interface NameResolver {
  resolve: (bookName: string, teams?: Iterable<string>) => string;
}

/** `known`: box-score player names with each player's most recent team. */
export function buildNameResolver(known: Iterable<{ player: string; team: string }>): NameResolver {
  const exact = new Map<string, string>();
  const byKey = new Map<string, Set<string>>();
  const byTeamLast = new Map<string, Set<string>>();
  for (const { player, team } of known) {
    exact.set(player, player);
    const k = nameKey(player);
    (byKey.get(k) ?? byKey.set(k, new Set()).get(k)!).add(player);
    const t = nameTokens(player);
    const last = t[t.length - 1];
    if (last) {
      const tl = `${team}|${last}`;
      (byTeamLast.get(tl) ?? byTeamLast.set(tl, new Set()).get(tl)!).add(player);
    }
  }
  const cache = new Map<string, string>();
  return {
    resolve(bookName, teams) {
      if (exact.has(bookName)) return bookName;
      const teamList = teams ? [...teams] : [];
      const ck = `${bookName}|${teamList.join(",")}`;
      const hit = cache.get(ck);
      if (hit) return hit;
      let out = bookName;
      const same = byKey.get(nameKey(bookName));
      if (same && same.size === 1) out = [...same][0];
      else {
        const t = nameTokens(bookName);
        const last = t[t.length - 1];
        if (last) {
          const cands = new Set<string>();
          for (const team of teamList) for (const p of byTeamLast.get(`${team}|${last}`) ?? []) cands.add(p);
          if (cands.size === 1) out = [...cands][0];
          else if (cands.size > 1 && same) {
            const both = [...cands].filter((c) => same.has(c));
            if (both.length === 1) out = both[0];
          }
        }
      }
      cache.set(ck, out);
      return out;
    },
  };
}
