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
