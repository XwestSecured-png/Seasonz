import { db } from "@/db";
import { oddsLines } from "@/db/schema";
import { and, eq, inArray, max } from "drizzle-orm";
import { PageInfo } from "../page-info";
import { SectionNote } from "../section-note";
import { NextStep } from "../next-step";
import { PayoutCalc } from "../parlays/payout-calc";
import { PushBetButton } from "../push-bet-button";
import { TdPicksBuilder, type TdPlayerOption } from "./td-picks-builder";
import { probToFairAmerican } from "@/lib/fair-odds";
import { getFavoriteTeam } from "@/lib/favorite-team";
import { getSportsbookPrefs } from "@/lib/sportsbook-pref";
import { getCurrentUser } from "@/lib/current-user";
import { getAppLimits } from "@/lib/app-settings";
import { tdPicksMaxLegs, topPicksCount, allowedPlatformCategories } from "@/lib/entitlements";
import Link from "next/link";

export const dynamic = "force-dynamic";

function currentNflSeason(): number {
  const now = new Date();
  return now.getMonth() >= 1 ? now.getFullYear() : now.getFullYear() - 1;
}

function pct(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

export default async function TdPropsPage() {
  const season = currentNflSeason();
  const favTeam = await getFavoriteTeam();
  const sportsbookPrefs = await getSportsbookPrefs();
  const user = await getCurrentUser();
  const tier = user?.tier ?? "free";
  const limits = await getAppLimits();
  const maxLegs = tdPicksMaxLegs(tier, limits);
  const topN = topPicksCount(tier, limits);
  const platformCategories = allowedPlatformCategories(tier);

  const [latest] = await db
    .select({ week: max(oddsLines.week) })
    .from(oddsLines)
    .where(and(eq(oddsLines.season, season), eq(oddsLines.book, "Model (no book line)")));
  const week = latest?.week ?? null;

  const rows =
    week !== null
      ? await db
          .select({
            player: oddsLines.player,
            team: oddsLines.team,
            statType: oddsLines.statType,
            probability: oddsLines.edgePct,
          })
          .from(oddsLines)
          .where(
            and(
              eq(oddsLines.season, season),
              eq(oddsLines.week, week),
              eq(oddsLines.book, "Model (no book line)"),
              inArray(oddsLines.statType, ["Anytime TD", "2+ TDs"])
            )
          )
      : [];

  // Merge the two separate rows (Anytime TD / 2+ TDs) each player has into
  // one combined option — same player, same source, just two stat flavors
  // of the same underlying Poisson projection (see computeTdProjections in
  // lib/props-model.ts).
  const byPlayer = new Map<string, TdPlayerOption>();
  for (const r of rows) {
    if (!r.player || !r.team || r.probability === null) continue;
    const key = r.player;
    const entry = byPlayer.get(key) ?? { player: r.player, team: r.team, anytimeTdPct: 0, multiTdPct: 0 };
    if (r.statType === "Anytime TD") entry.anytimeTdPct = r.probability;
    if (r.statType === "2+ TDs") entry.multiTdPct = r.probability;
    byPlayer.set(key, entry);
  }
  const players = Array.from(byPlayer.values()).filter((p) => p.anytimeTdPct > 0);

  const autoTop5 = [...players].sort((a, b) => b.anytimeTdPct - a.anytimeTdPct).slice(0, topN);
  const autoLegs = autoTop5.map((p) => ({
    label: `${p.player} (${p.team}) Anytime TD`,
    priceAmerican: probToFairAmerican(p.anytimeTdPct),
  }));

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div>
          <h1 className="text-lg font-semibold">TD Props</h1>
          <p className="text-sm text-neutral-400 max-w-2xl">
            Anytime touchdown and multi-TD scorer odds, straight from the model&rsquo;s own
            projection.
          </p>
        </div>
        <PageInfo>
          <p>
            Every number here comes from each player&rsquo;s own season-to-date touchdown rate
            (rushing + receiving), run through a standard Poisson model — not a sportsbook line.
            There isn&rsquo;t yet a verified live market for Anytime TD / 2+ TDs props in this
            app, so there&rsquo;s no real book price to show. Instead, the payout you see is the{" "}
            <strong>fair odds</strong> implied by the model&rsquo;s own probability — what a bet
            would need to pay to exactly break even at that probability, with no bookmaker
            margin baked in. Treat it as &ldquo;how confident is the model&rdquo; in dollar terms,
            not a real quote from a book.
          </p>
          <p>
            <strong>Model&rsquo;s Top 5</strong> is the app&rsquo;s own pick of the week&rsquo;s
            five likeliest touchdown scorers, combined into a single what-if payout (Free shows
            the top 3 — <Link href="/upgrade" className="text-blue-400 hover:text-blue-300 underline">
              upgrade
            </Link>{" "}
            for all 5). <strong>Your TD Picks</strong> lets you build the same kind of combo
            yourself — a 3-to-5-leg parlay on Pro/Super Pro (3-leg only on Free), same as a
            sportsbook&rsquo;s TD combo bet: pick a player and stat type for each leg from this
            week&rsquo;s games, and the combined odds and payout show up once at least 3 legs are
            filled in. <strong>Push</strong> copies the slip and opens every platform you&rsquo;ve
            saved (set your list in the header/menu — sportsbooks always, prediction markets or
            Underdog too on Pro/Super Pro) to place it wherever you actually bet, and saves it into
            Your Parlays on the Parlays page to grade later.
          </p>
        </PageInfo>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-neutral-300">
          Model&rsquo;s Top {topN} — Anytime TD
        </h2>
        <SectionNote>
          The {topN === 1 ? "player" : "players"} the model gives the best chance of scoring at
          all this week, picked automatically. Not tied to your account.
        </SectionNote>
        {autoTop5.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No touchdown projections synced yet for this week.
          </p>
        ) : (
          <div className="rounded-md border border-neutral-800 p-3 space-y-2">
            <ul className="text-sm space-y-1.5">
              {autoTop5.map((p, i) => {
                const isFavTeam = p.team === favTeam?.code;
                return (
                  <li key={p.player} className="flex items-center justify-between gap-2">
                    <span
                      style={isFavTeam ? { color: favTeam!.primary } : undefined}
                      className={isFavTeam ? "font-medium" : "text-neutral-300"}
                    >
                      {i + 1}. {p.player} <span className="text-neutral-500">({p.team})</span>
                    </span>
                    <span className="text-xs text-neutral-400">
                      Anytime {pct(p.anytimeTdPct)}
                      {p.multiTdPct > 0 ? ` · 2+ ${pct(p.multiTdPct)}` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="text-xs text-neutral-500 pt-1 border-t border-neutral-800">
              Combined (all {topN} score):{" "}
              {pct(autoTop5.reduce((acc, p) => acc * p.anytimeTdPct, 1))}
            </div>
            <PayoutCalc legs={autoLegs} compact />
            <PushBetButton
              legs={autoLegs}
              title={`Model's Top ${topN} — Anytime TD`}
              week={week ?? undefined}
              sportsbookPrefs={sportsbookPrefs}
              allowedCategories={platformCategories}
              compact
            />
            {topN < 5 && (
              <p className="text-xs text-neutral-500">
                Free shows the top {topN} of 5.{" "}
                <Link href="/upgrade" className="text-blue-400 hover:text-blue-300 underline">
                  Upgrade
                </Link>{" "}
                to see all 5.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-neutral-300">Your TD Picks</h2>
        <SectionNote>
          {maxLegs < 5
            ? `Build a ${maxLegs}-leg touchdown parlay from this week's games — pick a player and stat type for each leg, then see the combined odds and payout.`
            : "Build a 3-to-5-leg touchdown parlay from this week's games — pick a player and stat type for each leg, then see the combined odds and payout."}
        </SectionNote>
        <TdPicksBuilder
          players={players}
          week={week ?? undefined}
          sportsbookPrefs={sportsbookPrefs}
          maxLegs={maxLegs}
          allowedCategories={platformCategories}
        />
      </div>

      <NextStep
        href="/parlays"
        label="Parlays"
        reason="Build and track your own parlays, with a real payout calculator."
      />
    </div>
  );
}
