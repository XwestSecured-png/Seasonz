import type { TrustView } from "../trust-badge";
import { scoreLines } from "@/lib/prop-score";
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
import { and, asc, desc, eq, gt, inArray, max, sql } from "drizzle-orm";
import { MAIN_BOOKS } from "@/lib/football-markets";
import { AllLinesBrowser } from "./all-lines-browser";
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
import { getPlayerOptions } from "@/lib/sports/player-options";

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
          // Main sportsbooks + the model's fair price only: the feed also
          // carries dozens of DFS apps/exchanges (70k+ rows a week).
          .where(and(eq(propLinesRaw.season, season), eq(propLinesRaw.week, week), inArray(propLinesRaw.book, MAIN_BOOKS)))
      : [];
  const browseLines = rawLines.map((r) => ({
      player: r.player,
      team: r.team,
      statType: r.statType,
      line: r.line,
      side: r.side,
      book: r.book,
      priceAmerican: r.priceAmerican,
    }));
  // Our chance for every posted line and side, spelled out (lib/prop-score.ts).
  const scores = week !== null ? await scoreLines("nfl", season, week, browseLines).catch(() => ({})) : {};
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
        form and the upcoming opponent&rsquo;s real defense. Our chance blends the model with the
        betting market&rsquo;s own chance for that line (books know injury and role news the stats
        don&rsquo;t). Only picks at 70% or higher that also beat the book&rsquo;s price by 3+ points are
        shown — a likely prop at a bad price still loses money over time.
        {week !== null && <> Currently showing week {week}.</>}
      </p>
      <PageInfo>
        <p>
          Sorted by team, then by player, then by stat type, so it&rsquo;s easy to scan one team
          or player at a time. Use the filters above to narrow it down to one team or one stat.
        </p>
        <p>
          <strong>Trust</strong> (High / Medium / Low) says how much to believe a pick&rsquo;s chance. Every pick here is
          70%+, so trust looks at what the model leaves out: how many games of data there are, how often the player has
          cleared this exact line lately, how up-and-down the stat is, and (in basketball and hockey) whether the player&rsquo;s minutes
          have been steady. It was tested on past games in every sport: High-trust picks hit about 85&ndash;88% of the
          time, Medium about 75%, Low about 70% (tested on the model alone, before the market blend). If the model is 15+
          points above the betting market, trust tops out at Medium, since gaps that big often mean news the model
          hasn&rsquo;t seen. Tap a badge to see why. Pick&rsquo;em apps (PrizePicks, Underdog and the like) aren&rsquo;t used as
          prices: their even-money &ldquo;odds&rdquo; aren&rsquo;t real ones.
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
        <Link prefetch={false} href="/learn#props" className="text-emerald-400 underline underline-offset-2 hover:text-emerald-300">
          Learn every bet type →
        </Link>
      </PageInfo>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-neutral-200">Every prop this week</h2>
        <p className="text-xs text-neutral-500 max-w-2xl">
          Every line FanDuel, DraftKings, BetMGM and Caesars posted (best price first), including touchdowns, QB
          stats, turnovers, sacks, tackles and kicking. Each line shows our chance it hits, spelled out (from
          &ldquo;almost no chance&rdquo; to &ldquo;very, very likely&rdquo;), with a trust badge on the likely side.
          Fumbles, QB sacked, INT thrown and 2+ TDs show the model&rsquo;s chance from each player&rsquo;s rate this
          season, since books rarely post them.
        </p>
        <AllLinesBrowser lines={browseLines} scores={scores} />
      </section>

      <h2 className="text-sm font-semibold text-neutral-200">Model picks (70%+)</h2>
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
                trust: (p.trust as TrustView | null) ?? null,
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

  const playerOptions = await getPlayerOptions(
    sport,
    Array.from(new Set(upcoming.flatMap((g) => [g.homeTeam, g.awayTeam])))
  );

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

  // Raw lines for the latest week synced (even if no pick cleared 70%).
  const [latestRaw] = await db
    .select({ week: max(sportPropLinesRaw.week) })
    .from(sportPropLinesRaw)
    .where(and(eq(sportPropLinesRaw.sport, sport), eq(sportPropLinesRaw.season, season)));
  const rawWeek = latestRaw?.week ?? modelWeek;
  const rawModelLines =
    rawWeek !== null
      ? await db
          .select()
          .from(sportPropLinesRaw)
          .where(
            and(
              eq(sportPropLinesRaw.sport, sport),
              eq(sportPropLinesRaw.season, season),
              eq(sportPropLinesRaw.week, rawWeek),
              inArray(sportPropLinesRaw.book, MAIN_BOOKS)
            )
          )
      : [];
  const lineScores =
    rawWeek !== null
      ? await scoreLines(
          sport,
          season,
          rawWeek,
          rawModelLines.map((r) => ({ player: r.player, statType: r.statType, line: r.line, side: r.side, book: r.book, priceAmerican: r.priceAmerican }))
        ).catch(() => ({}))
      : {};
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
                  trust: (p.trust as TrustView | null) ?? null,
                  otherBooks,
                };
              })}
          />
        )}
      </div>

      {rawModelLines.length > 0 && (
        <section className="space-y-2 border-t border-neutral-800 pt-5">
          <h2 className="text-sm font-semibold text-neutral-200">Every prop this week</h2>
          <p className="text-xs text-neutral-500 max-w-2xl">
            Every line FanDuel, DraftKings, BetMGM and Caesars posted, best price first. Each line shows our chance it
            hits, spelled out (from &ldquo;almost no chance&rdquo; to &ldquo;very, very likely&rdquo;), with a trust badge
            on the likely side.
          </p>
          <AllLinesBrowser
            scores={lineScores}
            lines={rawModelLines
              .filter((r) => MAIN_BOOKS.includes(r.book))
              .map((r) => ({
                player: r.player,
                team: r.team,
                statType: r.statType,
                line: r.line,
                side: r.side,
                book: r.book,
                priceAmerican: r.priceAmerican,
              }))}
          />
        </section>
      )}

      <div className="border-t border-neutral-800 pt-5">
        <OtherSportProps sport={sport} games={games} picks={picks} playerOptions={playerOptions} />
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
            <Link prefetch={false}
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
