import { db } from "@/db";
import { games, oddsLines, parlayPicks, propLinesRaw, sportGames, sportPropLinesRaw } from "@/db/schema";
import { and, asc, desc, eq, gt, max } from "drizzle-orm";
import { getModelBuilds, type BuildSportFilter } from "@/lib/auto-builds";
import { BuildsView } from "../best-builds/builds-view";
import { SPORTS, type SportKey } from "@/lib/sports/types";
import { currentSeasonYear } from "@/lib/sports/espn";
import { etWeekWindow, inWindow } from "@/lib/week-window";
import type { LegPickerGame, LegPickerProp } from "./leg-picker";
import { ParlayBuilder } from "./parlay-builder";
import { ParlayCard } from "./parlay-card";
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

const SPORT_TABS: { key: BuildSportFilter; label: string }[] = [
  { key: "all", label: "All sports" },
  { key: "nfl", label: "NFL" },
  ...(Object.values(SPORTS).map((d) => ({
    key: d.key,
    label: d.key === "ncaaf" ? "NCAAF" : d.key === "ncaab" ? "NCAAB" : d.label,
  })) as { key: SportKey; label: string }[]),
];

/** A non-NFL sport's games this week (or the next 7 days if none are left) and its synced prop lines, for the builder's dropdowns. */
async function sportBuilderData(sport: SportKey): Promise<{ games: LegPickerGame[]; props: LegPickerProp[] }> {
  const season = currentSeasonYear(sport);
  const upcoming = await db
    .select()
    .from(sportGames)
    .where(
      and(
        eq(sportGames.sport, sport),
        eq(sportGames.season, season),
        eq(sportGames.isFinal, false),
        gt(sportGames.kickoffAt, new Date(Date.now() - 6 * 3600_000))
      )
    )
    .orderBy(asc(sportGames.kickoffAt));
  const wk = etWeekWindow();
  let list = upcoming.filter((g) => inWindow(g.kickoffAt, wk));
  if (list.length === 0 && upcoming[0]?.kickoffAt) {
    const start = upcoming[0].kickoffAt.getTime();
    list = upcoming.filter((g) => (g.kickoffAt?.getTime() ?? 0) < start + 7 * 86_400_000);
  }
  const [latest] = await db
    .select({ week: max(sportPropLinesRaw.week) })
    .from(sportPropLinesRaw)
    .where(and(eq(sportPropLinesRaw.sport, sport), eq(sportPropLinesRaw.season, season)));
  const props =
    latest?.week != null
      ? await db
          .select({
            player: sportPropLinesRaw.player,
            team: sportPropLinesRaw.team,
            statType: sportPropLinesRaw.statType,
            line: sportPropLinesRaw.line,
            side: sportPropLinesRaw.side,
            book: sportPropLinesRaw.book,
            priceAmerican: sportPropLinesRaw.priceAmerican,
          })
          .from(sportPropLinesRaw)
          .where(and(eq(sportPropLinesRaw.sport, sport), eq(sportPropLinesRaw.season, season), eq(sportPropLinesRaw.week, latest.week)))
      : [];
  return {
    games: list.map((g) => ({
      id: g.id,
      week: g.week,
      homeTeam: g.homeTeam,
      awayTeam: g.awayTeam,
      moneylineHomeOdds: g.moneylineHomeOdds,
      moneylineAwayOdds: g.moneylineAwayOdds,
      spreadHomeLine: g.spreadHomeLine,
      spreadHomePriceAmerican: g.spreadHomePriceAmerican,
      spreadAwayPriceAmerican: g.spreadAwayPriceAmerican,
      totalLine: g.totalLine,
      totalOverPriceAmerican: g.totalOverPriceAmerican,
      totalUnderPriceAmerican: g.totalUnderPriceAmerican,
    })),
    props,
  };
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

export default async function ParlaysPage({ searchParams }: { searchParams: Promise<{ sport?: string }> }) {
  const { sport: sportParam } = await searchParams;
  const filter: BuildSportFilter =
    sportParam === "nfl" || (sportParam && sportParam in SPORTS) ? (sportParam as BuildSportFilter) : "all";
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

  const [buildsToday, buildsWeek] = await Promise.all([getModelBuilds("today", filter), getModelBuilds("week", filter)]);

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
  const isOtherSport = filter !== "all" && filter !== "nfl";
  const sportData = isOtherSport ? await sportBuilderData(filter as SportKey) : null;
  const otherSportsPicks =
    filter === "nfl"
      ? []
      : (await otherSportsPickCandidates()).filter((p) => filter === "all" || p.sportKey === filter);
  const builderGames = sportData ? sportData.games : weekGames;
  const builderProps = sportData ? sportData.props : weekPropOptions;
  const tabLabel = SPORT_TABS.find((t) => t.key === filter)?.label ?? "All sports";

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
            Use the sport buttons to switch between <strong>All sports</strong> or any one sport.{" "}
            <strong>Auto Parlays</strong> are built by the model for today or this week, in every size from 2
            to 8 legs, from game picks and from player props, one leg per game (one prop per team).
            &ldquo;Model chance all hit&rdquo; is the chance every leg wins. These are for reference,
            not tied to your account.
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

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Sport">
        {SPORT_TABS.map((t) => (
          <Link
            key={t.key}
            href={t.key === "all" ? "/parlays" : `/parlays?sport=${t.key}`}
            role="tab"
            aria-selected={filter === t.key}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              filter === t.key ? "bg-orange-600 text-white" : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-neutral-300">Auto Parlays · {tabLabel}</h2>
        <SectionNote>
          The model&rsquo;s best 2- to 8-leg parlays for {filter === "all" ? "every sport" : tabLabel}, from game picks and
          from player props. Tap any leg to see why it was picked.
        </SectionNote>
        <BuildsView
          today={buildsToday}
          week={buildsWeek}
          sportsbookPrefs={sportsbookPrefs}
          allowedCategories={platformCategories}
        />
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-neutral-300">Your Parlays</h2>
        <SectionNote>
          Add any bet you want below. After the games finish, come back and mark each leg Won,
          Lost, or Push. Only you can see these.
        </SectionNote>
        <ParlayBuilder
          key={filter}
          games={builderGames}
          propOptions={builderProps}
          otherSportsPicks={otherSportsPicks}
        />
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
