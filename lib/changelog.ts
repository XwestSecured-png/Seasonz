// Seasonz patch notes — shown on the "What's new" page, and as a banner
// for anyone who hasn't seen the newest release yet.
//
// TO SHIP AN UPDATE: add a new release at the TOP of RELEASES with a higher
// version. Write each change for users, not developers:
//   whatChanged — what's different in the app, in one or two sentences
//   whatItMeans — why it matters to the user / how it affects their bets
// Mark admin-only changes with audience: "admin" so regular users don't
// see them.
//
// Client-safe: no server imports.

export type ChangeKind = "new" | "improved" | "fixed";

export interface Change {
  kind: ChangeKind;
  title: string;
  whatChanged: string;
  whatItMeans: string;
  /** Deep link to the part of the app this change is about. */
  href?: string;
  audience?: "everyone" | "admin";
}

export interface Release {
  version: string;
  /** YYYY-MM-DD */
  date: string;
  title: string;
  summary: string;
  changes: Change[];
}

export const RELEASES: Release[] = [
  {
    version: "1.5.0",
    date: "2026-10-10",
    title: "Sharper picks in every sport",
    summary:
      "Game picks for NBA, WNBA, NHL, MLB, college football and college basketball now use the betting line, starting pitchers and goalies, injuries, recent form and weather, and the model grades itself every week.",
    changes: [
      {
        kind: "improved",
        title: "Picks use the betting line",
        whatChanged:
          "Each game's chance now blends our model with the FanDuel, BetMGM or ESPN moneyline, after taking out the book's built-in margin.",
        whatItMeans:
          "Tested on last season's games, this picked more winners: on games with a posted line, NHL went from 51.8% to 55.2% and college football from 69.1% to 73.7%, and every sport's percentages got more accurate. Each pick's \"Why\" panel shows the model's own number next to the book's.",
      },
      {
        kind: "new",
        title: "Starting pitchers and goalies",
        whatChanged:
          "MLB picks rate both probable starting pitchers. NHL picks check whether a team is starting its backup goalie.",
        whatItMeans: "Picks change when a team's ace or its backup goalie is going, and the Why panel names them.",
      },
      {
        kind: "improved",
        title: "Injuries count in every sport",
        whatChanged:
          "Players listed out, on the IL or suspended now lower their team's chance in every sport, based on how much they produce.",
        whatItMeans: "A star sitting out moves the pick. The biggest absences are listed in the Why panel.",
      },
      {
        kind: "new",
        title: "Recent form and weather",
        whatChanged:
          "Every sport now weighs each team's recent scoring margin. Outdoor MLB and college football games show the game-time forecast.",
        whatItMeans: "Hot and cold teams are reflected. Weather is shown for context; in testing it didn't change who wins.",
      },
      {
        kind: "new",
        title: "Weekly scorecard",
        whatChanged:
          "The Model Tracker shows each sport's record this week and this season, a calibration score, and how the betting favorite did on the same games.",
        whatItMeans:
          "Picks are graded on the number shown before each game started, so the record can't be rewritten. If a sport's numbers drift, the model corrects itself.",
        href: "/model-tracker",
      },
    ],
  },
  {
    version: "1.4.0",
    date: "2026-10-09",
    title: "Parlays for every sport, 2 to 8 legs",
    summary: "Parlays can switch between all sports or any one sport, auto parlays come in every size from 2 to 8 legs, and Player Props fill in for every sport.",
    changes: [
      {
        kind: "new",
        title: "Pick a sport on Parlays",
        whatChanged:
          "Parlays has buttons for All sports, NFL, NBA, WNBA, NHL, MLB, NCAAF and NCAAB. Auto parlays and the builder's games and props switch to that sport.",
        whatItMeans: "Build a parlay from one sport or mix them, with that sport's real lines in the dropdowns.",
        href: "/parlays",
      },
      {
        kind: "improved",
        title: "Auto parlays from 2 to 8 legs",
        whatChanged:
          "Auto parlays now come in every size from 2 to 8 legs, from game picks and from player props, for today or this week. Tap any leg to see why it was picked.",
        whatItMeans:
          "Pick the size you want. On a light slate the bigger ones are filled with the model's next-best sides, so check the chance shown before betting.",
        href: "/parlays",
      },
      {
        kind: "fixed",
        title: "Player Props for every sport",
        whatChanged:
          "Props for NBA, NHL, MLB and the rest now fill in like NFL. Early in a season, a player's projection uses last season's games until he has 3 this season, and newer box scores load first.",
        whatItMeans: "You'll see real projections against FanDuel and other book lines instead of an empty page.",
        href: "/props",
      },
      {
        kind: "new",
        title: "Build your own prop from menus",
        whatChanged:
          "Make your own pick on Player Props now uses menus: game, team, player, then stat. Each player shows only the stats they actually record, with their recent average, and the line fills in from the sportsbook (or just above their average when no book line is posted).",
        whatItMeans: "No typing names or stat codes, and every pick grades correctly against the box score.",
        href: "/props",
      },
      {
        kind: "new",
        title: "Legacy admins use Seasonz free",
        whatChanged: "Legacy admins always get full Super Pro access, can't be sent to checkout, and aren't counted in Est. MRR.",
        whatItMeans: "No legacy admin is ever charged.",
        href: "/admin",
        audience: "admin",
      },
    ],
  },
  {
    version: "1.3.0",
    date: "2026-10-09",
    title: "NBA deep dive and one week at a time",
    summary:
      "Model Tracker now shows only this week's games for every sport, and every pick has a Why panel. The NBA model adds recent form, paint scoring and injuries, with FanDuel and BetMGM lines.",
    changes: [
      {
        kind: "improved",
        title: "Model Tracker: this week only",
        whatChanged:
          "Each sport's tracker shows this week's games (Monday to Sunday, Eastern time) with the dates on top, and only this week's results. Times are shown in Eastern time.",
        whatItMeans: "No more old or far-off games mixed in. Your season record still counts every week.",
        href: "/model-tracker",
      },
      {
        kind: "new",
        title: "Why the model picked it, on every game",
        whatChanged:
          "Tap Why under any game to see what drove the pick, a side-by-side of both teams, home and road records, the last meetings with final scores, trends, injuries and suspensions, the officiating crew and how they call games, the schedule (rest, back-to-backs) and FanDuel and BetMGM lines.",
        whatItMeans:
          "You can check every number behind a pick before you bet it. All data comes from ESPN and the sportsbooks, not expert opinion.",
      },
      {
        kind: "improved",
        title: "Sharper NBA picks",
        whatChanged:
          "The NBA model now adds each team's last 20 games of scoring margin and points in the paint, plus who is out injured or suspended. We tested rebounds, turnovers, fouls, offensive fouls, threes, mid-range, head-to-head and referee crews too, and only kept what made picks better.",
        whatItMeans:
          "Tested on the full 2025-26 season it hadn't seen: picked 69.3% of winners, up from 68.5%, with better-calibrated chances. Everything else still shows in the Why panel.",
        href: "/sports/nba",
      },
    ],
  },
  {
    version: "1.2.0",
    date: "2026-10-09",
    title: "Model Builds and sharper picks in every sport",
    summary:
      "The model now builds its own parlays and player-prop parlays every day and every week, the other sports' predictions were rebuilt and tested on past seasons, and Model Tracker shows one week at a time with a tab for every sport.",
    changes: [
      {
        kind: "new",
        title: "Model Builds: best parlays and player props, 2 to 8 legs",
        whatChanged:
          "A new Model Builds page shows today's and this week's best parlay and best player-prop parlay in every size from 2 to 8 legs. Tap any leg to see why the model picked it.",
        whatItMeans:
          "You get the model's strongest picks already stacked, with the chance that all of them hit and the payout. Each leg is from a different game, and picks above 90% are left out because they add risk without adding payout.",
        href: "/best-builds",
      },
      {
        kind: "improved",
        title: "Better predictions for NBA, WNBA, NHL, MLB and college",
        whatChanged:
          "Each sport now has its own settings, tested on the last 3 to 4 seasons. Ratings carry over from last season instead of resetting, neutral-site games get no home edge, and back-to-backs and short rest count against a team.",
        whatItMeans:
          "On the most recent full season, the model picked more winners: college football 67.8% to 72.9%, MLB 53.9% to 55.8%, NBA 66.6% to 67.9%, WNBA 67.0% to 67.8%, college basketball 72.2% to 72.9%. NHL picks are better calibrated. Early-season picks improve the most.",
      },
      {
        kind: "fixed",
        title: "MLB and NBA now use the full season",
        whatChanged:
          "The model was only reading the current phase of the season (just MLB's playoffs, just NBA preseason). It now reads the regular season and playoffs, and preseason games are no longer counted.",
        whatItMeans: "MLB playoff and NBA predictions are based on the whole season, not a handful of games.",
      },
      {
        kind: "improved",
        title: "Model Tracker: one week at a time, a tab for every sport",
        whatChanged:
          "Model Tracker shows only this week's games and results, and has tabs for NFL, NBA, WNBA, NHL, MLB, NCAAF and NCAAB, each with Make your own pick vs the model.",
        whatItMeans: "Less scrolling through old weeks, and you can pick against the model in every sport.",
        href: "/model-tracker",
      },
      {
        kind: "fixed",
        title: "Platform menu no longer cut off",
        whatChanged: "The betting-platform menu opens above other content and flips upward near the bottom of the screen.",
        whatItMeans: "You can see and choose every platform on a phone.",
      },
      {
        kind: "improved",
        title: "Animated Seasonz logo and background",
        whatChanged: "The logo and fire background now flicker and glow. If your phone is set to reduce motion, they stay still.",
        whatItMeans: "Just a new look.",
      },
      {
        kind: "new",
        title: "Scheduled syncs twice a day",
        whatChanged:
          "Data syncs automatically at 12am ET, and again at 2pm ET if nobody has synced since 10am. The Sync button is now for legacy admins only.",
        whatItMeans: "Odds, injuries and picks stay fresh without anyone pressing a button.",
        href: "/admin",
        audience: "admin",
      },
      {
        kind: "new",
        title: "Role picker and invite-code sheets",
        whatChanged:
          "Legacy admins can set anyone to User, Admin or Legacy admin. Each admin has their own sheet of invite codes per platform, can paste a whole list at once, and the app rotates through your own sheet first. Legacy admins can see and download every admin's sheet.",
        whatItMeans: "Hand out codes from your own list and see how many sign-ups each one brought in.",
        href: "/admin",
        audience: "admin",
      },
    ],
  },
  {
    version: "1.1.0",
    date: "2026-10-09",
    title: "Smarter NFL model and a new look",
    summary:
      "The NFL model now reads Next Gen Stats tracking data and pass-rush pressure, the ticker is easier to read, and Seasonz has a new fire background.",
    changes: [
      {
        kind: "improved",
        title: "Next Gen Stats and pressure data in NFL predictions",
        whatChanged:
          "The model now looks at how open each team's receivers get (Next Gen Stats separation) and how much pressure each team's pass rush creates and its offensive line allows.",
        whatItMeans:
          "Win chances, spreads, and Best Bets account for matchups the old stats missed. In testing on the 2024-2025 seasons, picks got slightly more accurate. You'll see these listed as \u201cNGS separation\u201d and \u201cPressure\u201d in a game's factor breakdown.",
        href: "/model-tracker",
      },
      {
        kind: "improved",
        title: "Slower scores ticker",
        whatChanged: "The scores and injuries ticker at the bottom scrolls much more slowly, and pauses when you hover over it.",
        whatItMeans: "You can actually read the scores as they go by.",
      },
      {
        kind: "new",
        title: "New background",
        whatChanged: "Seasonz has a new dark background with the Seasonz name outlined in fire.",
        whatItMeans: "Just a new look. If your phone is set to reduce motion, the flames stay still.",
      },
    ],
  },
  {
    version: "1.0.0",
    date: "2026-10-07",
    title: "Welcome to Seasonz",
    summary:
      "Seasonz launches with the full prediction model across NFL, NBA, WNBA, NHL, MLB, and college, plus new ways to learn how every bet works.",
    changes: [
      {
        kind: "new",
        title: "“What it means” on every bet",
        whatChanged:
          "When you log a bet in Bet Tracker, a “What it means” box spells out exactly what has to happen for you to win, when it’s a push, and what it pays. Your open bets show the same breakdown.",
        whatItMeans:
          "No more guessing what “-3.5” or “Under 44.5” needs. You see the exact score you need before you place it.",
        href: "/bet-tracker",
      },
      {
        kind: "new",
        title: "Betting guide: Moneyline, Spread, Over/Under, Alternate lines",
        whatChanged:
          "A new What it means page covers reading odds, moneylines, spreads, totals, alternate lines, player props, parlays, and pushes, with a playground to try any bet.",
        whatItMeans:
          "Learn how each bet type wins or loses, and how moving a line changes both your chances and your payout.",
        href: "/learn",
      },
      {
        kind: "new",
        title: "Patch notes",
        whatChanged: "This page. Every update to Seasonz is listed here in plain English.",
        whatItMeans:
          "When the model or a feature changes, you’ll see a banner and can read what’s different and how it affects your picks.",
        href: "/whats-new",
      },
      {
        kind: "new",
        title: "Promo codes for free months",
        whatChanged:
          "You can redeem a promo code on the Upgrade page for 3, 6, 9, or 12 months of Pro or Super Pro free.",
        whatItMeans:
          "If an admin gives you a code, enter it on Upgrade. Free time stacks with any free time you already have on the same plan.",
        href: "/upgrade",
      },
      {
        kind: "new",
        title: "Install it like an app",
        whatChanged:
          "Seasonz works on iPhone, Android, and computers. On iPhone use Share → Add to Home Screen; on Android use Install app.",
        whatItMeans: "It opens full-screen from your home screen, just like an app from the store.",
      },
      {
        kind: "new",
        title: "Rotating invite codes per platform",
        whatChanged:
          "Admin shows a different invite code for iPhone, Android, and desktop each time the page loads, from each platform’s list.",
        whatItMeans: "Hand out the code for the person’s device. Turn off or delete any code that leaks.",
        href: "/admin",
        audience: "admin",
      },
      {
        kind: "new",
        title: "Legacy admins and promo approvals",
        whatChanged:
          "Up to 5 legacy admins. Promo codes need an admin approval, then a legacy admin approval, before they work.",
        whatItMeans:
          "Two different people sign off on every free-months code, so no single admin can hand out free time alone.",
        href: "/admin",
        audience: "admin",
      },
      {
        kind: "new",
        title: "Odds key rotation",
        whatChanged:
          "Free odds keys are used first and the paid PropLine key last. Admin shows requests left on each key.",
        whatItMeans: "Odds and props keep syncing when a free key runs out, without burning the paid plan first.",
        href: "/admin",
        audience: "admin",
      },
    ],
  },
];

export const LATEST_RELEASE = RELEASES[0];

export function releasesFor(isAdmin: boolean): Release[] {
  return RELEASES.map((r) => ({
    ...r,
    changes: r.changes.filter((c) => isAdmin || (c.audience ?? "everyone") === "everyone"),
  })).filter((r) => r.changes.length > 0);
}

/** Compares "1.2.10" style versions. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function hasUnseenUpdate(lastSeen: string | null | undefined): boolean {
  if (!LATEST_RELEASE) return false;
  return !lastSeen || compareVersions(LATEST_RELEASE.version, lastSeen) > 0;
}
