"use client";

import { useState } from "react";
import type { Build, BuildSet } from "@/lib/auto-builds";
import type { Sportsbook, SportsbookCategory } from "@/lib/sportsbooks";
import { PushBetButton } from "../push-bet-button";

const SIZES = [2, 3, 4, 5, 6, 7, 8];
const fmtOdds = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const pct = (p: number) => (p >= 0.1 ? `${Math.round(p * 100)}%` : `${(p * 100).toFixed(1)}%`);

function when(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }) + " ET";
}

function BuildCard({
  build,
  title,
  sportsbookPrefs,
  allowedCategories,
}: {
  build: Build;
  title: string;
  sportsbookPrefs: Sportsbook[];
  allowedCategories: SportsbookCategory[];
}) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-3 rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs text-neutral-500">{title}</div>
          <div className="text-2xl font-semibold text-orange-300">{fmtOdds(build.americanOdds)}</div>
          <div className="text-xs text-neutral-400">
            $10 returns ${build.payoutPer10.toFixed(2)}
            {build.usesFairPrices && <span className="ml-1 text-neutral-500">(some legs at fair price)</span>}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-neutral-500">Model chance all hit</div>
          <div className="text-lg font-semibold text-emerald-300">{pct(build.combinedProb)}</div>
        </div>
      </div>

      <p className="text-sm text-neutral-300">{build.summary}</p>

      <ol className="space-y-2">
        {build.legs.map((leg, i) => {
          const isOpen = open === leg.id;
          return (
            <li key={leg.id} className="rounded-md border border-neutral-800 bg-neutral-950/50">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : leg.id)}
                className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left"
                aria-expanded={isOpen}
              >
                <span className="min-w-0">
                  <span className="mr-1.5 text-xs text-neutral-500">{i + 1}.</span>
                  <span className="text-sm font-medium text-neutral-100">{leg.label}</span>
                  <span className="block text-xs text-neutral-500">
                    {leg.sport} · {leg.matchup}
                    {leg.startsAt ? ` · ${when(leg.startsAt)}` : ""}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-sm text-neutral-200">
                    {fmtOdds(leg.priceAmerican)}
                    {leg.priceSource === "fair" && <span className="ml-1 text-[10px] text-neutral-500">fair</span>}
                  </span>
                  <span className="block text-xs text-emerald-400">{pct(leg.prob)}</span>
                  <span className="block text-[10px] text-neutral-500">{isOpen ? "Hide why ▴" : "Why ▾"}</span>
                </span>
              </button>
              {isOpen && (
                <ul className="list-disc space-y-1 border-t border-neutral-800 px-3 py-2 pl-7 text-xs text-neutral-300">
                  {leg.reasons.map((r, j) => (
                    <li key={j}>{r}</li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>

      <p className="text-xs text-neutral-500">
        Weakest link: {build.weakest.label} ({pct(build.weakest.prob)}). Every leg has to win.
      </p>

      <PushBetButton
        legs={build.legs.map((l) => ({ label: `${l.label} (${l.sport})`, priceAmerican: l.priceAmerican }))}
        title={title}
        sportsbookPrefs={sportsbookPrefs}
        allowedCategories={allowedCategories}
        compact
      />
    </div>
  );
}

function Section({
  heading,
  builds,
  pool,
  emptyText,
  titlePrefix,
  sportsbookPrefs,
  allowedCategories,
}: {
  heading: string;
  builds: Build[];
  pool: number;
  emptyText: string;
  titlePrefix: string;
  sportsbookPrefs: Sportsbook[];
  allowedCategories: SportsbookCategory[];
}) {
  const [size, setSize] = useState<number>(builds.find((b) => b.size === 3)?.size ?? builds[0]?.size ?? 2);
  const build = builds.find((b) => b.size === size) ?? builds[0];
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{heading}</h2>
        <span className="text-xs text-neutral-500">{pool} qualifying legs</span>
      </div>
      {builds.length === 0 ? (
        <p className="rounded-md border border-neutral-800 px-3 py-3 text-sm text-neutral-500">{emptyText}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Number of legs">
            {SIZES.map((n) => {
              const available = builds.some((b) => b.size === n);
              return (
                <button
                  key={n}
                  type="button"
                  role="tab"
                  aria-selected={size === n}
                  disabled={!available}
                  onClick={() => setSize(n)}
                  className={`rounded-md border px-3 py-1 text-sm ${
                    size === n
                      ? "border-orange-500 bg-orange-950/40 text-orange-200"
                      : "border-neutral-700 text-neutral-300 hover:border-neutral-500"
                  } disabled:cursor-not-allowed disabled:opacity-30`}
                >
                  {n}-leg
                </button>
              );
            })}
          </div>
          {build && (
            <BuildCard
              key={`${titlePrefix}-${build.size}`}
              build={build}
              title={`${titlePrefix} · ${build.size}-leg`}
              sportsbookPrefs={sportsbookPrefs}
              allowedCategories={allowedCategories}
            />
          )}
        </>
      )}
    </section>
  );
}

export function BuildsView({
  today,
  week,
  sportsbookPrefs,
  allowedCategories,
}: {
  today: BuildSet;
  week: BuildSet;
  sportsbookPrefs: Sportsbook[];
  allowedCategories: SportsbookCategory[];
}) {
  const [tab, setTab] = useState<"today" | "week">(today.parlays.length || today.props.length ? "today" : "week");
  const set = tab === "today" ? today : week;
  const label = tab === "today" ? "Today's" : "This week's";
  return (
    <div className="space-y-6">
      <div className="inline-flex rounded-md border border-neutral-800 p-0.5" role="tablist">
        {(["today", "week"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded px-4 py-1.5 text-sm ${
              tab === t ? "bg-neutral-800 text-white" : "text-neutral-400 hover:text-neutral-200"
            }`}
          >
            {t === "today" ? "Today" : "This week"}
          </button>
        ))}
      </div>

      <Section
        key={`${tab}-games`}
        heading={`${label} best parlay`}
        builds={set.parlays}
        pool={set.gameLegPool}
        titlePrefix={`${label} best parlay`}
        emptyText={
          tab === "today"
            ? "Not enough games today where the model is at least 60% sure. Check This week."
            : "Not enough upcoming games with a confident model pick yet. Run a sync or check back later."
        }
        sportsbookPrefs={sportsbookPrefs}
        allowedCategories={allowedCategories}
      />
      <Section
        key={`${tab}-props`}
        heading={`${label} best player props`}
        builds={set.props}
        pool={set.propLegPool}
        titlePrefix={`${label} player props`}
        emptyText={
          tab === "today"
            ? "No player props qualify for today's games yet. Check This week."
            : "No player props qualify yet. Props appear once the weekly sync has run."
        }
        sportsbookPrefs={sportsbookPrefs}
        allowedCategories={allowedCategories}
      />
    </div>
  );
}
