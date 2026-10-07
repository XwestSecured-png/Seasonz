// "What it means" — turns a specific bet into plain English: what has to
// happen for it to win, when it pushes (money back), and what it pays.
// Client-safe (no server imports), so forms can explain a bet live as the
// user builds it.

export type ExplainMarket = "ML" | "SPREAD" | "TOTAL" | "PROP";

export interface ExplainInput {
  market: ExplainMarket;
  /** ML/SPREAD: the team you're backing. PROP: the player. */
  pick?: string | null;
  /** ML/SPREAD: the other team. */
  opponent?: string | null;
  /** TOTAL/PROP: "OVER" | "UNDER" (any case). */
  side?: string | null;
  /** SPREAD: your team's line (e.g. -3.5, +7). TOTAL/PROP: the number. */
  line?: number | null;
  /** The book's main line for the same market and side — if `line` differs, this is an alternate line. */
  mainLine?: number | null;
  /** PROP: the stat, e.g. "Pass Yds", "Receptions". */
  stat?: string | null;
  /** American odds, e.g. -110 or +150. */
  priceAmerican?: number | null;
  stakeUsd?: number | null;
  /** Sport changes the word for points/runs/goals. */
  sport?: string | null;
}

export interface Explanation {
  title: string;
  /** "You win if…" */
  win: string;
  /** "You lose if…" */
  lose: string;
  /** Push rule, or null when a push isn't possible (half-point lines). */
  push: string | null;
  /** "Bet $100 to profit $90.91 ($190.91 back)." */
  payout: string | null;
  /** What the price says about the book's view (implied chance to win). */
  odds: string | null;
  /** Extra note for alternate lines. */
  alternate: string | null;
}

const fmtLine = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const fmtPrice = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const usd = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const isWhole = (n: number) => Math.abs(n - Math.round(n)) < 1e-9;

function unit(sport?: string | null, n = 2): string {
  const s = (sport ?? "").toLowerCase();
  const word = s === "mlb" ? "run" : s === "nhl" ? "goal" : "point";
  return n === 1 ? word : `${word}s`;
}

/** Profit on a winning bet at American odds. */
export function profitFor(stake: number, american: number): number {
  return american > 0 ? (stake * american) / 100 : (stake * 100) / Math.abs(american);
}

/** The book's implied probability for American odds (includes the book's cut). */
export function impliedProb(american: number): number {
  return american > 0 ? 100 / (american + 100) : Math.abs(american) / (Math.abs(american) + 100);
}

function payoutLine(price: number | null | undefined, stake: number | null | undefined): string | null {
  if (price == null || !Number.isFinite(price) || price === 0) return null;
  const s = stake && stake > 0 ? stake : 100;
  const p = profitFor(s, price);
  const lead =
    price < 0
      ? `At ${fmtPrice(price)} you risk more than you win: `
      : `At ${fmtPrice(price)} you win more than you risk: `;
  return `${lead}bet ${usd(s)} to profit ${usd(p)} (${usd(s + p)} back in total, including your stake).`;
}

function oddsLine(price: number | null | undefined): string | null {
  if (price == null || !Number.isFinite(price) || price === 0) return null;
  const pct = Math.round(impliedProb(price) * 100);
  return `The price says the book thinks this hits about ${pct}% of the time. You need to win more often than that to make money long-term.`;
}

/** Explains one bet. Missing details produce gentler, generic wording rather than errors. */
export function explainBet(input: ExplainInput): Explanation {
  const { market, sport } = input;
  const pick = input.pick || "your team";
  const opp = input.opponent || "the other team";
  const line = input.line ?? null;
  const payout = payoutLine(input.priceAmerican, input.stakeUsd);
  const odds = oddsLine(input.priceAmerican);
  const isAlt =
    line !== null && input.mainLine != null && Math.abs(line - input.mainLine) > 1e-9 && market !== "ML";

  if (market === "ML") {
    const tie =
      (sport ?? "").toLowerCase() === "nfl"
        ? "If an NFL game ends in a tie, most books refund moneyline bets."
        : null;
    return {
      title: `Moneyline: ${pick} to win`,
      win: `${pick} win the game outright. The final score margin doesn't matter, a 1-${unit(sport, 1)} win counts the same as a blowout.`,
      lose: `${opp} win the game.`,
      push: tie,
      payout,
      odds,
      alternate: null,
    };
  }

  if (market === "SPREAD") {
    if (line === null) {
      return {
        title: `Spread: ${pick}`,
        win: `${pick} beat the spread: the score after adding the line to ${pick}'s points is higher than ${opp}'s.`,
        lose: `${pick} don't cover the spread.`,
        push: null,
        payout,
        odds,
        alternate: null,
      };
    }
    const abs = Math.abs(line);
    let win: string;
    let lose: string;
    let push: string | null = null;
    if (line < 0) {
      // Favorite: must win by more than abs.
      const need = isWhole(abs) ? abs + 1 : Math.ceil(abs);
      win = `${pick} win by ${need} or more ${unit(sport)}.`;
      lose = isWhole(abs)
        ? `${pick} win by fewer than ${abs}, or lose the game.`
        : Math.floor(abs) === 0
          ? `${pick} lose or tie the game.`
          : `${pick} win by ${Math.floor(abs)} or fewer, or lose the game.`;
      if (isWhole(abs)) push = `${pick} win by exactly ${abs}: it's a push and you get your stake back.`;
    } else if (line > 0) {
      // Underdog: can lose by less than abs.
      if (isWhole(abs)) {
        win =
          abs - 1 > 0
            ? `${pick} win the game, or lose by ${abs - 1} or fewer ${unit(sport)}.`
            : `${pick} win the game.`;
        lose = `${pick} lose by more than ${abs}.`;
        push = `${pick} lose by exactly ${abs}: it's a push and you get your stake back.`;
      } else {
        win = `${pick} win the game, or lose by ${Math.floor(abs)} or fewer ${unit(sport)}.`;
        lose = `${pick} lose by ${Math.ceil(abs)} or more.`;
      }
    } else {
      win = `${pick} win the game.`;
      lose = `${opp} win the game.`;
      push = `The game ends in a tie: it's a push and you get your stake back.`;
    }
    return {
      title: `Spread: ${pick} ${fmtLine(line)}`,
      win,
      lose,
      push,
      payout,
      odds,
      alternate: isAlt ? alternateNote(line, input.mainLine!, "SPREAD") : null,
    };
  }

  // TOTAL and PROP: over/under a number.
  const over = (input.side ?? "").toUpperCase() === "OVER";
  const sideWord = over ? "Over" : "Under";
  const what =
    market === "PROP"
      ? `${input.pick || "The player"}'s ${input.stat || "stat"}`
      : `The two teams' combined ${unit(sport)}`;
  if (line === null) {
    return {
      title: market === "PROP" ? `Player prop: ${sideWord}` : `Total: ${sideWord}`,
      win: `${what} finish ${over ? "above" : "below"} the line.`,
      lose: `${what} finish ${over ? "below" : "above"} the line.`,
      push: null,
      payout,
      odds,
      alternate: null,
    };
  }
  const whole = isWhole(line);
  const winAt = over ? (whole ? line + 1 : Math.ceil(line)) : whole ? line - 1 : Math.floor(line);
  const win = over ? `${what} reach ${winAt} or more.` : `${what} stay at ${winAt} or fewer.`;
  const lose = over
    ? `${what} finish at ${whole ? line - 1 : Math.floor(line)} or fewer.`
    : `${what} reach ${whole ? line + 1 : Math.ceil(line)} or more.`;
  const push = whole ? `${what} land on exactly ${line}: it's a push and you get your stake back.` : null;
  const propNote =
    market === "PROP"
      ? " If the player doesn't play, most books void the bet and refund it (check your book's rules)."
      : market === "TOTAL"
        ? " Overtime counts toward the total."
        : "";
  return {
    title:
      market === "PROP"
        ? `Player prop: ${input.pick || "Player"} ${sideWord} ${line} ${input.stat ?? ""}`.trim()
        : `Total: ${sideWord} ${line}`,
    win: win + propNote,
    lose,
    push,
    payout,
    odds,
    alternate: isAlt ? alternateNote(line, input.mainLine!, over ? "OVER" : "UNDER") : null,
  };
}

function alternateNote(line: number, main: number, kind: "SPREAD" | "OVER" | "UNDER"): string {
  // Is the alternate easier or harder to hit than the main line?
  let easier: boolean;
  if (kind === "SPREAD") easier = line > main; // more points given to you = easier
  else if (kind === "OVER") easier = line < main;
  else easier = line > main;
  return easier
    ? `This is an alternate line. The main line is ${kind === "SPREAD" ? fmtLine(main) : main}. You moved it in your favor, so it's easier to win, but it pays less.`
    : `This is an alternate line. The main line is ${kind === "SPREAD" ? fmtLine(main) : main}. You moved it against yourself, so it's harder to win, but it pays more.`;
}

/** Parlay rule in one place, used by the Learn page and parlay builder. */
export const PARLAY_RULE =
  "Every leg has to win. If any leg loses, the whole parlay loses. If a leg pushes, it's usually dropped and the parlay pays at the odds of the remaining legs.";
