// Model Builds — the model's own best parlays and player-prop parlays, for
// TODAY and for THIS WEEK, in every size from 2 to 8 legs, each leg with a
// plain-English explanation of why it was picked.
//
// Built fresh on every page load from what the scheduled syncs already put
// in the database (NFL games + factor breakdowns, every other sport's Elo
// picks, and the model's NFL prop projections), so it's always current
// with the latest sync and needs no extra stage.
//
// Honesty rules baked in:
//  - Only the model's own side of a game is ever a leg (never the underdog
//    for payout), and only when the model is at least MIN_GAME_PROB sure.
//  - Near-certain props (e.g. "QB sacked at least once", 95%+) are left out:
//    books price those so short they add nothing but risk to a parlay.
//  - One leg per game, and one prop per team, so legs don't lean on each
//    other — the combined chance is then a straight product, which is
//    stated as an estimate that assumes the legs are independent.
//  - When a real sportsbook price exists it's used; otherwise the payout is
//    the model's fair price and labelled that way.
import { sortScore } from "./prop-sort";
import { db } from "@/db";
import { games, oddsLines, propLinesRaw, sportGames, sportOddsLines, sportTeamMetrics, teamMetrics } from "@/db/schema";
import { PICKEM_BOOKS, blendPropChance } from "./props-model";
import { MODEL_FAIR_BOOK } from "./football-markets";
import { getModelWeights, weightFor } from "./model-weights";
import { and, desc, eq, inArray } from "drizzle-orm";
import { SPORTS, type SportKey } from "./sports/types";
import { currentSeasonYear } from "./sports/espn";
import { probToFairAmerican } from "./fair-odds";
import { thisWeekOrNext } from "./week-window";
import { americanToDecimalOdds as americanToDecimal } from "./stake-sizing";
import { gameTrust, modelOnlyTrust, parlayTrust, type Trust, type TrustTier } from "./prop-trust";

export const BUILD_SIZES = [2, 3, 4, 5, 6, 7, 8] as const;
// Preferred band: confident but not so short the price adds nothing.
const MIN_GAME_PROB = 0.6;
const MAX_GAME_PROB = 0.9; // -900 and shorter adds risk but almost no payout
const MIN_PROP_PROB = 0.55;
const MAX_PROP_PROB = 0.9;
// Wider band used only to fill out bigger parlays (up to 8 legs) on a light
// slate: still the model's own side, still better than a coin flip.
const FILL_MIN_PROB = 0.52;
const FILL_MAX_PROB = 0.96;
const inBand = (p: number, lo: number, hi: number) => p >= lo && p <= hi;
// Touchdown props are long shots by nature (a top back scores in ~half his
// games), so a TD-only parlay uses its own band: 20%+ to be listed, 30%+ to
// be preferred. They only enter the all-stats parlays when they clear the
// usual 52% floor.
const TD_FILL_MIN_PROB = 0.2;
const TD_MIN_PROB = 0.3;
const isTd = (stat: string | null | undefined) => stat === "Anytime TD" || stat === "2+ TDs";
const OTHER_SPORTS: SportKey[] = ["nba", "wnba", "nhl", "mlb", "ncaaf", "ncaab"];

export interface BuildLeg {
  id: string;
  sportKey: "nfl" | SportKey;
  preferred: boolean; // inside the preferred confidence band
  sport: string; // "NFL", "NBA", ...
  kind: "game" | "prop";
  label: string; // "KC to win", "Josh Allen anytime TD"
  matchup: string;
  startsAt: string | null; // ISO
  prob: number; // model chance this leg wins
  priceAmerican: number;
  priceSource: "book" | "fair";
  reasons: string[]; // why the model likes it, most important first
  teamKey: string; // for "one per game / team" spacing
  /** Prop stat type ("Anytime TD", "Rec Yds", "Points"...), for building one-stat parlays. */
  stat?: string;
  trust: Pick<Trust, "tier" | "adj" | "reasons" | "hits" | "of">;
}

export interface Build {
  size: number;
  legs: BuildLeg[];
  combinedProb: number;
  americanOdds: number;
  payoutPer10: number; // total return on a $10 stake
  weakest: BuildLeg;
  summary: string;
  usesFairPrices: boolean;
  trust: { tier: TrustTier; reason: string };
}

/** How legs are chosen: most confident (trust first), highest chance, or best payout. */
export type BuildMode = "confidence" | "chance" | "price";

export interface BuildSet {
  window: "today" | "week";
  parlays: Build[]; // game picks (most confident)
  props: Build[]; // player props (most confident)
  /** The same builds for every way of choosing legs. */
  variants: Record<BuildMode, { parlays: Build[]; props: Build[]; propsByStat: Record<string, Build[]> }>;
  /** Stat types with 2+ prop legs, for the "Stat" menu (Anytime TD first). */
  propStats: { stat: string; legs: number }[];
  gameLegPool: number;
  propLegPool: number;
}

// ---------- helpers ----------

const ET = "America/New_York";
function etDate(d: Date) {
  return d.toLocaleDateString("en-CA", { timeZone: ET });
}
const pctStr = (p: number) => `${Math.round(p * 100)}%`;
/** Soonest week with games still to play, ignoring stale never-final games (postponed/canceled). */
function activeWeekOf(rows: { week: number; kickoffAt: Date | null }[]): number | null {
  const cutoff = Date.now() - 12 * 3600 * 1000;
  const live = rows.filter((g) => !g.kickoffAt || g.kickoffAt.getTime() > cutoff);
  return live.length ? Math.min(...live.map((g) => g.week)) : null;
}
const signed = (v: number, digits = 1) => `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;

function combine(legs: BuildLeg[]) {
  const combinedProb = legs.reduce((a, l) => a * l.prob, 1);
  const decimal = legs.reduce((a, l) => a * americanToDecimal(l.priceAmerican), 1);
  const american = decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1));
  return { combinedProb, decimal, american };
}

function summarize(legs: BuildLeg[], combinedProb: number, kind: "game" | "prop", window: "today" | "week", mode: BuildMode) {
  const sports = Array.from(new Set(legs.map((l) => l.sport)));
  const avg = legs.reduce((a, l) => a + l.prob, 0) / legs.length;
  const weakest = legs.reduce((w, l) => (l.prob < w.prob ? l : w));
  const oneStat = kind === "prop" && legs.every((l) => l.stat && l.stat === legs[0].stat) ? legs[0].stat : null;
  const what = kind === "game" ? "game picks" : oneStat ? `${oneStat} picks` : "player props";
  const when = window === "today" ? "today's" : "this week's";
  const spread =
    kind === "game"
      ? "Every leg is a different game"
      : "Every prop is on a different team";
  return (
    `The model's ${legs.length} ${mode === "confidence" ? "most trusted" : mode === "price" ? "best-paying" : "strongest"} ${what} from ${when} slate` +
    (sports.length > 1 ? ` across ${sports.join(", ")}` : "") +
    `. Each leg averages a ${pctStr(avg)} chance on its own. ${spread}, so one result doesn't drag another down. ` +
    `All ${legs.length} have to hit, which the model puts at about ${pctStr(combinedProb)}` +
    (combinedProb < 0.1 ? " — a long shot, priced like one" : "") +
    `. The weakest link is ${weakest.label} at ${pctStr(weakest.prob)}.`
  );
}

function makeBuilds(pool: BuildLeg[], kind: "game" | "prop", window: "today" | "week", mode: BuildMode = "confidence"): Build[] {
  // Preferred-band legs first, then fill-in legs; within each, ordered by the mode.
  const score = (l: BuildLeg) => sortScore(mode, { trust: l.trust, chance: l.prob, price: l.priceAmerican });
  const sorted = [...pool].sort((a, b) => Number(b.preferred) - Number(a.preferred) || score(b) - score(a) || b.prob - a.prob);
  const picked: BuildLeg[] = [];
  const used = new Set<string>();
  for (const leg of sorted) {
    if (used.has(leg.teamKey)) continue;
    used.add(leg.teamKey);
    picked.push(leg);
    if (picked.length >= 8) break;
  }
  const out: Build[] = [];
  for (const size of BUILD_SIZES) {
    if (picked.length < size) break;
    const legs = picked.slice(0, size);
    const { combinedProb, decimal, american } = combine(legs);
    out.push({
      size,
      legs,
      combinedProb,
      americanOdds: american,
      payoutPer10: Math.round(10 * decimal * 100) / 100,
      weakest: legs.reduce((w, l) => (l.prob < w.prob ? l : w)),
      summary: summarize(legs, combinedProb, kind, window, mode),
      usesFairPrices: legs.some((l) => l.priceSource === "fair"),
      trust: parlayTrust(legs.map((l) => ({ tier: l.trust.tier, prob: l.prob }))),
    });
  }
  return out;
}

// ---------- NFL game legs ----------

function nflSeason() {
  const now = new Date();
  return now.getMonth() >= 1 ? now.getFullYear() : now.getFullYear() - 1;
}

const NFL_FACTORS: { key: string; label: string; good: string }[] = [
  { key: "schemeOffAdjPct", label: "Offense", good: "moves the ball better (expected points added per game)" },
  { key: "schemeDefAdjPct", label: "Defense", good: "allows fewer expected points" },
  { key: "turnoverAdjPct", label: "Turnovers", good: "wins the turnover battle more often" },
  { key: "trenchesAdjPct", label: "Trenches", good: "gets more pressure and allows fewer sacks" },
  { key: "pressureAdjPct", label: "Pass rush", good: "creates more pressure and protects its QB better (PFR)" },
  { key: "ngsSeparationAdjPct", label: "Receivers", good: "gets receivers more open (Next Gen Stats separation)" },
  { key: "penaltyAdjPct", label: "Discipline", good: "commits fewer penalties" },
  { key: "fpiAdjPct", label: "ESPN FPI", good: "rates higher in ESPN's power index" },
  { key: "qbrAdjPct", label: "QB play", good: "has the better quarterback rating (ESPN QBR)" },
  { key: "injuryAdjPct", label: "Injuries", good: "is healthier on this week's injury report" },
  { key: "restTravelAdjPct", label: "Rest/travel", good: "has the rest or travel edge" },
  { key: "weatherAdjPct", label: "Weather", good: "is better suited to the forecast" },
  { key: "refAdjPct", label: "Officials", good: "fares better with this referee crew historically" },
];

async function nflGameLegs(window: "today" | "week"): Promise<BuildLeg[]> {
  const season = nflSeason();
  const upcoming = await db
    .select()
    .from(games)
    .where(and(eq(games.season, season), eq(games.isFinal, false)));
  if (upcoming.length === 0) return [];
  const week = activeWeekOf(upcoming);
  if (week === null) return [];
  const today = etDate(new Date());
  const slate = upcoming.filter(
    (g) =>
      g.week === week &&
      g.homeWinPctPre !== null &&
      (window === "week" || (g.kickoffAt && etDate(g.kickoffAt) === today)) &&
      (!g.kickoffAt || g.kickoffAt.getTime() > Date.now())
  );

  const metricRows = await db
    .select()
    .from(teamMetrics)
    .where(eq(teamMetrics.season, season))
    .orderBy(desc(teamMetrics.week));
  const metrics = new Map<string, (typeof metricRows)[number]>();
  for (const m of metricRows) if (!metrics.has(m.team)) metrics.set(m.team, m);

  const legs: BuildLeg[] = [];
  for (const g of slate) {
    const pHome = g.homeWinPctPre!;
    const homeFav = pHome >= 0.5;
    const prob = homeFav ? pHome : 1 - pHome;
    if (!inBand(prob, FILL_MIN_PROB, FILL_MAX_PROB)) continue;
    const preferred = inBand(prob, MIN_GAME_PROB, MAX_GAME_PROB);
    const team = homeFav ? g.homeTeam : g.awayTeam;
    const opp = homeFav ? g.awayTeam : g.homeTeam;
    const sign = homeFav ? 1 : -1;
    const book = homeFav ? g.moneylineHomeOdds : g.moneylineAwayOdds;

    const reasons: string[] = [];
    if (g.eloHomePre !== null && g.eloAwayPre !== null) {
      const mine = homeFav ? g.eloHomePre : g.eloAwayPre;
      const theirs = homeFav ? g.eloAwayPre : g.eloHomePre;
      reasons.push(
        `Power rating: ${team} ${Math.round(mine)} vs ${opp} ${Math.round(theirs)} (${signed(mine - theirs, 0)})` +
          (homeFav ? `, plus home field.` : `, enough to overcome playing on the road.`)
      );
    }
    const mt = metrics.get(team);
    const mo = metrics.get(opp);
    if (mt && mo) {
      reasons.push(`Records: ${team} ${mt.wins}-${mt.losses} vs ${opp} ${mo.wins}-${mo.losses}.`);
    }
    const contributions = NFL_FACTORS.map((f) => ({
      f,
      v: ((g as unknown as Record<string, number | null>)[f.key] ?? 0) * sign,
    }))
      .filter((c) => Math.abs(c.v) >= 0.002)
      .sort((a, b) => b.v - a.v);
    for (const c of contributions.filter((c) => c.v > 0).slice(0, 3)) {
      reasons.push(`${c.f.label}: ${team} ${c.f.good} (${signed(c.v * 100)} pts to its win chance).`);
    }
    const against = contributions.filter((c) => c.v < 0).sort((a, b) => a.v - b.v)[0];
    if (against) {
      reasons.push(`Working against it: ${against.f.label.toLowerCase()} (${signed(against.v * 100)} pts), not enough to flip the pick.`);
    }
    if (book !== null) {
      const implied = book > 0 ? 100 / (book + 100) : -book / (-book + 100);
      const edge = prob - implied;
      reasons.push(
        `Book price ${book > 0 ? "+" : ""}${book} implies ${pctStr(implied)}; the model says ${pctStr(prob)}` +
          (edge > 0.02 ? ` — a ${signed(edge * 100)} pt edge.` : edge < -0.02 ? `, so the price is already short.` : `.`)
      );
    }
    reasons.push(`Model chance to win: ${pctStr(prob)}.`);

    legs.push({
      id: `nfl-${g.id}`,
      sportKey: "nfl",
      preferred,
      sport: "NFL",
      kind: "game",
      label: `${team} to win`,
      matchup: `${g.awayTeam} @ ${g.homeTeam}`,
      startsAt: g.kickoffAt ? g.kickoffAt.toISOString() : null,
      prob,
      priceAmerican: book ?? probToFairAmerican(prob),
      priceSource: book !== null ? "book" : "fair",
      reasons,
      teamKey: `nfl-${g.id}`,
      trust: gameTrust(prob, book !== null),
    });
  }
  return legs;
}

// ---------- other sports' game legs ----------

async function otherSportGameLegs(window: "today" | "week"): Promise<BuildLeg[]> {
  const legs: BuildLeg[] = [];
  const today = etDate(new Date());
  for (const sport of OTHER_SPORTS) {
    const def = SPORTS[sport];
    const season = currentSeasonYear(sport);
    const upcoming = await db
      .select()
      .from(sportGames)
      .where(and(eq(sportGames.sport, sport), eq(sportGames.season, season), eq(sportGames.isFinal, false)));
    if (upcoming.length === 0) continue;
    const week = activeWeekOf(upcoming);
    if (week === null) continue;
    const weekIds = new Set(
      (def.hasRealWeeks ? upcoming.filter((g) => g.week === week) : thisWeekOrNext(upcoming)).map((g) => g.id)
    );
    const slate = upcoming.filter(
      (g) =>
        g.homeWinPctPre !== null &&
        (window === "week" ? weekIds.has(g.id) : g.kickoffAt && etDate(g.kickoffAt) === today) &&
        (!g.kickoffAt || g.kickoffAt.getTime() > Date.now())
    );
    if (slate.length === 0) continue;

    const metricRows = await db
      .select()
      .from(sportTeamMetrics)
      .where(and(eq(sportTeamMetrics.sport, sport), eq(sportTeamMetrics.season, season)))
      .orderBy(desc(sportTeamMetrics.week));
    const metrics = new Map<string, (typeof metricRows)[number]>();
    for (const m of metricRows) if (!metrics.has(m.team)) metrics.set(m.team, m);

    for (const g of slate) {
      const pHome = g.homeWinPctPre!;
      const homeFav = pHome >= 0.5;
      const prob = homeFav ? pHome : 1 - pHome;
      if (!inBand(prob, FILL_MIN_PROB, FILL_MAX_PROB)) continue;
    const preferred = inBand(prob, MIN_GAME_PROB, MAX_GAME_PROB);
      const team = homeFav ? g.homeTeam : g.awayTeam;
      const opp = homeFav ? g.awayTeam : g.homeTeam;
      const book = homeFav ? g.moneylineHomeOdds : g.moneylineAwayOdds;
      const reasons: string[] = [];
      if (g.eloHomePre !== null && g.eloAwayPre !== null) {
        const mine = homeFav ? g.eloHomePre : g.eloAwayPre;
        const theirs = homeFav ? g.eloAwayPre : g.eloHomePre;
        reasons.push(
          `Power rating: ${team} ${Math.round(mine)} vs ${opp} ${Math.round(theirs)} (${signed(mine - theirs, 0)})` +
            (g.neutralSite ? " on a neutral site." : homeFav ? ", plus home court/field." : ", even on the road.")
        );
      }
      const mt = metrics.get(team);
      const mo = metrics.get(opp);
      if (mt && mo) {
        reasons.push(`Records: ${team} ${mt.wins}-${mt.losses} vs ${opp} ${mo.wins}-${mo.losses}.`);
        const ft = (mt.factors ?? {}) as { avgDifferential?: number | null; streak?: number };
        const fo = (mo.factors ?? {}) as { avgDifferential?: number | null; streak?: number };
        if (typeof ft.avgDifferential === "number" && typeof fo.avgDifferential === "number") {
          const unit = sport === "mlb" ? "runs" : sport === "nhl" ? "goals" : "points";
          reasons.push(
            `Scoring margin: ${team} ${signed(ft.avgDifferential)} ${unit}/game vs ${opp} ${signed(fo.avgDifferential)}.`
          );
        }
        if (typeof ft.streak === "number" && Math.abs(ft.streak) >= 3) {
          reasons.push(`${team} is on a ${Math.abs(ft.streak)}-game ${ft.streak > 0 ? "winning" : "losing"} streak.`);
        }
        const venue = homeFav ? mt.homeWinPct : mt.roadWinPct;
        if (venue !== null) {
          reasons.push(`${team} wins ${pctStr(venue)} of its ${homeFav ? "home" : "road"} games.`);
        }
      }
      if (g.restDaysHome !== null && g.restDaysAway !== null) {
        const mine = homeFav ? g.restDaysHome : g.restDaysAway;
        const theirs = homeFav ? g.restDaysAway : g.restDaysHome;
        if (mine !== theirs) {
          reasons.push(
            mine > theirs
              ? `Rest: ${team} has ${mine} day(s) off vs ${theirs} for ${opp}.`
              : `Rest works against it (${mine} vs ${theirs} days), already priced into the model.`
          );
        }
      }
      reasons.push(`Model chance to win: ${pctStr(prob)}.`);
      legs.push({
        id: `${sport}-${g.id}`,
        sportKey: sport,
        preferred,
        sport: def.label === "College Football" ? "NCAAF" : def.label === "College Basketball" ? "NCAAB" : def.label,
        kind: "game",
        label: `${team} to win`,
        matchup: `${g.awayTeam} @ ${g.homeTeam}`,
        startsAt: g.kickoffAt ? g.kickoffAt.toISOString() : null,
        prob,
        priceAmerican: book ?? probToFairAmerican(prob),
        priceSource: book !== null ? "book" : "fair",
        reasons,
        teamKey: `${sport}-${g.id}`,
        trust: gameTrust(prob, book !== null),
      });
    }
  }
  return legs;
}

// ---------- player prop legs ----------

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const impliedOf = (a: number) => (a < 0 ? -a / (-a + 100) : 100 / (a + 100));

/**
 * Real sportsbook prices for NFL touchdown props this week: the best "Yes"
 * price and the books' average no-vig chance (one-sided books less a typical
 * 4.5% margin). Pick'em apps and the model's own fair line are left out.
 */
async function nflTdBookPrices(season: number, week: number): Promise<Map<string, { price: number; book: string; market: number }>> {
  const raw = await db
    .select({ player: propLinesRaw.player, statType: propLinesRaw.statType, side: propLinesRaw.side, book: propLinesRaw.book, price: propLinesRaw.priceAmerican })
    .from(propLinesRaw)
    .where(and(eq(propLinesRaw.season, season), eq(propLinesRaw.week, week), inArray(propLinesRaw.statType, ["Anytime TD", "2+ TDs"])));
  const by = new Map<string, Map<string, { yes?: number; no?: number }>>();
  for (const r of raw) {
    if (r.price == null || r.book === MODEL_FAIR_BOOK || PICKEM_BOOKS.has(r.book)) continue;
    const k = `${norm(r.player)}|${r.statType}`;
    const books = by.get(k) ?? by.set(k, new Map()).get(k)!;
    const b = books.get(r.book) ?? {};
    if (/^(yes|over)$/i.test(r.side)) b.yes = r.price;
    else if (/^(no|under)$/i.test(r.side)) b.no = r.price;
    books.set(r.book, b);
  }
  const out = new Map<string, { price: number; book: string; market: number }>();
  for (const [k, books] of by) {
    let best: { price: number; book: string } | null = null;
    const chances: number[] = [];
    for (const [book, b] of books) {
      if (b.yes === undefined) continue;
      if (!best || b.yes > best.price) best = { price: b.yes, book };
      const y = impliedOf(b.yes);
      chances.push(b.no !== undefined ? y / (y + impliedOf(b.no)) : y / 1.045);
    }
    if (!best || chances.length === 0) continue;
    const market = Math.min(0.97, Math.max(0.03, chances.reduce((a, c) => a + c, 0) / chances.length));
    out.set(k, { ...best, market });
  }
  return out;
}

async function propLegs(window: "today" | "week"): Promise<BuildLeg[]> {
  const legs: BuildLeg[] = [];
  const today = etDate(new Date());

  // NFL: model + live book props for the current week.
  const season = nflSeason();
  const upcoming = await db
    .select()
    .from(games)
    .where(and(eq(games.season, season), eq(games.isFinal, false)));
  if (upcoming.length > 0) {
    const week = activeWeekOf(upcoming) ?? -1;
    const weekGames = upcoming.filter((g) => g.week === week);
    const gameByTeam = new Map<string, (typeof weekGames)[number]>();
    for (const g of weekGames) {
      gameByTeam.set(g.homeTeam, g);
      gameByTeam.set(g.awayTeam, g);
    }
    const rows = await db
      .select()
      .from(oddsLines)
      .where(and(eq(oddsLines.season, season), eq(oddsLines.week, week)));
    const tdBooks = await nflTdBookPrices(season, week);
    const propWeight = weightFor(await getModelWeights().catch(() => ({})), "prop:nfl");
    for (const r of rows) {
      if (!r.player || !r.team || !r.statType || r.line === null) continue;
      const g = gameByTeam.get(r.team);
      if (!g) continue;
      if (g.kickoffAt && g.kickoffAt.getTime() <= Date.now()) continue;
      if (window === "today" && !(g.kickoffAt && etDate(g.kickoffAt) === today)) continue;
      const isModelOnly = r.source === "MODEL" || r.priceAmerican === null;
      const td = isTd(r.statType);
      let prob = r.modelWinPct ?? (isModelOnly ? r.edgePct : null);
      // Touchdown props: blend the model with the books' own price when books post one.
      const tdBook = td ? tdBooks.get(`${norm(r.player)}|${r.statType}`) : undefined;
      const modelProb = prob;
      if (prob !== null && tdBook) prob = blendPropChance(prob, tdBook.market, propWeight);
      if (prob === null || !inBand(prob, td ? TD_FILL_MIN_PROB : FILL_MIN_PROB, FILL_MAX_PROB)) continue;
      const preferred = inBand(prob, td ? TD_MIN_PROB : MIN_PROP_PROB, MAX_PROP_PROB);
      const opp = g.homeTeam === r.team ? g.awayTeam : g.homeTeam;
      const reasons: string[] = [];
      const statLabel =
        r.statType === "Anytime TD" ? "anytime touchdown" : r.statType === "2+ TDs" ? "2+ touchdowns" : r.statType;
      if (r.projection !== null) {
        reasons.push(
          r.line === 0.5 && isModelOnly
            ? `${r.player} averages ${r.projection.toFixed(2)} per game this season in this category (${statLabel}).`
            : `Projection: ${r.projection.toFixed(1)} vs a line of ${r.line} — ${signed(r.projection - r.line)} ${r.side === "Under" ? "under" : "over"} the number.`
        );
      }
      reasons.push(`Matchup: ${r.team} vs ${opp}${g.homeTeam === r.team ? " at home" : " on the road"}.`);
      if (tdBook) {
        reasons.push(
          `Best price ${tdBook.price > 0 ? "+" : ""}${tdBook.price} at ${tdBook.book}. The books put it at ${pctStr(tdBook.market)}, the model at ${pctStr(modelProb ?? prob)}; combined: ${pctStr(prob)}.`
        );
      } else if (!isModelOnly && r.priceAmerican !== null) {
        const implied = r.impliedProbPct !== null ? r.impliedProbPct / 100 : null;
        reasons.push(
          `${r.book ?? "Book"} price ${r.priceAmerican > 0 ? "+" : ""}${r.priceAmerican}` +
            (implied !== null ? ` implies ${pctStr(implied)}; the model says ${pctStr(prob)}.` : ".")
        );
      } else {
        reasons.push(`No book line synced yet, so this uses the model's fair price. Check your book's real price before betting.`);
      }
      reasons.push(`Model chance this hits: ${pctStr(prob)}.`);
      const label =
        r.statType === "Anytime TD"
          ? `${r.player} anytime TD`
          : r.line === 0.5 && isModelOnly
            ? `${r.player} ${statLabel}`
            : `${r.player} ${r.side} ${r.line} ${r.statType}`;
      legs.push({
        id: `nflprop-${r.id}`,
        sportKey: "nfl",
        preferred,
        sport: "NFL",
        kind: "prop",
        label,
        matchup: `${g.awayTeam} @ ${g.homeTeam}`,
        startsAt: g.kickoffAt ? g.kickoffAt.toISOString() : null,
        prob,
        priceAmerican: tdBook ? tdBook.price : !isModelOnly && r.priceAmerican !== null ? r.priceAmerican : probToFairAmerican(prob),
        priceSource: tdBook || (!isModelOnly && r.priceAmerican !== null) ? "book" : "fair",
        reasons,
        teamKey: `nfl-${r.team}`,
        stat: r.statType,
        trust: tdBook
          ? { ...modelOnlyTrust(prob), tier: "Medium", reasons: ["Model blended with real sportsbook prices"] }
          : !isModelOnly && r.trust
            ? (r.trust as Trust)
            : modelOnlyTrust(prob),
      });
    }
  }

  // Other sports: live-book props the model has an edge on (needs odds keys).
  for (const sport of OTHER_SPORTS) {
    const s = currentSeasonYear(sport);
    const upcomingS = await db
      .select()
      .from(sportGames)
      .where(and(eq(sportGames.sport, sport), eq(sportGames.season, s), eq(sportGames.isFinal, false)));
    if (upcomingS.length === 0) continue;
    const week = activeWeekOf(upcomingS);
    if (week === null) continue;
    const weekGames = SPORTS[sport].hasRealWeeks ? upcomingS.filter((g) => g.week === week) : thisWeekOrNext(upcomingS);
    const gameByTeam = new Map<string, (typeof weekGames)[number]>();
    for (const g of weekGames) {
      gameByTeam.set(g.homeTeam, g);
      gameByTeam.set(g.awayTeam, g);
    }
    const teams = Array.from(gameByTeam.keys());
    if (teams.length === 0) continue;
    const rows = await db
      .select()
      .from(sportOddsLines)
      .where(and(eq(sportOddsLines.sport, sport), eq(sportOddsLines.season, s), eq(sportOddsLines.week, week), inArray(sportOddsLines.team, teams)));
    for (const r of rows) {
      const g = r.team ? gameByTeam.get(r.team) : undefined;
      if (!g || r.modelWinPct === null) continue;
      if (g.kickoffAt && g.kickoffAt.getTime() <= Date.now()) continue;
      if (window === "today" && !(g.kickoffAt && etDate(g.kickoffAt) === today)) continue;
      const prob = r.modelWinPct;
      if (!inBand(prob, FILL_MIN_PROB, FILL_MAX_PROB)) continue;
      const preferred = inBand(prob, MIN_PROP_PROB, MAX_PROP_PROB);
      const reasons: string[] = [];
      if (r.projection !== null) {
        reasons.push(`Projection: ${r.projection.toFixed(1)} vs a line of ${r.line} (${signed(r.projection - r.line)}).`);
      }
      reasons.push(
        `${r.book} price ${r.priceAmerican > 0 ? "+" : ""}${r.priceAmerican}` +
          (r.impliedProbPct !== null ? ` implies ${pctStr(r.impliedProbPct / 100)}; the model says ${pctStr(prob)}.` : ".")
      );
      reasons.push(`Model chance this hits: ${pctStr(prob)}.`);
      legs.push({
        id: `${sport}prop-${r.id}`,
        sportKey: sport,
        preferred,
        sport: sport === "ncaaf" ? "NCAAF" : sport === "ncaab" ? "NCAAB" : SPORTS[sport].label,
        kind: "prop",
        label: `${r.player} ${r.side} ${r.line} ${r.statType}`,
        matchup: `${g.awayTeam} @ ${g.homeTeam}`,
        startsAt: g.kickoffAt ? g.kickoffAt.toISOString() : null,
        prob,
        priceAmerican: r.priceAmerican,
        priceSource: "book",
        reasons,
        teamKey: `${sport}-${r.team}`,
        stat: r.statType,
        trust: (r.trust as Trust | null) ?? modelOnlyTrust(prob),
      });
    }
  }
  return legs;
}

/** Today's or this week's best builds, 2 to 8 legs, for game picks and for player props. */
export type BuildSportFilter = "all" | "nfl" | SportKey;

// The builds are the same for everyone, and building them runs dozens of
// queries, so each server instance keeps a result for 2 minutes (and shares
// one in-flight build between simultaneous requests). Keeps the database
// pooler from running out of connections when several people load Parlays.
const BUILD_TTL_MS = 120_000;
const buildCache = new Map<string, { at: number; value: Promise<BuildSet> }>();

export function getModelBuilds(window: "today" | "week", filter: BuildSportFilter = "all"): Promise<BuildSet> {
  const key = `${window}|${filter}`;
  const hit = buildCache.get(key);
  if (hit && Date.now() - hit.at < BUILD_TTL_MS) return hit.value;
  const value = computeModelBuilds(window, filter);
  buildCache.set(key, { at: Date.now(), value });
  value.catch(() => buildCache.delete(key));
  return value;
}

async function computeModelBuilds(window: "today" | "week", filter: BuildSportFilter): Promise<BuildSet> {
  const [nfl, others, allProps] = await Promise.all([
    filter === "all" || filter === "nfl" ? nflGameLegs(window) : Promise.resolve([]),
    filter === "nfl" ? Promise.resolve([]) : otherSportGameLegs(window),
    propLegs(window),
  ]);
  const keep = (l: BuildLeg) => filter === "all" || l.sportKey === filter;
  const gamePool = [...nfl, ...others].filter(keep);
  const allStatProps = allProps.filter(keep);
  // All-stats parlays use the usual floor; one-stat parlays (e.g. Anytime TD) use each stat's own band.
  const props = allStatProps.filter((l) => l.prob >= FILL_MIN_PROB);
  const statCounts = new Map<string, number>();
  for (const l of allStatProps) if (l.stat) statCounts.set(l.stat, (statCounts.get(l.stat) ?? 0) + 1);
  const stats = [...statCounts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => Number(b[0] === "Anytime TD") - Number(a[0] === "Anytime TD") || b[1] - a[1])
    .map(([stat, legs]) => ({ stat, legs }));
  const variants = Object.fromEntries(
    (["confidence", "chance", "price"] as const).map((m) => [
      m,
      {
        parlays: makeBuilds(gamePool, "game", window, m),
        props: makeBuilds(props, "prop", window, m),
        propsByStat: Object.fromEntries(
          stats.map(({ stat }) => [stat, makeBuilds(allStatProps.filter((l) => l.stat === stat), "prop", window, m)])
        ),
      },
    ])
  ) as BuildSet["variants"];
  return {
    window,
    parlays: variants.confidence.parlays,
    props: variants.confidence.props,
    variants,
    propStats: stats,
    gameLegPool: gamePool.length,
    propLegPool: props.length,
  };
}
