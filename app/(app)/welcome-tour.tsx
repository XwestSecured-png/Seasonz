"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";

const STORAGE_KEY = "seasonz:dismissedWelcomeTour";

// Read the dismissed flag via useSyncExternalStore rather than an
// effect+setState — it's the pattern React itself recommends for reading a
// browser-only store without a setState-in-effect cascade, and
// getServerSnapshot lets the server render (no localStorage) and the
// client's post-hydration read disagree without a hydration-mismatch
// warning: React expects that mismatch for exactly this kind of API.
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function getSnapshot(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function getServerSnapshot(): boolean {
  return false;
}

const STOPS: { href: string; label: string; blurb: string }[] = [
  {
    href: "/props",
    label: "Player Props",
    blurb: "Every player prop line the model has an edge on.",
  },
  {
    href: "/parlays",
    label: "Parlays",
    blurb: "Build your own, paste one in, or chat with Ask AI to build it for you.",
  },
  {
    href: "/model-tracker",
    label: "Model Tracker",
    blurb: "Every pick the model has made this season, win or loss.",
  },
  {
    href: "/sports/nba",
    label: "Other sports",
    blurb: "NBA, WNBA, NHL, MLB, and college — same model, one tab each.",
  },
];

/**
 * A one-time "here's how to get around" card for new users, dismissed for
 * good (per browser — no account field for this) once they close it. Shown
 * at the top of the Dashboard, above the actual picks, so it's the first
 * thing a first-time visitor sees without getting in the way afterward.
 */
export function WelcomeTour() {
  const storedDismissed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  // Flips immediately on click, in the same tab, where a "storage" event
  // never fires (that only fires in OTHER tabs) — storedDismissed alone
  // wouldn't update until next reload without this.
  const [justDismissed, setJustDismissed] = useState(false);

  if (storedDismissed || justDismissed) return null;

  function dismiss() {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // Private-mode / storage blocked — dismiss for this view only.
    }
    setJustDismissed(true);
  }

  return (
    <div className="rounded-md border border-blue-900/60 bg-blue-950/30 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold text-blue-200">New here? A quick tour</h2>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="shrink-0 text-xs text-neutral-400 hover:text-neutral-200"
        >
          ✕
        </button>
      </div>
      <p className="text-sm text-neutral-300">
        On phone or tablet, the bottom bar is your main nav — tap{" "}
        <span className="font-medium text-neutral-100">More</span> for every other sport, Bet
        Tracker, Elo Ratings, and your account. On a larger screen, everything&rsquo;s in the top
        bar instead.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {STOPS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="rounded-md border border-neutral-800 bg-neutral-900/60 px-3 py-2 transition-colors hover:bg-neutral-900"
          >
            <div className="text-sm font-medium text-neutral-100">{s.label}</div>
            <div className="text-xs text-neutral-400">{s.blurb}</div>
          </Link>
        ))}
      </div>
      <button type="button" onClick={dismiss} className="text-xs text-blue-400 hover:text-blue-300">
        Got it, don&rsquo;t show this again
      </button>
    </div>
  );
}
