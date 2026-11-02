// Trades (1.37.0): who changed teams, and what it's worth to each side.
//
// ESPN's transactions feed lists every roster move per league; trades are
// the moves that read "Traded ..." (the sending team) or "Acquired ..."
// (the receiving team). Each player in a trade becomes two rows: "out" for
// the team that sent him, "in" for the team that got him.
//
// The model counts a trade the way it counts an injury, in reverse: the
// sending team loses the player's production above a replacement-level
// fill-in, the receiving team gains it. The adjustment fades as each team
// plays games with its new roster, because Elo and recent form start to
// carry the change themselves (TRADE_FADE_GAMES), and the new team counts
// a little less of the player at first while he learns a new system
// (NEW_TEAM_SHARE). Trades can't be backtested on our data (ESPN keeps
// only recent transactions), so, like injuries, the shift is capped.
import { db } from "@/db";
import { trades } from "@/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { nameKey } from "./player-names";

export type TradeSport = "nfl" | "nba" | "wnba" | "nhl" | "mlb";

export const ESPN_PATH: Record<TradeSport, string> = {
  nfl: "football/nfl",
  nba: "basketball/nba",
  wnba: "basketball/wnba",
  nhl: "hockey/nhl",
  mlb: "baseball/mlb",
};

/** Games with the new roster until a trade stops counting. */
export const TRADE_FADE_GAMES: Record<TradeSport, number> = { nfl: 6, nba: 20, wnba: 15, nhl: 20, mlb: 30 };
/** Share of a player's value the receiving team gets at first. */
export const NEW_TEAM_SHARE = 0.8;
/** How far back trades are kept in the model. */
export const TRADE_WINDOW_DAYS = 120;

export interface ParsedTrade {
  team: string;
  direction: "in" | "out";
  player: string;
  position: string | null;
  otherTeam: string | null;
  description: string;
  date: Date;
}

const POS =
  "QB|RB|FB|WR|TE|OL|OT|OG|LT|RT|C|G|T|DE|DT|DL|NT|LB|OLB|ILB|MLB|EDGE|CB|DB|S|FS|SS|K|P|LS|PG|SG|SF|PF|F|G-F|F-C|C-F|F-G|LW|RW|D|RHP|LHP|SP|RP|1B|2B|3B|LF|CF|RF|DH|OF|IF|INF|UT";
const PLAYER_RE = new RegExp(`\\b(${POS})\\s+([A-Z][A-Za-z.'\\-]+(?:\\s+(?:[A-Z][A-Za-z.'\\-]+|Jr\\.?|Sr\\.?|II|III|IV|V))+)`, "g");
const NOT_A_PLAYER = /\b(pick|round|cash|considerations|rights|draft|future|player to be named|exception)\b/i;

/** "the Pittsburgh Steelers" -> "Pittsburgh Steelers" */
const teamName = (s: string | undefined) => s?.replace(/^the\s+/i, "").replace(/[.,;].*$/, "").trim() || null;

/**
 * Players moved by one transaction line, or [] if it isn't a trade.
 * "Traded WR Jakobi Meyers and a 2027 sixth-round pick to the Jacksonville Jaguars for ..."
 * "Acquired G Collin Sexton from the Utah Jazz in exchange for ..."
 */
export function parseTransaction(description: string, team: string, date: Date): ParsedTrade[] {
  const d = description.replace(/\s+/g, " ").trim();
  const m = /^(Traded|Acquired)\b\s+(.*)$/i.exec(d);
  if (!m) return [];
  const out = m[1].toLowerCase() === "traded";
  const rest = m[2];
  const split = out ? /\s+to\s+(?:the\s+)?([A-Z][^,;]*?)(?=\s+(?:for|in exchange|and receiv)|[.;]|$)/i : /\s+from\s+(?:the\s+)?([A-Z][^,;]*?)(?=\s+(?:for|in exchange)|[.;]|$)/i;
  const sm = split.exec(rest);
  const moved = sm ? rest.slice(0, sm.index) : rest;
  const otherTeam = teamName(sm?.[1]);
  const found: { player: string; position: string | null }[] = [];
  for (const pm of moved.matchAll(PLAYER_RE)) found.push({ position: pm[1], player: pm[2].trim() });
  // No position given ("Traded Kevin Durant to ..."): take capitalised names between commas/"and".
  if (found.length === 0) {
    for (const part of moved.split(/,|\band\b/)) {
      const p = part.trim();
      if (!p || NOT_A_PLAYER.test(p) || /\d/.test(p)) continue;
      if (/^([A-Z][A-Za-z.'\-]+)(\s+([A-Z][A-Za-z.'\-]+|Jr\.?|Sr\.?|II|III|IV)){1,3}$/.test(p)) found.push({ player: p, position: null });
    }
  }
  return found
    .filter((f) => !NOT_A_PLAYER.test(f.player))
    .map((f) => ({ team, direction: out ? "out" : "in", player: f.player, position: f.position, otherTeam, description: d, date }));
}

/** Pairs each side with the other team, when ESPN listed both teams' lines. */
export function linkSides(rows: ParsedTrade[], teamNames: Map<string, string>): ParsedTrade[] {
  const byPlayer = new Map<string, ParsedTrade[]>();
  for (const r of rows) {
    const k = nameKey(r.player);
    byPlayer.set(k, [...(byPlayer.get(k) ?? []), r]);
  }
  return rows.map((r) => {
    const twin = (byPlayer.get(nameKey(r.player)) ?? []).find(
      (x) => x.direction !== r.direction && Math.abs(x.date.getTime() - r.date.getTime()) < 4 * 86_400_000
    );
    if (twin) return { ...r, otherTeam: twin.team };
    // Only the full name in the text: map it to an abbreviation when we know it.
    const abbr = r.otherTeam ? teamNames.get(r.otherTeam.toLowerCase()) : undefined;
    return abbr ? { ...r, otherTeam: abbr } : r;
  });
}

/** Reads ESPN's transactions feed for a league and stores its trades. */
export async function syncTrades(sport: TradeSport): Promise<string> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${ESPN_PATH[sport]}/transactions?limit=300`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`ESPN transactions ${res.status}`);
  const data = (await res.json()) as { transactions?: unknown[]; items?: unknown[] };
  const items = (data.transactions ?? data.items ?? []) as {
    date?: string;
    description?: string;
    team?: { abbreviation?: string; displayName?: string; name?: string; location?: string };
  }[];
  const names = new Map<string, string>();
  for (const it of items) {
    const t = it.team;
    if (t?.abbreviation && t.displayName) names.set(t.displayName.toLowerCase(), t.abbreviation);
  }
  const parsed: ParsedTrade[] = [];
  for (const it of items) {
    const abbr = it.team?.abbreviation;
    if (!abbr || !it.description || !it.date) continue;
    const date = new Date(it.date);
    if (Number.isNaN(date.getTime())) continue;
    parsed.push(...parseTransaction(it.description, abbr, date));
  }
  const rows = linkSides(parsed, names);
  if (rows.length) {
    await db
      .insert(trades)
      .values(rows.map((r) => ({ sport, tradeDate: r.date, team: r.team, direction: r.direction, player: r.player, position: r.position, otherTeam: r.otherTeam, description: r.description })))
      .onConflictDoUpdate({
        target: [trades.sport, trades.team, trades.direction, trades.player, trades.tradeDate],
        set: { otherTeam: sql`excluded.other_team`, position: sql`coalesce(excluded.position, ${trades.position})`, description: sql`excluded.description`, updatedAt: sql`now()` },
      });
  }
  const players = new Set(rows.map((r) => nameKey(r.player))).size;
  return `${items.length} transaction(s) read; ${rows.length} trade side(s) for ${players} player(s) saved.`;
}

export type TradeRow = typeof trades.$inferSelect;

/** Trades still inside the model's window, oldest first. */
export async function recentTrades(sport: TradeSport): Promise<TradeRow[]> {
  const rows = await db
    .select()
    .from(trades)
    .where(and(eq(trades.sport, sport), gte(trades.tradeDate, new Date(Date.now() - TRADE_WINDOW_DAYS * 86_400_000))));
  return rows.sort((a, b) => a.tradeDate.getTime() - b.tradeDate.getTime());
}

/** 1 right after the trade, falling to 0 after TRADE_FADE_GAMES games. */
export const tradeFade = (sport: TradeSport, gamesSince: number) => Math.max(0, 1 - gamesSince / TRADE_FADE_GAMES[sport]);

/**
 * A team's net traded value at a point in time: players in (at
 * NEW_TEAM_SHARE) minus players out, each faded by how many games the team
 * has played since. valueOf returns the player's value in the sport's unit.
 */
export function netTradeValue(
  sport: TradeSport,
  team: string,
  rows: TradeRow[],
  valueOf: (r: TradeRow) => number,
  gamesSince: (team: string, since: Date) => number
): number {
  let net = 0;
  for (const r of rows) {
    if (r.team !== team) continue;
    const v = valueOf(r);
    if (!(v > 0)) continue;
    const f = tradeFade(sport, gamesSince(team, r.tradeDate));
    net += (r.direction === "in" ? NEW_TEAM_SHARE : -1) * v * f;
  }
  return net;
}

/** Writes each trade row's value and its current impact (shown on the Trades tab). */
export async function saveTradeValues(
  updates: { id: number; value: number | null; valueLabel: string | null; impactPct: number | null; impactNowPct: number | null; gamesSince: number }[]
) {
  for (const u of updates) {
    await db
      .update(trades)
      .set({ value: u.value, valueLabel: u.valueLabel, impactPct: u.impactPct, impactNowPct: u.impactNowPct, gamesSince: u.gamesSince, updatedAt: sql`now()` })
      .where(eq(trades.id, u.id));
  }
}

/** NFL QB starter value, as in lib/injury-impact.ts (QB_OUT_WIN_PCT_IMPACT). */
const NFL_QB_VALUE = 0.12;

/**
 * NFL trade value in win-probability points, the same way an injured
 * player is valued (lib/injury-impact.ts): a starting QB 0.12, a running
 * back/receiver/tight end half his share of his old team's positive EPA.
 * Other positions have no per-player estimate yet (0).
 */
export function nflTradeValues(
  rows: TradeRow[],
  stats: { team: string; player: string; position: string; epa: number; passYds: number }[]
): Map<number, { value: number; label: string | null }> {
  const teamPos = new Map<string, number>();
  const playerEpa = new Map<string, number>(); // team|nameKey
  const passYds = new Map<string, number>(); // team|nameKey
  const teamsOf = new Map<string, Map<string, number>>(); // nameKey -> team -> games
  for (const s of stats) {
    if (s.epa > 0) teamPos.set(s.team, (teamPos.get(s.team) ?? 0) + s.epa);
    const k = `${s.team}|${nameKey(s.player)}`;
    playerEpa.set(k, (playerEpa.get(k) ?? 0) + s.epa);
    if (s.position === "QB") passYds.set(k, (passYds.get(k) ?? 0) + s.passYds);
    const m = teamsOf.get(nameKey(s.player)) ?? new Map<string, number>();
    m.set(s.team, (m.get(s.team) ?? 0) + 1);
    teamsOf.set(nameKey(s.player), m);
  }
  const out = new Map<number, { value: number; label: string | null }>();
  for (const r of rows) {
    const nk = nameKey(r.player);
    // The team he played for before the trade.
    const from =
      r.direction === "out"
        ? r.team
        : r.otherTeam && teamsOf.get(nk)?.has(r.otherTeam)
          ? r.otherTeam
          : [...(teamsOf.get(nk)?.entries() ?? [])].filter(([t]) => t !== r.team).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!from) {
      out.set(r.id, { value: 0, label: null });
      continue;
    }
    const pos = (r.position ?? "").toUpperCase();
    if (pos === "QB") {
      const mine = passYds.get(`${from}|${nk}`) ?? 0;
      const top = Math.max(0, ...[...passYds.entries()].filter(([k]) => k.startsWith(`${from}|`)).map(([, v]) => v));
      const starter = mine > 0 && mine >= top;
      out.set(r.id, { value: starter ? NFL_QB_VALUE : 0, label: starter ? "starting QB" : "backup QB" });
      continue;
    }
    const epa = playerEpa.get(`${from}|${nk}`) ?? 0;
    const pool = teamPos.get(from) ?? 0;
    if (epa > 0 && pool > 0) {
      const share = epa / pool;
      out.set(r.id, { value: share * 0.5, label: `${(share * 100).toFixed(1)}% of ${from} offense EPA` });
    } else out.set(r.id, { value: 0, label: null });
  }
  return out;
}

/** Most an NFL trade adjustment can move a game. */
export const NFL_TRADE_CAP = 0.06;
