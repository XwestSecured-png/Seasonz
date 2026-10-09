"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { TeamPicker } from "./team-picker";
import { MusicLauncher } from "./music-launcher";
import type { MusicService } from "@/lib/music-pref";
import { SportsbookPicker } from "./sportsbook-picker";
import type { Sportsbook } from "@/lib/sportsbooks";
import { allowedPlatformCategories, canViewAdvancedAnalytics } from "@/lib/entitlements";
import { TIER_LABELS, type Tier } from "@/lib/tiers";
import {
  HomeIcon,
  ListIcon,
  TicketIcon,
  TargetIcon,
  GridIcon,
  ChartIcon,
  ShieldIcon,
  StarIcon,
  ChatIcon,
  BookIcon,
  SparkIcon,
  CloseIcon,
  LogoutIcon,
  DollarIcon,
  FootballIcon,
  LockIcon,
  ShieldStarIcon,
} from "./icons";

// The four sections used most often get a permanent spot in the tab bar
// (mirrors a native sports-betting app's bottom nav, e.g. Gambly); everything
// else — plus the team picker and account actions that used to live in the
// header — lives one tap away behind "More". Only rendered on small screens
// (sm:hidden) — the desktop header's top nav (NavLinks) covers the same
// ground on wider screens.
const PRIMARY = [
  { href: "/", label: "Dashboard", Icon: HomeIcon },
  { href: "/props", label: "Props", Icon: ListIcon },
  { href: "/parlays", label: "Parlays", Icon: TicketIcon },
  { href: "/model-tracker", label: "Tracker", Icon: TargetIcon },
] as const;

// `pro` marks a link that's gated Pro-and-up (see lib/entitlements.ts's
// canViewAdvancedAnalytics) — shown to everyone, but with a lock badge for
// Free users (the page itself still enforces the gate; this is just so a
// Free user doesn't tap in blind).
const MORE_LINKS = [
  { href: "/best-builds", label: "Model Builds", Icon: TicketIcon, pro: false },
  { href: "/bet-tracker", label: "Bet Tracker", Icon: DollarIcon, pro: false },
  { href: "/td-props", label: "TD Props", Icon: FootballIcon, pro: false },
  { href: "/factor-performance", label: "Factor Performance", Icon: ChartIcon, pro: true },
  { href: "/injury-impact", label: "Injury Impact", Icon: ShieldIcon, pro: true },
  { href: "/elo-ratings", label: "Elo Ratings", Icon: StarIcon, pro: true },
  { href: "/model-tracker", label: "NFL", Icon: FootballIcon, pro: false },
  { href: "/sports/nba", label: "NBA", Icon: StarIcon, pro: false },
  { href: "/sports/wnba", label: "WNBA", Icon: StarIcon, pro: false },
  { href: "/sports/nhl", label: "NHL", Icon: StarIcon, pro: false },
  { href: "/sports/mlb", label: "MLB", Icon: StarIcon, pro: false },
  { href: "/sports/ncaaf", label: "NCAAF", Icon: StarIcon, pro: false },
  { href: "/sports/ncaab", label: "NCAAB", Icon: StarIcon, pro: false },
  { href: "/learn", label: "What it means", Icon: BookIcon, pro: false },
  { href: "/whats-new", label: "What's new", Icon: SparkIcon, pro: false },
  { href: "/feedback", label: "Feedback", Icon: ChatIcon, pro: false },
] as const;

export function BottomNav({
  accent,
  username,
  favTeamCode,
  musicPref,
  sportsbookPrefs,
  tier,
  isAdmin,
}: {
  accent: string;
  username: string | null;
  favTeamCode: string | null;
  musicPref: MusicService | null;
  sportsbookPrefs: Sportsbook[];
  tier: Tier;
  isAdmin: boolean;
}) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = MORE_LINKS.some((l) => l.href === pathname);
  const platformCategories = allowedPlatformCategories(tier);
  const canAnalytics = canViewAdvancedAnalytics(tier);

  return (
    <>
      {/* Backdrop for the More sheet */}
      <div
        className={`fixed inset-0 z-40 bg-black/60 transition-opacity sm:hidden ${
          moreOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => setMoreOpen(false)}
        aria-hidden
      />

      {/* "More" sheet — secondary pages + the account controls that used to
          sit in the header, consolidated into one tap-away panel. */}
      <div
        className={`fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-neutral-800 bg-neutral-950 shadow-2xl transition-transform duration-200 sm:hidden ${
          moreOpen ? "translate-y-0" : "translate-y-full"
        }`}
        style={{ paddingBottom: "calc(5.25rem + env(safe-area-inset-bottom))" }}
        role="dialog"
        aria-modal="true"
        aria-hidden={!moreOpen}
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-1">
          <span className="text-sm font-semibold text-neutral-300">More</span>
          <button
            type="button"
            onClick={() => setMoreOpen(false)}
            className="rounded-full p-1.5 text-neutral-500 hover:bg-neutral-900 hover:text-neutral-200"
            aria-label="Close"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>
        <nav className="px-2 pt-2 pb-1">
          {MORE_LINKS.map((l) => {
            const active = pathname === l.href;
            const locked = l.pro && !canAnalytics;
            return (
              <Link
                key={l.label}
                href={l.href}
                onClick={() => setMoreOpen(false)}
                style={active ? { color: accent } : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${
                  active ? "bg-neutral-900" : "text-neutral-300 hover:bg-neutral-900/70"
                }`}
              >
                <l.Icon className="h-5 w-5 shrink-0" />
                <span className="flex-1">{l.label}</span>
                {locked && <LockIcon className="h-3.5 w-3.5 shrink-0 text-neutral-600" />}
              </Link>
            );
          })}
          <Link
            href="/upgrade"
            onClick={() => setMoreOpen(false)}
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-blue-400 hover:bg-neutral-900/70"
          >
            <StarIcon className="h-5 w-5 shrink-0" />
            Upgrade — you&rsquo;re on {TIER_LABELS[tier]}
          </Link>
          {isAdmin && (
            <Link
              href="/admin"
              onClick={() => setMoreOpen(false)}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-neutral-300 hover:bg-neutral-900/70"
            >
              <ShieldStarIcon className="h-5 w-5 shrink-0" />
              Admin
            </Link>
          )}
        </nav>
        <div className="mx-4 border-t border-neutral-800" />
        <div className="space-y-3 px-4 py-3">
          {username && (
            <p className="text-xs text-neutral-500">
              Signed in as <span className="text-neutral-300">{username}</span>
            </p>
          )}
          <TeamPicker current={favTeamCode} />
          <MusicLauncher current={musicPref} />
          <SportsbookPicker current={sportsbookPrefs} allowedCategories={platformCategories} />
          <form action="/api/logout" method="POST">
            <button
              type="submit"
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-neutral-800 px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-900"
            >
              <LogoutIcon className="h-4 w-4" />
              Log out
            </button>
          </form>
        </div>
      </div>

      {/* The tab bar itself */}
      <nav
        className="fixed inset-x-0 bottom-0 z-50 border-t border-neutral-800/80 bg-neutral-950/95 backdrop-blur sm:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="grid grid-cols-5">
          {PRIMARY.map((l) => {
            const active = pathname === l.href;
            return (
              <Link
                key={l.label}
                href={l.href}
                className="flex flex-col items-center justify-center gap-0.5 py-2.5 text-[11px] font-medium"
                style={{ color: active ? accent : "#737373" }}
              >
                <l.Icon className="h-5 w-5" />
                {l.label}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen((o) => !o)}
            className="flex flex-col items-center justify-center gap-0.5 py-2.5 text-[11px] font-medium"
            style={{ color: moreOpen || moreActive ? accent : "#737373" }}
          >
            <GridIcon className="h-5 w-5" />
            More
          </button>
        </div>
      </nav>
    </>
  );
}
