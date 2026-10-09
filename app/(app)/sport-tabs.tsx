import Link from "next/link";

// One tab per sport across the top of every Model Tracker page, so NFL and
// every other sport are one tap apart and work the same way.
const TABS = [
  { key: "nfl", label: "NFL", href: "/model-tracker" },
  { key: "nba", label: "NBA", href: "/sports/nba" },
  { key: "wnba", label: "WNBA", href: "/sports/wnba" },
  { key: "nhl", label: "NHL", href: "/sports/nhl" },
  { key: "mlb", label: "MLB", href: "/sports/mlb" },
  { key: "ncaaf", label: "NCAAF", href: "/sports/ncaaf" },
  { key: "ncaab", label: "NCAAB", href: "/sports/ncaab" },
];

export function SportTabs({ active }: { active: string }) {
  return (
    <nav aria-label="Sports" className="-mx-1 flex gap-1 overflow-x-auto pb-1">
      {TABS.map((t) => {
        const on = t.key === active;
        return (
          <Link prefetch={false}
            key={t.key}
            href={t.href}
            aria-current={on ? "page" : undefined}
            className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
              on
                ? "border-emerald-500 bg-emerald-600 text-white"
                : "border-neutral-700 bg-neutral-900/60 text-neutral-300 hover:border-neutral-500"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
