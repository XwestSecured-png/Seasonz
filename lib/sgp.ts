// Same-game parlay math. Legs from the same game aren't independent: if a
// QB throws for 300 yards his top receiver probably had a big day too, and
// the game probably went over the total. Multiplying the legs' chances (what
// a regular parlay does) understates how often correlated legs hit together
// and overstates how often legs that work against each other do.
//
// Method: Gaussian copula. Each leg is a hidden bell-curve variable that
// "hits" below its own threshold (set from the leg's chance); the
// variables are correlated with the strengths below, and the chance that
// every leg hits is estimated by simulation.
//
// Correlations were MEASURED, not guessed: game-to-game swings of each
// player's stats against his own recent average, paired with teammates,
// opponents, and the game's result against the closing spread and total.
//   Football: nflverse weekly stats 2018-25 (2,700+ team-games).
//   Basketball: every NBA (2,627) and WNBA (656) game of 2025-26.
// Hockey and baseball pairings aren't measured yet, so those legs are
// treated as independent. See scripts/backtest-game-model/README.md.
//
// Client-safe: no server imports.

export type SgpSport = "football" | "basketball" | "other";

export interface SgpLeg {
  /** Same value for legs in the same game. */
  gameKey: string;
  kind: "ml" | "spread" | "total" | "prop";
  /** ML/spread: the team backed. Prop: the player's team. */
  team?: string;
  /** Total: "Over" | "Under". Prop: "Over" | "Under" | "Yes" | "No". */
  side?: string;
  player?: string;
  statType?: string;
  /** The game's two teams (needed to tell "own team" from "opponent"). */
  homeTeam?: string;
  awayTeam?: string;
  /** This leg's own chance of hitting. */
  prob: number;
}

// --- Stat families -----------------------------------------------------------
type FbFam = "passYds" | "passTD" | "int" | "rushYds" | "recYds" | "anyTD" | "other";
function footballFamily(stat: string): FbFam {
  if (/^(Pass Yds|Pass \+ Rush Yds|Completions|Pass Attempts|Longest Completion)$/.test(stat)) return "passYds";
  if (stat === "Pass TDs") return "passTD";
  if (/^INTs? Thrown$/.test(stat)) return "int";
  if (/^(Rush Yds|Rush Attempts|Longest Rush|Rush \+ Rec Yds)$/.test(stat)) return "rushYds";
  if (/^(Rec Yds|Receptions|Longest Reception)$/.test(stat)) return "recYds";
  if (/TD/.test(stat)) return "anyTD";
  return "other";
}
type BbFam = "PTS" | "REB" | "AST" | "3PM" | "STL" | "BLK" | "TO" | "PRA" | "other";
function basketballFamily(stat: string): BbFam {
  switch (stat) {
    case "Points":
      return "PTS";
    case "Rebounds":
      return "REB";
    case "Assists":
      return "AST";
    case "3-Pointers Made":
      return "3PM";
    case "Steals":
      return "STL";
    case "Blocks":
      return "BLK";
    case "Turnovers":
      return "TO";
    case "Pts+Reb+Ast":
    case "Pts+Reb":
    case "Pts+Ast":
    case "Reb+Ast":
      return "PRA";
    default:
      return "other";
  }
}

const pairKey = (a: string, b: string) => (a < b ? `${a}~${b}` : `${b}~${a}`);

// Same player, two stats (measured).
const FB_SAME: Record<string, number> = {
  [pairKey("passYds", "passTD")]: 0.47,
  [pairKey("passYds", "int")]: 0.08,
  [pairKey("passTD", "int")]: 0.05,
  [pairKey("rushYds", "anyTD")]: 0.37,
  [pairKey("recYds", "anyTD")]: 0.32,
  [pairKey("rushYds", "recYds")]: 0.1,
  [pairKey("passYds", "rushYds")]: 0.05,
  [pairKey("passTD", "anyTD")]: 0.05,
};
// Same family on the same player (e.g. Rec Yds + Receptions, Rush Yds + Rush Attempts).
const FB_SAME_FAMILY = 0.75;
// Teammates.
const FB_MATE: Record<string, number> = {
  [pairKey("passYds", "recYds")]: 0.41,
  [pairKey("passTD", "anyTD")]: 0.36,
  [pairKey("passYds", "anyTD")]: 0.2,
  [pairKey("passTD", "recYds")]: 0.3,
  [pairKey("passYds", "rushYds")]: -0.12,
};
// Opponents (shootouts).
const FB_OPP: Record<string, number> = { [pairKey("passYds", "passYds")]: 0.1, [pairKey("passTD", "passTD")]: 0.1 };
// Player stat vs. his own team covering / winning, and vs. the game going over.
const FB_COVER: Partial<Record<FbFam, number>> = { rushYds: 0.28, anyTD: 0.25, recYds: 0.06, passYds: 0.08, passTD: 0.1 };
const FB_WIN: Partial<Record<FbFam, number>> = { rushYds: 0.25, anyTD: 0.22, recYds: 0.04, passYds: 0.04, passTD: 0.08 };
const FB_TOTAL: Partial<Record<FbFam, number>> = { passYds: 0.34, passTD: 0.49, rushYds: 0.08, recYds: 0.19, anyTD: 0.21 };

const BB_SAME: Record<string, number> = {
  [pairKey("PTS", "REB")]: 0.24,
  [pairKey("PTS", "AST")]: 0.12,
  [pairKey("PTS", "3PM")]: 0.64,
  [pairKey("PTS", "STL")]: 0.13,
  [pairKey("PTS", "BLK")]: 0.08,
  [pairKey("PTS", "TO")]: 0.08,
  [pairKey("PTS", "PRA")]: 0.9,
  [pairKey("REB", "AST")]: 0.16,
  [pairKey("REB", "3PM")]: 0.07,
  [pairKey("REB", "BLK")]: 0.12,
  [pairKey("REB", "TO")]: 0.12,
  [pairKey("REB", "PRA")]: 0.55,
  [pairKey("AST", "3PM")]: 0.07,
  [pairKey("AST", "STL")]: 0.1,
  [pairKey("AST", "TO")]: 0.06,
  [pairKey("AST", "PRA")]: 0.4,
  [pairKey("3PM", "PRA")]: 0.55,
  [pairKey("STL", "PRA")]: 0.15,
  [pairKey("BLK", "PRA")]: 0.11,
  [pairKey("TO", "PRA")]: 0.11,
};
const BB_SAME_FAMILY = 0.8; // e.g. Pts+Reb and Pts+Reb+Ast
const BB_MATE: Record<string, number> = { [pairKey("PTS", "AST")]: 0.11, [pairKey("PRA", "PRA")]: 0.07, [pairKey("AST", "PRA")]: 0.08, [pairKey("PTS", "PRA")]: 0.04 };
const BB_COVER: Partial<Record<BbFam, number>> = { PTS: 0.15, REB: 0.1, AST: 0.13, PRA: 0.18, "3PM": 0.08 };
const BB_WIN: Partial<Record<BbFam, number>> = { PTS: 0.1, REB: 0.07, AST: 0.09, PRA: 0.12, "3PM": 0.05 };
const BB_TOTAL: Partial<Record<BbFam, number>> = { PTS: 0.19, REB: -0.05, AST: 0.14, PRA: 0.17, "3PM": 0.13 };

/** +1 when the leg wins on the stat going UP (Over/Yes), -1 when it wins on it going down. */
const dir = (side?: string) => (side === "Under" || side === "No" ? -1 : 1);

/** Correlation between two legs' "hit" variables. 0 for different games or unmeasured pairings. */
export function legCorrelation(sport: SgpSport, a: SgpLeg, b: SgpLeg): number {
  if (a.gameKey !== b.gameKey || sport === "other") return 0;
  if (a.kind !== "prop" && b.kind !== "prop") {
    // Two team bets in one game: same team's ML and spread move together;
    // spread and total are nearly independent (measured ~0).
    if ((a.kind === "ml" || a.kind === "spread") && (b.kind === "ml" || b.kind === "spread")) {
      if (a.kind === b.kind) return a.team === b.team ? 0.99 : -0.99;
      return a.team === b.team ? 0.75 : -0.75;
    }
    if (a.kind === "total" && b.kind === "total") return a.side === b.side ? 0.99 : -0.99;
    return 0;
  }
  if (a.kind !== "prop") return legCorrelation(sport, b, a);
  // a is a prop from here on.
  const fam = (s?: string) => (sport === "football" ? footballFamily(s ?? "") : basketballFamily(s ?? ""));
  const fa = fam(a.statType);
  if (fa === "other") return 0;
  const da = dir(a.side);

  if (b.kind === "prop") {
    const fb = fam(b.statType);
    if (fb === "other") return 0;
    const db = dir(b.side);
    let r = 0;
    if (a.player && a.player === b.player) {
      if (fa === fb) r = a.statType === b.statType ? 0.95 : sport === "football" ? FB_SAME_FAMILY : BB_SAME_FAMILY;
      else r = (sport === "football" ? FB_SAME : BB_SAME)[pairKey(fa, fb)] ?? 0;
    } else if (a.team && a.team === b.team) {
      r = (sport === "football" ? FB_MATE : BB_MATE)[pairKey(fa, fb)] ?? 0;
    } else {
      r = sport === "football" ? (FB_OPP[pairKey(fa, fb)] ?? 0) : 0;
    }
    return r * da * db;
  }

  // Prop vs. a team bet.
  if (b.kind === "total") {
    const r = (sport === "football" ? FB_TOTAL : BB_TOTAL)[fa as never] ?? 0;
    return r * da * dir(b.side);
  }
  const backsOwnTeam = b.team != null && a.team != null ? (b.team === a.team ? 1 : -1) : 0;
  const table = b.kind === "spread" ? (sport === "football" ? FB_COVER : BB_COVER) : sport === "football" ? FB_WIN : BB_WIN;
  return ((table as Record<string, number>)[fa] ?? 0) * da * backsOwnTeam;
}

// --- Copula ------------------------------------------------------------------
function phiInv(p: number): number {
  // Acklam's rational approximation.
  const q = Math.min(1 - 1e-9, Math.max(1e-9, p));
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (q < lo) {
    const r = Math.sqrt(-2 * Math.log(q));
    return (((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) / ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1);
  }
  if (q > 1 - lo) {
    const r = Math.sqrt(-2 * Math.log(1 - q));
    return -(((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) / ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1);
  }
  const r = q - 0.5;
  const s = r * r;
  return ((((((a[0] * s + a[1]) * s + a[2]) * s + a[3]) * s + a[4]) * s + a[5]) * r) / (((((b[0] * s + b[1]) * s + b[2]) * s + b[3]) * s + b[4]) * s + 1);
}

function cholesky(R: number[][]): number[][] | null {
  const n = R.length;
  const L = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++)
    for (let j = 0; j <= i; j++) {
      let s = R[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) {
        if (s <= 1e-9) return null;
        L[i][i] = Math.sqrt(s);
      } else L[i][j] = s / L[j][j];
    }
  return L;
}

// Small seeded generator so the same slip always shows the same number.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SgpResult {
  /** Chance every leg hits if they were independent (plain multiplication). */
  independent: number;
  /** Chance every leg hits with the measured same-game links. */
  correlated: number;
  /** Number of same-game pairs that are linked (|r| >= 0.05). */
  linkedPairs: number;
  /** Strongest link, for the explanation. */
  strongest: { a: number; b: number; r: number } | null;
}

export function parlayChance(sport: SgpSport, legs: SgpLeg[], samples = 40000): SgpResult {
  const n = legs.length;
  const independent = legs.reduce((p, l) => p * l.prob, 1);
  const R: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  let linkedPairs = 0;
  let strongest: SgpResult["strongest"] = null;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const r = legCorrelation(sport, legs[i], legs[j]);
      R[i][j] = R[j][i] = r;
      if (Math.abs(r) >= 0.05) {
        linkedPairs++;
        if (!strongest || Math.abs(r) > Math.abs(strongest.r)) strongest = { a: i, b: j, r };
      }
    }
  if (linkedPairs === 0) return { independent, correlated: independent, linkedPairs, strongest };

  // Keep the matrix valid (positive definite) by shrinking the links if needed.
  let L = cholesky(R);
  let shrink = 1;
  while (!L && shrink > 0.05) {
    shrink *= 0.9;
    L = cholesky(R.map((row, i) => row.map((v, j) => (i === j ? 1 : v * shrink))));
  }
  if (!L) return { independent, correlated: independent, linkedPairs, strongest };

  const th = legs.map((l) => phiInv(l.prob));
  const rand = rng(n * 7919 + Math.round(independent * 1e6));
  const z = new Array(n).fill(0);
  let hits = 0;
  for (let s = 0; s < samples; s++) {
    // Box-Muller normals
    for (let i = 0; i < n; i += 2) {
      const u1 = Math.max(1e-12, rand());
      const u2 = rand();
      const m = Math.sqrt(-2 * Math.log(u1));
      z[i] = m * Math.cos(2 * Math.PI * u2);
      if (i + 1 < n) z[i + 1] = m * Math.sin(2 * Math.PI * u2);
    }
    let all = true;
    for (let i = 0; i < n && all; i++) {
      let x = 0;
      for (let k = 0; k <= i; k++) x += L[i][k] * z[k];
      if (x > th[i]) all = false;
    }
    if (all) hits++;
  }
  return { independent, correlated: hits / samples, linkedPairs, strongest };
}

/** A leg's chance from its American price, with a typical two-way book margin (about 4.5%) taken out. */
export function chanceFromPrice(american: number, fairPrice = false): number {
  const q = american < 0 ? -american / (-american + 100) : 100 / (american + 100);
  return fairPrice ? q : Math.min(0.99, q / 1.045);
}
