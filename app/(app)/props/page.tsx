import Link from "next/link";
import { db } from "@/db";
import {
  oddsLines,
  propLinesRaw,
  sportGames,
  sportOddsLines,
  sportPropLinesRaw,
  userPropPicks,
} from "@/db/schema";
import { and, asc, desc, eq, gt, max, sql } from "drizzle-orm";
import { etWeekWindow, inWindow } from "@/lib/week-window";
import { PropsExplorer } from "./props-explorer";
import { SportPropsExplorer } from "./sport-props-explorer";
import { OtherSportProps, type UpcomingGameOption, type ExistingPropPick } from "./other-sport-props";
import { PageInfo } from "../page-info";
import { NextStep } from "../next-step";
import { getFavoriteTeam } from "@/lib/favorite-team";
import { getCurrentUser } from "@/lib/current-user";
import { SPORTS, type SportKey } from "@/lib/sports/types";
import { currentSeasonYear } from "@/lib/sports/espn";
import { PROP_STAT_HINTS } from "@/lib/sports/prop-stat-hints";

export const dynamic = "force-dynamic";

function currentNflSeason(): number {
  const now = new Date();
  return now.getMonth() >= 1 ? now.getFullYear() : now.getFullYear() - 1;
}

function isSportKey(v: string | undefined): v is SportKey {
  return typeof v === "string" && v in SPORTS;
}

const TABS: { key: "nfl" | SportKey; label: string }[] = [
  { key: "nfl", label: "NFL" },
  ...(Object.values(SPORTS).map((s) => ({ key: s.key, label: s.label })) as { key: SportKey; label: string }[]),
];

async function NflProps() {
  const season = currentNflSeason();
  const favTeam = await getFavoriteTeam();

  const [latest] = await db
    .select({ week: max(oddsLines.week) })
    .from(oddsLines)
    .where(eq(oddsLines.season, season));
  const week = latest?.week ?? null;

  const picks =
    week !== null
      ? await db
          .select()
          .from(oddsLines)
          .where(and(eq(oddsLines.season, season), eq(oddsLines.week, week)))
          .orderBy(desc(sql`abs(${oddsLines.edgePct})`))
      : [];

  // Every raw book price for this week, grouped by the exact player/stat/
  // line/side combo — lets the Props page show "which book pays best" for
  // a pick even though only one book's price is the one that cleared edge.
  const rawLines =
    week !== null
      ? await db
          .select()
          .from(propLinesRaw)
          .where(and(eq(propLinesRaw.season, season), eq(propLinesRaw.week, week)))
      : [];
  const booksByLine = new Map<string, { book: string; priceAmerican: number }[]>();
  for (const r of rawLines) {
    const key = `${r.player}|${r.statType}|${r.line}|${r.side}`;
    const list = booksByLine.get(key) ?? [];
    list.push({ book: r.book, priceAmerican: r.priceAmerican });
    booksByLine.set(key, list);
  }
  for (const list of booksByLine.values()) {
    // Best price for the bettor first — a higher American odds number is
    // always the better payout (+120 beats -105 beats -115), so a plain
    // descending numeric sort is exactly "best price first."
    list.sort((a, b) => b.priceAmerican - a.priceAmerican);
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-neutral-400 max-w-2xl">
        Player stats compared against this week&rsquo;s sportsbook lines, adjusted for recent
        form and the upcoming opponent&rsquo;s real defense. Only picks at 70% model confidence
        or higher are shown — a close call isn&rsquo;t worth a pick.
        {week !== null && <> Currently showing week {week}.</>}
      </p>
      <PageInfo>
        <p>
          Sorted by team, then by player, then by stat type, so it&rsquo;s easy to scan one team
          or player at a time. Use the filters above to narrow it down to one team or one stat.
        </p>
        <p>
          For yardage and reception stats: the projection behind each pick is a recency-weighted
          average of the player&rsquo;s last few games (not a flat season average), adjusted up
          or down for how much of that stat the upcoming opponent has actually allowed this
          season. From that, the model computes its own real statistical win chance for
          Over/Under against the book&rsquo;s line — not the sportsbook&rsquo;s implied odds from
          the price — and only shows it here if that chance is 70% or better. A player listed as
          OUT or DOUBTFUL this week is left off entirely, whatever their season stats say. When
          more than one sportsbook posts that same line, a &ldquo;Compare books&rdquo; link shows
          every book&rsquo;s price side by side so you can see which one pays best.
        </p>
        <p>
          Touchdowns, Turnovers, Pass Protection, and Defense work differently. They&rsquo;re
          labeled &ldquo;model projection only&rdquo; because there&rsquo;s no sportsbook line to
          compare against — these are rare, one-off events, not steady averages. Instead, the
          model shows each player&rsquo;s own chance of it happening this week, as a simple
          percentage (also held to the same 70%+ bar). Anytime Sack and Anytime INT are the only
          two categories that cover defensive players — everything else on this page is offense
          only.
        </p>
        <p>Want to combine a few of these into a bet, or track your own? Head to the Parlays page.</p>
      </PageInfo>
      <PageInfo title="What it means: how a player prop wins">
        <p>
          A player prop is an Over/Under on one player&rsquo;s stat. Over 64.5 receiving yards wins at 65 or more;
          Under wins at 64 or fewer. Whole-number lines push if the player lands exactly on the number.
        </p>
        <p>The team result doesn&rsquo;t matter. If the player doesn&rsquo;t play, most books void the bet and refund it.</p>
        <Link href="/learn#props" className="text-emerald-400 underline underline-offset-2 hover:text-emerald-300">
          Learn every bet type →
        </Link>
      </PageInfo>

      {week === null ? (
        <p className="text-sm text-neutral-500">
          No prop data yet — run a sync from the Dashboard (requires an Odds API key to be
          configured).
        </p>
      ) : picks.length === 0 ? (
        <p className="text-sm text-neutral-500">
          Nothing cleared 70% model confidence this week — that can happen, especially early in
          a season with less data to work from. Check back after the next sync.
        </p>
      ) : (
        <PropsExplorer
          favTeam={favTeam ? { code: favTeam.code, primary: favTeam.primary } : null}
          picks={picks
            .filter((p) => p.player && p.team && p.statType)
            .map((p) => {
              const otherBooks =
                p.line !== null
                  ? (booksByLine.get(`${p.player}|${p.statType}|${p.line}|${p.side}`) ?? [])
                  : [];
              return {
                id: p.id,
                player: p.player!,
                team: p.team!,
                statType: p.statType!,
                line: p.line,
                side: p.side,
                priceAmerican: p.priceAmerican,
                book: p.book,
                projection: p.projection,
                edgePct: p.edgePct,
                modelWinPct: p.modelWinPct,
                otherBooks,
              };
            })}
        />
      )}
    </div>
  );
}

async function OtherSportPropsSection({ sport, userId }: { sport: SportKey; userId: number | null }) {
  const def = SPORTS[sport];
  const season = currentSeasonYear(sport);

  // This week's games (Mon–Sun ET); if none are left this week (season
  // not started, break), the next 7 days from the next scheduled game.
  const allUpcoming = await db
    .select({
      id: sportGames.id,
      homeTeam: sportGames.homeTeam,
      awayTeam: sportGames.awayTeam,
      kickoffAt: sportGames.kickoffAt,
    })
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
  let upcoming = allUpcoming.filter((g) => inWindow(g.kickoffAt, wk));
  if (upcoming.length === 0 && allUpcoming[0]?.kickoffAt) {
    const start = allUpcoming[0].kickoffAt.getTime();
    upcoming = allUpcoming.filter((g) => (g.kickoffAt?.getTime() ?? 0) < start + 7 * 86_400_000);
  }

  const games: UpcomingGameOption[] = upcoming.map((g) => ({
    id: g.id,
    homeTeam: g.homeTeam,
    awayTeam: g.awayTeam,
    kickoffAt: g.kickoffAt ? g.kickoffAt.toISOString() : null,
  }));

  // Real, model-driven picks (lib/sports/props-model.ts + lib/sports/sync.ts's
  // "<sport>:props" stage) — whatever cleared the same 70%-model-confidence
  // bar every other sport/market in this app uses. Null week (no sync has
  // produced any yet) and an empty week (nothing cleared 70% this week) are
  // both handled below as the same honest "nothing to show" state NFL's own
  // Props page uses.
  const [latestModelWeek] = await db
    .select({ week: max(sportOddsLines.week) })
    .from(sportOddsLines)
    .where(and(eq(sportOddsLines.sport, sport), eq(sportOddsLines.season, season)));
  const modelWeek = latestModelWeek?.week ?? null;

  const modelPicks =
    modelWeek !== null
      ? await db
          .select()
          .from(sportOddsLines)
          .where(
            and(
              eq(sportOddsLines.sport, sport),
              eq(sportOddsLines.season, season),
              eq(sportOddsLines.week, modelWeek)
            )
          )
          .orderBy(desc(sportOddsLines.modelWinPct))
      : [];

  const rawModelLines =
    modelWeek !== null
      ? await db
          .select()
          .from(sportPropLinesRaw)
          .where(
            and(
              eq(sportPropLinesRaw.sport, sport),
              eq(sportPropLinesRaw.season, season),
              eq(sportPropLinesRaw.week, modelWeek)
            )
          )
      : [];
  const modelBooksByLine = new Map<string, { book: string; priceAmerican: number }[]>();
  for (const r of rawModelLines) {
    const key = `${r.player}|${r.statType}|${r.line}|${r.side}`;
    const list = modelBooksByLine.get(key) ?? [];
    list.push({ book: r.book, priceAmerican: r.priceAmerican });
    modelBooksByLine.set(key, list);
  }
  for (const list of modelBooksByLine.values()) {
    list.sort((a, b) => b.priceAmerican - a.priceAmerican);
  }

  let picks: ExistingPropPick[] = [];
  if (userId !== null) {
    const rows = await db
      .select({
        id: userPropPicks.id,
        gameId: userPropPicks.gameId,
        team: userPropPicks.team,
        player: userPropPicks.player,
        statLabel: userPropPicks.statLabel,
        threshold: userPropPicks.threshold,
        side: userPropPicks.side,
        result: userPropPicks.result,
        actualValue: userPropPicks.actualValue,
        homeTeam: sportGames.homeTeam,
        awayTeam: sportGames.awayTeam,
      })
      .from(userPropPicks)
      .innerJoin(sportGames, eq(sportGames.id, userPropPicks.gameId))
      .where(and(eq(userPropPicks.sport, sport), eq(userPropPicks.userId, userId)))
      .orderBy(desc(userPropPicks.createdAt));

    picks = rows.map((r) => ({
      id: r.id,
      gameId: r.gameId,
      homeTeam: r.homeTeam,
      awayTeam: r.awayTeam,
      team: r.team,
      player: r.player,
      statLabel: r.statLabel,
      threshold: r.threshold,
      side: r.side as "over" | "under",
      result: r.result as ExistingPropPick["result"],
      actualValue: r.actualValue,
    }));
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <p className="text-sm text-neutral-400 max-w-2xl">
          Real sportsbook lines for {def.label}, compared against a recency-weighted,
          opponent-adjusted model projection — same methodology as NFL&rsquo;s Player Props, same
          70%-model-confidence bar. Not every stat type has a sportsbook line for this sport yet
          (see &ldquo;Make your own pick&rdquo; below for those).
        </p>
        {modelWeek === null ? (
          <p className="text-sm text-neutral-500">
            No model picks yet — these need an Odds API key configured and at least a few synced
            games for this sport.
          </p>
        ) : modelPicks.length === 0 ? (
          <p className="text-sm text-neutral-500">
            Nothing cleared 70% model confidence this week — normal early in a season or on a
            light slate. Check back after the next sync.
          </p>
        ) : (
          <SportPropsExplorer
            favTeam={null}
            picks={modelPicks
              .filter((p) => p.team)
              .map((p) => {
                const otherBooks =
                  modelBooksByLine.get(`${p.player}|${p.statType}|${p.line}|${p.side}`) ?? [];
                return {
                  id: p.id,
                  player: p.player,
                  team: p.team!,
                  statType: p.statType,
                  line: p.line,
                  side: p.side,
                  priceAmerican: p.priceAmerican,
                  book: p.book,
                  projection: p.projection,
                  edgePct: p.edgePct,
                  modelWinPct: p.modelWinPct,
                  otherBooks,
                };
              })}
          />
        )}
      </div>

      <div className="border-t border-neutral-800 pt-5">
        <OtherSportProps sport={sport} games={games} picks={picks} statHints={PROP_STAT_HINTS[sport]} />
      </div>
    </div>
  );
}

export default async function PropsPage({
  searchParams,
}: {
  searchParams: Promise<{ sport?: string }>;
}) {
  const { sport: sportParam } = await searchParams;
  const activeTab: "nfl" | SportKey = sportParam === "nfl" || !isSportKey(sportParam) ? "nfl" : sportParam;
  const user = await getCurrentUser();

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <h1 className="text-lg font-semibold">Player Props</h1>
        <div className="flex gap-1.5 flex-wrap">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={t.key === "nfl" ? "/props" : `/props?sport=${t.key}`}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                activeTab === t.key
                  ? "bg-sky-600 text-white"
                  : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
              }`}
            >
              {t.label}
            </Link>
          ))}
        </div>
      </div>

      {activeTab === "nfl" ? <NflProps /> : <OtherSportPropsSection sport={activeTab} userId={user?.id ?? null} />}

      <NextStep
        href="/parlays"
        label="Parlays"
        reason="Combine a few of these into a parlay, or build and grade your own."
      />
    </div>
  );
}
