// The model's report card, every sport (Results page).
//
// Two records, kept apart on purpose:
//   LIVE: games whose pre-game number was locked before kickoff (extra.locked
//     for other sports, locked_pct for NFL). That's the honest track record.
//   REBUILT: every final game this and last season scored with the model's
//     pre-game inputs, including games from before locking existed. It uses
//     only information from before each game, but the model itself was tuned
//     on these seasons, so it reads a little better than a true live record.
import { streaks, type StreakSummary } from "./streaks";
import { db } from "@/db";
import { games, sportGames } from "@/db/schema";
import { and, eq, inArray, ne } from "drizzle-orm";
import { SPORTS, PRESEASON, type SportKey } from "./sports/types";
import { currentSeasonYear } from "./sports/espn";
import { noVigHome, consensusHome } from "./sports/game-model";

export interface Graded {
  p: number; // model's pre-game home chance
  won: 0 | 1; // home won
  book: number | null; // market's pre-game home chance
  openMarket?: number | null;
  openModel?: number | null;
  closeMarket?: number | null;
}

export interface Card {
  n: number;
  correct: number;
  pct: number | null;
  brier: number | null;
  logLoss: number | null;
  bookN: number;
  bookCorrect: number;
  /** Same games, model vs book favorite (only games with a line). */
  modelOnBookGames: number;
  clvGames: number;
  clvToward: number;
  clvAvgPts: number | null;
}

export interface Bucket {
  label: string;
  n: number;
  predicted: number;
  actual: number;
}

export interface SportResults {
  key: string;
  label: string;
  live: Card;
  rebuilt: Card;
  calibration: Bucket[]; // rebuilt set (bigger sample)
  liveSince: string | null;
  /** Streaks of the live pre-game picks (right/wrong), in kickoff order. */
  streak: StreakSummary;
}

/** Live picks in kickoff order -> streak summary (labels are dates). */
function pickStreaks(rows: { t: number; p: number; won: 0 | 1 }[]): StreakSummary {
  const sorted = [...rows].sort((a, b) => a.t - b.t);
  return streaks(
    sorted.map((r) => ({ win: (r.p > 0.5 ? 1 : 0) === r.won, label: r.t ? new Date(r.t).toISOString().slice(0, 10) : undefined })),
    8
  );
}

const clampP = (p: number) => Math.min(0.999, Math.max(0.001, p));

export function scoreCard(rows: Graded[]): Card {
  let correct = 0;
  let brier = 0;
  let ll = 0;
  let bookN = 0;
  let bookCorrect = 0;
  let modelOnBook = 0;
  let clvGames = 0;
  let clvToward = 0;
  let clvSum = 0;
  for (const r of rows) {
    const pick = r.p > 0.5 ? 1 : 0;
    if (pick === r.won) correct++;
    brier += (r.p - r.won) ** 2;
    ll -= r.won * Math.log(clampP(r.p)) + (1 - r.won) * Math.log(1 - clampP(r.p));
    if (r.book != null && r.book !== 0.5) {
      bookN++;
      if ((r.book > 0.5 ? 1 : 0) === r.won) bookCorrect++;
      if (pick === r.won) modelOnBook++;
    }
    if (r.openMarket != null && r.openModel != null && r.closeMarket != null) {
      const lean = r.openModel - r.openMarket;
      if (Math.abs(lean) >= 0.02) {
        const move = (r.closeMarket - r.openMarket) * Math.sign(lean);
        clvGames++;
        if (move > 0) clvToward++;
        clvSum += move;
      }
    }
  }
  const n = rows.length;
  return {
    n,
    correct,
    pct: n ? (correct / n) * 100 : null,
    brier: n ? brier / n : null,
    logLoss: n ? ll / n : null,
    bookN,
    bookCorrect,
    modelOnBookGames: modelOnBook,
    clvGames,
    clvToward,
    clvAvgPts: clvGames ? (clvSum / clvGames) * 100 : null,
  };
}

/** Predicted vs actual, by how sure the model was of its pick. */
export function calibration(rows: Graded[]): Bucket[] {
  const edges = [
    [0.5, 0.55],
    [0.55, 0.6],
    [0.6, 0.65],
    [0.65, 0.7],
    [0.7, 0.8],
    [0.8, 1.01],
  ];
  return edges
    .map(([lo, hi]) => {
      const inB = rows.filter((r) => {
        const c = Math.max(r.p, 1 - r.p);
        return c >= lo && c < hi;
      });
      const predicted = inB.reduce((s, r) => s + Math.max(r.p, 1 - r.p), 0) / Math.max(1, inB.length);
      const actual = inB.filter((r) => (r.p > 0.5 ? 1 : 0) === r.won).length / Math.max(1, inB.length);
      return { label: hi > 1 ? `${Math.round(lo * 100)}%+` : `${Math.round(lo * 100)}–${Math.round(hi * 100)}%`, n: inB.length, predicted, actual };
    })
    .filter((b) => b.n > 0);
}

type SgRow = typeof sportGames.$inferSelect;
interface SgExtra {
  locked?: { pct: number; market: number | null; at?: string };
  opening?: { market: number | null; modelOnly: number | null };
  odds?: Record<string, { mlHome: number | null; mlAway: number | null } | undefined>;
  oddsUpdatedAt?: string;
  preview?: { espnOdds?: { mlHome: number; mlAway: number } | null; espnOddsAt?: string | null };
}

function sportGraded(g: SgRow): { live: Graded | null; rebuilt: Graded | null; lockedAt: string | null } {
  if (g.homeScore === null || g.awayScore === null || g.homeScore === g.awayScore) return { live: null, rebuilt: null, lockedAt: null };
  const ex = (g.extra ?? {}) as SgExtra;
  const won = (g.homeScore > g.awayScore ? 1 : 0) as 0 | 1;
  const start = g.kickoffAt?.getTime() ?? 0;
  const pre = (at: string | null | undefined) => !!at && Date.parse(at) < start;
  const book =
    ex.locked?.market ??
    (pre(ex.oddsUpdatedAt) && ex.odds ? (consensusHome(ex.odds)?.pct ?? null) : null) ??
    (pre(ex.preview?.espnOddsAt) ? noVigHome(ex.preview?.espnOdds?.mlHome, ex.preview?.espnOdds?.mlAway) : null);
  const rebuiltP = ex.locked?.pct ?? g.homeWinPctPre;
  const base = { won, book, openMarket: ex.opening?.market ?? null, openModel: ex.opening?.modelOnly ?? null, closeMarket: ex.locked?.market ?? null };
  return {
    live: ex.locked ? { ...base, p: ex.locked.pct } : null,
    rebuilt: rebuiltP != null ? { ...base, p: rebuiltP } : null,
    lockedAt: ex.locked?.at ?? null,
  };
}

const OTHER: SportKey[] = ["nba", "wnba", "nhl", "mlb", "ncaaf", "ncaab"];

export async function getResults(): Promise<SportResults[]> {
  const out: SportResults[] = [];

  // NFL: locked_pct (live) and home_win_pct_pre (rebuilt), this and last season.
  const now = new Date();
  const nflSeason = now.getMonth() >= 1 ? now.getFullYear() : now.getFullYear() - 1;
  const nfl = await db
    .select()
    .from(games)
    .where(and(inArray(games.season, [nflSeason - 1, nflSeason]), eq(games.isFinal, true)));
  const nflLive: Graded[] = [];
  const nflRebuilt: Graded[] = [];
  let nflSince: string | null = null;
  const nflSeq: { t: number; p: number; won: 0 | 1 }[] = [];
  for (const g of nfl) {
    if (g.homeScore === null || g.awayScore === null || g.homeScore === g.awayScore) continue;
    const won = (g.homeScore > g.awayScore ? 1 : 0) as 0 | 1;
    const book = g.lockedMarketPct ?? null;
    if (g.lockedPct != null) {
      nflLive.push({ p: g.lockedPct, won, book });
      nflSeq.push({ t: g.kickoffAt?.getTime() ?? 0, p: g.lockedPct, won });
      const at = g.lockedAt?.toISOString() ?? null;
      if (at && (!nflSince || at < nflSince)) nflSince = at;
    }
    const p = g.lockedPct ?? g.homeWinPctPre;
    if (p != null) nflRebuilt.push({ p, won, book });
  }
  out.push({ key: "nfl", label: "NFL", live: scoreCard(nflLive), rebuilt: scoreCard(nflRebuilt), calibration: calibration(nflRebuilt), liveSince: nflSince, streak: pickStreaks(nflSeq) });

  for (const sport of OTHER) {
    const season = currentSeasonYear(sport);
    const rows = await db
      .select()
      .from(sportGames)
      .where(
        and(eq(sportGames.sport, sport), inArray(sportGames.season, [season - 1, season]), eq(sportGames.isFinal, true), ne(sportGames.seasonType, PRESEASON))
      );
    const live: Graded[] = [];
    const rebuilt: Graded[] = [];
    let since: string | null = null;
    const seq: { t: number; p: number; won: 0 | 1 }[] = [];
    for (const g of rows) {
      const r = sportGraded(g);
      if (r.live) {
        live.push(r.live);
        seq.push({ t: g.kickoffAt?.getTime() ?? 0, p: r.live.p, won: r.live.won });
      }
      if (r.rebuilt) rebuilt.push(r.rebuilt);
      if (r.lockedAt && (!since || r.lockedAt < since)) since = r.lockedAt;
    }
    out.push({ key: sport, label: SPORTS[sport].label, live: scoreCard(live), rebuilt: scoreCard(rebuilt), calibration: calibration(rebuilt), liveSince: since, streak: pickStreaks(seq) });
  }
  return out;
}
