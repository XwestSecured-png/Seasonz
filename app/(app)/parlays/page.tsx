import { db } from "@/db";
import { games, oddsLines, parlayPicks, propLinesRaw } from "@/db/schema";
import { and, desc, eq, max } from "drizzle-orm";
import { ParlayBuilder } from "./parlay-builder";
import { ParlayCard } from "./parlay-card";
import { PayoutCalc } from "./payout-calc";
import { PushBetButton } from "../push-bet-button";
import { PageInfo } from "../page-info";
import { PARLAY_RULE } from "@/lib/bet-explainer";
import Link from "next/link";
import { SectionNote } from "../section-note";
import { NextStep } from "../next-step";
import { getCurrentUser } from "@/lib/current-user";
import { getFavoriteTeam } from "@/lib/favorite-team";
import { getSportsbookPrefs } from "@/lib/sportsbook-pref";
import { allowedPlatformCategories } from "@/lib/entitlements";
import { otherSportsPickCandidates } from "@/lib/sports/best-bets";

interface StoredLeg {
  label: string;
  priceAmerican: number;
  winPct: number;
  result: "pending" | "won" | "lost" | "push";
}

export const dynamic = "force-dynamic";

function currentNflSeason(): number {
  const now = new Date();
  return now.getMonth() >= 1 ? now.getFullYear() : now.getFullYear() - 1;
}

function formatPrice(price: number): string {
  return price > 0 ? `+${price}` : `${price}`;
}

interface AutoLeg {
  player: string;
  team: string;
  statType: string;
  side: string;
  line: number;
  book: string;
  priceAmerican: number;
}

export default async function ParlaysPage() {
  const season = currentNflSeason();
  const user = await getCurrentUser();
  const favTeam = await getFavoriteTeam();
  const sportsbookPrefs = await getSportsbookPrefs();
  const platformCategories = allowedPlatformCategories(user?.tier ?? "free");

  const [latest] = await db
    .select({ week: max(oddsLines.week) })
    .from(oddsLines)
    .where(eq(oddsLines.season, season));
  const week = latest?.week ?? null;

  const autoParlays =
    week !== null
      ? await db
          .select()
          .from(parlayPicks)
          .where(
            and(
              eq(parlayPicks.season, season),
              eq(parlayPicks.week, week),
              eq(parlayPicks.kind, "auto")
            )
          )
          .orderBy(desc(parlayPicks.combinedWinPct))
      : [];

  const myParlays = user
    ? await db
        .select()
        .from(parlayPicks)
        .where(and(eq(parlayPicks.kind, "user"), eq(parlayPicks.userId, user.id)))
        .orderBy(desc(parlayPicks.createdAt))
    : [];

  // Dropdown data for the "Your Parlays" leg picker — this week's games
  // (for team bets: ML/spread/total) and this week's raw player-prop lines
  // (for the team -> player -> stat type cascade). Both come straight off
  // tables the sync already populates, so no new data source is needed.
  const weekGames =
    week !== null
      ? await db
          .select({
            id: games.id,
            week: games.week,
            homeTeam: games.homeTeam,
            awayTeam: games.awayTeam,
            moneylineHomeOdds: games.moneylineHomeOdds,
            moneylineAwayOdds: games.moneylineAwayOdds,
            spreadHomeLine: games.spreadHomeLine,
            spreadHomePriceAmerican: games.spreadHomePriceAmerican,
            spreadAwayPriceAmerican: games.spreadAwayPriceAmerican,
            totalLine: games.totalLine,
            totalOverPriceAmerican: games.totalOverPriceAmerican,
            totalUnderPriceAmerican: games.totalUnderPriceAmerican,
          })
          .from(games)
          .where(and(eq(games.season, season), eq(games.week, week)))
      : [];

  const weekPropOptions =
    week !== null
      ? await db
          .select({
            player: propLinesRaw.player,
            team: propLinesRaw.team,
            statType: propLinesRaw.statType,
            line: propLinesRaw.line,
            side: propLinesRaw.side,
            book: propLinesRaw.book,
            priceAmerican: propLinesRaw.priceAmerican,
          })
          .from(propLinesRaw)
          .where(and(eq(propLinesRaw.season, season), eq(propLinesRaw.week, week)))
      : [];

  // This week's model-favorite picks for every other sport (NBA, WNBA, NHL,
  // MLB, college football, college basketball) — a quick-add list in the
  // builder below, priced with the model's own fair odds since none of
  // these sports have a real sportsbook line synced yet.
  const otherSportsPicks = await otherSportsPickCandidates();

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div>
          <h1 className="text-lg font-semibold">Parlays</h1>
          <p className="text-sm text-neutral-400 max-w-2xl">
            See the model&rsquo;s auto-built parlays, or build and track your own.
          </p>
        </div>
        <PageInfo>
          <p>
            <strong>Auto Parlays</strong> are built by the app from this week&rsquo;s best player
            prop picks, combined into 2, 3, or 4-leg bets (one player per leg, never the same
            player twice). &ldquo;Combined win%&rdquo; is the chance all legs hit together.
            &ldquo;Weakest leg&rdquo; is the one most likely to lose the bet. These are just for
            reference — not tied to your account.
          </p>
          <p>
            <strong>Your Parlays</strong> are ones you build yourself, from any bet you want.
            Each leg defaults to dropdown menus — pick a team, then a player (or &ldquo;Team
            bet&rdquo; for moneyline/spread/total) and a stat type, and the odds fill in
            automatically from this week&rsquo;s real lines. Save it, then come back later and
            mark each leg Won, Lost, or Push. The whole parlay is marked Won only once every leg
            has settled Won or Push, and Lost as soon as any leg loses. Only you can see and
            grade your own parlays.
          </p>
          <p>
            Every parlay — yours or Auto — shows a <strong>payout calculator</strong>: enter a
            stake and see the potential payout and profit if every leg hits, based on the combined
            odds.
          </p>
          <p>
            <strong>Push</strong> copies the slip as plain text and opens every platform you&rsquo;ve
            saved (set your list in the header/menu — any mix of sportsbooks, prediction markets
            like Kalshi or Polymarket, and Underdog) so you can paste and place it wherever you
            actually bet — none of them let an outside app fill in their bet slip directly, so this
            is the closest real equivalent. Pushing an Auto Parlay also saves it into Your Parlays
            as a pending pick, so it&rsquo;s there to grade later.
          </p>
          <p>
            Two shortcuts fill the form for you: <strong>Ask AI</strong> lets you describe a
            parlay in plain English and builds it from this week&rsquo;s real picks only — it
            never invents a bet that isn&rsquo;t actually available. <strong>Paste a
            parlay</strong> lets you paste several bets at once (one per line, each ending in its
            price) instead of typing each leg by hand. Legs filled this way land in free-text
            mode — switch a leg back to dropdowns any time with &ldquo;Use dropdowns
            instead&rdquo;. Either way, review what gets filled in before you save.
          </p>
        </PageInfo>
        <PageInfo title="What it means: how a parlay wins">
          <p>{PARLAY_RULE}</p>
          <p>
            Each extra leg multiplies the payout and divides your chances. Two -110 legs pay about +264
            and hit about 1 in 4 times if each is a coin flip; three pay about +596 and hit about 1 in 8.
          </p>
          <Link href="/learn#parlays" className="text-emerald-400 underline underline-offset-2 hover:text-emerald-300">
            Learn every bet type →
          </Link>
        </PageInfo>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-neutral-300 mb-2">
          Auto Parlays ({autoParlays.length})
        </h2>
        <SectionNote>
          Built by the app from this week&rsquo;s best player props. Just for reference — not
          graded, not tied to your account.
        </SectionNote>
        {autoParlays.length === 0 ? (
          <p className="text-sm text-neutral-500">
            Not enough edge-worthy picks this week to build a parlay.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            {autoParlays.map((p) => {
              const legs = (p.legs as AutoLeg[]) ?? [];
              const badgeColor =
                p.confidence === "High"
                  ? "bg-emerald-500/20 text-emerald-300"
                  : p.confidence === "Moderate"
                    ? "bg-amber-500/20 text-amber-300"
                    : "bg-neutral-700/50 text-neutral-300";
              return (
                <div key={p.id} className="rounded-md border border-neutral-800 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{p.size}-leg parlay</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${badgeColor}`}>
                      {p.confidence}
                    </span>
                  </div>
                  <ul className="text-xs text-neutral-400 space-y-1">
                    {legs.map((leg, i) => {
                      const isFavTeam = leg.team === favTeam?.code;
                      return (
                        <li
                          key={i}
                          style={isFavTeam ? { color: favTeam!.primary } : undefined}
                          className={isFavTeam ? "font-medium" : undefined}
                        >
                          {leg.player} ({leg.team}) — {leg.side} {leg.line} {leg.statType}{" "}
                          <span className={isFavTeam ? "" : "text-neutral-500"}>
                            {formatPrice(leg.priceAmerican)} @ {leg.book}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="text-xs text-neutral-500 pt-1 border-t border-neutral-800 space-y-1.5">
                    <div>
                      Combined win%: {((p.combinedWinPct ?? 0) * 100).toFixed(1)}% · Weakest leg:{" "}
                      {((p.weakestLegWinPct ?? 0) * 100).toFixed(1)}%
                    </div>
                    <PayoutCalc legs={legs} compact />
                    <PushBetButton
                      legs={legs.map((leg) => ({
                        label: `${leg.player} (${leg.team}) — ${leg.side} ${leg.line} ${leg.statType}`,
                        priceAmerican: leg.priceAmerican,
                      }))}
                      title={`${p.size}-leg Auto Parlay`}
                      week={week ?? undefined}
                      sportsbookPrefs={sportsbookPrefs}
                      allowedCategories={platformCategories}
                      compact
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-neutral-300">Your Parlays</h2>
        <SectionNote>
          Add any bet you want below. After the games finish, come back and mark each leg Won,
          Lost, or Push. Only you can see these.
        </SectionNote>
        <ParlayBuilder games={weekGames} propOptions={weekPropOptions} otherSportsPicks={otherSportsPicks} />
        {myParlays.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No parlays yet — build one above to start tracking it.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {myParlays.map((p) => (
              <ParlayCard
                key={p.id}
                id={p.id}
                title={p.title}
                legs={(p.legs as StoredLeg[]) ?? []}
                combinedWinPct={p.combinedWinPct}
                status={p.status}
                createdAt={p.createdAt.toISOString()}
                sportsbookPrefs={sportsbookPrefs}
                allowedCategories={platformCategories}
              />
            ))}
          </div>
        )}
      </div>

      <NextStep
        href="/elo-ratings"
        label="Elo Ratings"
        reason="See the team ratings behind every win percentage in the app."
      />
    </div>
  );
}
