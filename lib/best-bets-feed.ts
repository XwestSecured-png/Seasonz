// Today's best bets, every sport, one feed: wherever our best estimate of a
// side's chance beats the best price any main book is offering.
//
//   Games: our final number (model blended with the market consensus, see
//   lib/sports/game-model.ts) vs the best moneyline among the books. Since
//   the final number leans mostly on the market, a game edge usually means
//   one book is out of line with the rest (price shopping), not a hunch.
//   Props: the prop model's chance (lib/prop-dist.ts, calibrated) vs the
//   best price for that exact line and side among the main books.
//
// Only edges of 2+ points (games) / 3+ points (props) are listed.
import { db } from "@/db";
import { games, oddsLines, propLinesRaw, sportGames, sportOddsLines, sportPropLinesRaw } from "@/db/schema";
import { and, eq, gt, inArray, lt, max } from "drizzle-orm";
import { SPORTS, type SportKey } from "./sports/types";
import { MAIN_BOOKS, MODEL_FAIR_BOOK } from "./football-markets";
import type { BetOption } from "@/app/(app)/log-bet-button";

export interface FeedItem {
  key: string;
  sport: string;
  sportLabel: string;
  kind: "Game" | "Prop";
  kickoffAt: string | null;
  matchup: string;
  label: string;
  modelPct: number;
  bestPrice: number;
  bestBook: string;
  otherPrices: { book: string; price: number }[];
  edge: number; // modelPct - implied(bestPrice)
  preseason: boolean;
  href: string;
  bet: BetOption;
  /** Props: trust score (lib/prop-trust.ts). */
  trust?: { tier: "High" | "Medium" | "Low"; adj?: number; reasons?: string[]; hits?: number | null; of?: number | null } | null;
}

const implied = (a: number) => (a < 0 ? -a / (-a + 100) : 100 / (a + 100));
const fmt = (p: number) => (p > 0 ? `+${p}` : `${p}`);
const BOOK_LABEL: Record<string, string> = {
  fanduel: "FanDuel",
  betmgm: "BetMGM",
  draftkings: "DraftKings",
  williamhill_us: "Caesars",
  pinnacle: "Pinnacle",
  betonlineag: "BetOnline",
  lowvig: "LowVig",
};
// Prices people can actually bet in the US (sharp offshore books inform the
// estimate but aren't offered as "best price").
const BETTABLE = new Set(["fanduel", "betmgm", "draftkings", "williamhill_us"]);
const BETTABLE_PROP_BOOKS = MAIN_BOOKS.filter((b) => b !== MODEL_FAIR_BOOK);

export const MIN_GAME_EDGE = 0.02;
export const MIN_PROP_EDGE_FEED = 0.03;

export async function getBestBetsFeed(windowHours = 36): Promise<FeedItem[]> {
  const now = new Date();
  const until = new Date(now.getTime() + windowHours * 3600_000);
  const out: FeedItem[] = [];

  // ---------------------------------------------------------- games, other sports
  const sg = await db
    .select()
    .from(sportGames)
    .where(and(eq(sportGames.isFinal, false), gt(sportGames.kickoffAt, now), lt(sportGames.kickoffAt, until)));
  for (const g of sg) {
    if (g.homeWinPctPre === null) continue;
    const odds = ((g.extra as { odds?: Record<string, { mlHome: number | null; mlAway: number | null } | undefined> } | null)?.odds ?? {}) as Record<
      string,
      { mlHome: number | null; mlAway: number | null } | undefined
    >;
    for (const side of ["home", "away"] as const) {
      const p = side === "home" ? g.homeWinPctPre : 1 - g.homeWinPctPre;
      const prices = Object.entries(odds)
        .filter(([k, b]) => BETTABLE.has(k) && (side === "home" ? b?.mlHome : b?.mlAway) != null)
        .map(([k, b]) => ({ book: BOOK_LABEL[k] ?? k, price: (side === "home" ? b!.mlHome : b!.mlAway) as number }))
        .sort((a, b) => b.price - a.price);
      if (!prices.length) continue;
      const best = prices[0];
      const edge = p - implied(best.price);
      if (edge < MIN_GAME_EDGE) continue;
      const team = side === "home" ? g.homeTeam : g.awayTeam;
      out.push({
        key: `g-${g.id}-${side}`,
        sport: g.sport,
        sportLabel: SPORTS[g.sport as SportKey]?.label ?? g.sport.toUpperCase(),
        kind: "Game",
        kickoffAt: g.kickoffAt?.toISOString() ?? null,
        matchup: `${g.awayTeam} @ ${g.homeTeam}`,
        label: `${team} to win`,
        modelPct: p,
        bestPrice: best.price,
        bestBook: best.book,
        otherPrices: prices.slice(1),
        edge,
        preseason: g.seasonType === 1,
        href: `/sports/${g.sport}`,
        bet: { label: `${team} ML ${fmt(best.price)} (${best.book})`, sport: g.sport, sportGameId: g.id, market: "ML", selection: team, priceAmerican: best.price },
      });
    }
  }

  // ---------------------------------------------------------------- NFL games
  const ng = await db.select().from(games).where(and(eq(games.isFinal, false), gt(games.kickoffAt, now), lt(games.kickoffAt, until)));
  for (const g of ng) {
    if (g.homeWinPctPre === null) continue;
    for (const side of ["home", "away"] as const) {
      const price = side === "home" ? g.moneylineHomeOdds : g.moneylineAwayOdds;
      if (price == null) continue;
      const p = side === "home" ? g.homeWinPctPre : 1 - g.homeWinPctPre;
      const edge = p - implied(price);
      if (edge < MIN_GAME_EDGE) continue;
      const team = side === "home" ? g.homeTeam : g.awayTeam;
      out.push({
        key: `n-${g.id}-${side}`,
        sport: "nfl",
        sportLabel: "NFL",
        kind: "Game",
        kickoffAt: g.kickoffAt?.toISOString() ?? null,
        matchup: `${g.awayTeam} @ ${g.homeTeam}`,
        label: `${team} to win`,
        modelPct: p,
        bestPrice: price,
        bestBook: g.moneylineBook ?? "Book",
        otherPrices: [],
        edge,
        preseason: false,
        href: "/model-tracker",
        bet: { label: `${team} ML ${fmt(price)}`, sport: "nfl", gameId: g.id, market: "ML", selection: team, priceAmerican: price },
      });
    }
  }

  // ------------------------------------------------------------- props, other sports
  // Each team's next game in the window.
  const nextGame = new Map<string, (typeof sg)[number]>();
  for (const g of [...sg].sort((a, b) => (a.kickoffAt?.getTime() ?? 0) - (b.kickoffAt?.getTime() ?? 0))) {
    for (const t of [g.homeTeam, g.awayTeam]) if (!nextGame.has(`${g.sport}|${t}`)) nextGame.set(`${g.sport}|${t}`, g);
  }
  const sportsWithGames = [...new Set(sg.map((g) => g.sport))];
  for (const sport of sportsWithGames) {
    const [latest] = await db.select({ week: max(sportOddsLines.week), season: max(sportOddsLines.season) }).from(sportOddsLines).where(eq(sportOddsLines.sport, sport));
    if (latest?.week == null || latest.season == null) continue;
    const picks = await db
      .select()
      .from(sportOddsLines)
      .where(and(eq(sportOddsLines.sport, sport), eq(sportOddsLines.season, latest.season), eq(sportOddsLines.week, latest.week)));
    if (!picks.length) continue;
    const raw = await db
      .select()
      .from(sportPropLinesRaw)
      .where(
        and(
          eq(sportPropLinesRaw.sport, sport),
          eq(sportPropLinesRaw.season, latest.season),
          eq(sportPropLinesRaw.week, latest.week),
          inArray(sportPropLinesRaw.book, BETTABLE_PROP_BOOKS)
        )
      );
    const rawBy = new Map<string, { book: string; price: number }[]>();
    for (const r of raw) {
      const k = `${r.player}|${r.statType}|${r.line}|${r.side}`;
      rawBy.set(k, [...(rawBy.get(k) ?? []), { book: r.book, price: r.priceAmerican }]);
    }
    const seen = new Set<string>();
    for (const p of picks) {
      if (p.modelWinPct == null || !p.team) continue;
      const g = nextGame.get(`${sport}|${p.team}`);
      if (!g) continue;
      const k = `${p.player}|${p.statType}|${p.line}|${p.side}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const prices = (rawBy.get(k) ?? [{ book: p.book, price: p.priceAmerican }]).sort((a, b) => b.price - a.price);
      const best = prices[0];
      const edge = p.modelWinPct - implied(best.price);
      if (edge < MIN_PROP_EDGE_FEED) continue;
      const side = p.side === "Under" ? "Under" : "Over";
      out.push({
        key: `p-${sport}-${k}`,
        sport,
        sportLabel: SPORTS[sport as SportKey]?.label ?? sport.toUpperCase(),
        kind: "Prop",
        kickoffAt: g.kickoffAt?.toISOString() ?? null,
        matchup: `${g.awayTeam} @ ${g.homeTeam}`,
        label: `${p.player} ${side} ${p.line} ${p.statType}`,
        modelPct: p.modelWinPct,
        bestPrice: best.price,
        bestBook: best.book,
        otherPrices: prices.slice(1),
        edge,
        preseason: g.seasonType === 1,
        href: "/props",
        trust: (p.trust as FeedItem["trust"]) ?? null,
        bet: {
          label: `${p.player} ${side} ${p.line} ${p.statType} ${fmt(best.price)} (${best.book})`,
          sport,
          sportGameId: g.id,
          market: "PROP",
          selection: side,
          line: p.line,
          priceAmerican: best.price,
          description: `${p.player} ${side} ${p.line} ${p.statType}`,
          prop: { player: p.player, statType: p.statType, line: p.line, side },
        },
      });
    }
  }

  // ------------------------------------------------------------------ NFL props
  if (ng.length) {
    const nflNext = new Map<string, (typeof ng)[number]>();
    for (const g of [...ng].sort((a, b) => (a.kickoffAt?.getTime() ?? 0) - (b.kickoffAt?.getTime() ?? 0)))
      for (const t of [g.homeTeam, g.awayTeam]) if (!nflNext.has(t)) nflNext.set(t, g);
    const season = ng[0].season;
    const week = Math.min(...ng.map((g) => g.week));
    const picks = await db.select().from(oddsLines).where(and(eq(oddsLines.season, season), eq(oddsLines.week, week)));
    const raw = await db
      .select()
      .from(propLinesRaw)
      .where(and(eq(propLinesRaw.season, season), eq(propLinesRaw.week, week), inArray(propLinesRaw.book, BETTABLE_PROP_BOOKS)));
    const rawBy = new Map<string, { book: string; price: number }[]>();
    for (const r of raw) {
      const k = `${r.player}|${r.statType}|${r.line}|${r.side}`;
      rawBy.set(k, [...(rawBy.get(k) ?? []), { book: r.book, price: r.priceAmerican }]);
    }
    const seen = new Set<string>();
    for (const p of picks) {
      if (p.modelWinPct == null || !p.team || !p.player || !p.statType || p.line == null || p.priceAmerican == null) continue;
      const g = nflNext.get(p.team);
      if (!g) continue;
      const k = `${p.player}|${p.statType}|${p.line}|${p.side}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const prices = (rawBy.get(k) ?? [{ book: p.book ?? "Book", price: p.priceAmerican }]).sort((a, b) => b.price - a.price);
      const best = prices[0];
      const edge = p.modelWinPct - implied(best.price);
      if (edge < MIN_PROP_EDGE_FEED) continue;
      const side = p.side === "Under" ? "Under" : "Over";
      out.push({
        key: `np-${k}`,
        sport: "nfl",
        sportLabel: "NFL",
        kind: "Prop",
        kickoffAt: g.kickoffAt?.toISOString() ?? null,
        matchup: `${g.awayTeam} @ ${g.homeTeam}`,
        label: `${p.player} ${side} ${p.line} ${p.statType}`,
        modelPct: p.modelWinPct,
        bestPrice: best.price,
        bestBook: best.book,
        otherPrices: prices.slice(1),
        edge,
        preseason: false,
        href: "/props",
        trust: (p.trust as FeedItem["trust"]) ?? null,
        bet: {
          label: `${p.player} ${side} ${p.line} ${p.statType} ${fmt(best.price)} (${best.book})`,
          sport: "nfl",
          gameId: g.id,
          market: "PROP",
          selection: side,
          line: p.line,
          priceAmerican: best.price,
          description: `${p.player} ${side} ${p.line} ${p.statType}`,
          prop: { player: p.player, statType: p.statType, line: p.line, side },
        },
      });
    }
  }

  return out.sort((a, b) => b.edge - a.edge);
}
