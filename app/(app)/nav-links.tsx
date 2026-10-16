"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/my-picks", label: "My Picks" },
  { href: "/best-bets", label: "Best Bets" },
  { href: "/results", label: "Results" },
  { href: "/best-builds", label: "Model Builds" },
  { href: "/factor-performance", label: "Factor Performance" },
  { href: "/injury-impact", label: "Injury Impact" },
  { href: "/model-tracker", label: "Model Tracker" },
  { href: "/props", label: "Player Props" },
  { href: "/td-props", label: "TD Props" },
  { href: "/touchdowns", label: "TDs & Turnovers" },
  { href: "/parlays", label: "Parlays" },
  { href: "/bet-tracker", label: "Bet Tracker" },
  { href: "/elo-ratings", label: "Elo Ratings" },
  { href: "/model-tracker", label: "NFL" },
  { href: "/sports/nba", label: "NBA" },
  { href: "/sports/wnba", label: "WNBA" },
  { href: "/sports/nhl", label: "NHL" },
  { href: "/sports/mlb", label: "MLB" },
  { href: "/sports/ncaaf", label: "NCAAF" },
  { href: "/sports/ncaab", label: "NCAAB" },
  { href: "/learn", label: "What it means" },
  { href: "/whats-new", label: "What's new" },
  { href: "/feedback", label: "Feedback" },
];

export function NavLinks({ accent }: { accent?: string }) {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  // Keep the current page's link in view when the row scrolls sideways.
  useEffect(() => {
    navRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [pathname]);

  return (
    <nav ref={navRef} className="flex w-max gap-1">
      {LINKS.map((link) => {
        const active = pathname === link.href;
        return (
          <Link prefetch={false}
            key={link.label}
            href={link.href}
            aria-current={active ? "page" : undefined}
            style={active ? { backgroundColor: accent } : undefined}
            className={`whitespace-nowrap px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              active
                ? "text-white"
                : "text-neutral-300 hover:bg-neutral-800/80 hover:text-white"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
