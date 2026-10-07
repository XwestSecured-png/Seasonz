import Link from "next/link";
import { db } from "@/db";
import { games, injuryReports, parlayPicks } from "@/db/schema";
import { count, desc, eq, sql } from "drizzle-orm";
import { SyncButton } from "./sync-button";
import { PageInfo } from "./page-info";
import { SectionNote } from "./section-note";
import { NextStep } from "./next-step";
import { getFavoriteTeam } from "@/lib/favorite-team";
import { favoriteHighlightStyle } from "@/lib/team-colors";
import { getCurrentUser } from "@/lib/current-user";
import { confidenceScore, confidenceTier, CONFIDENCE_TIER_CLASS, type ConfidenceTier } from "@/lib/confidence";
import { suggestedStakePct, suggestedStakeUsd } from "@/lib/stake-sizing";
import type { ParlayLeg } from "@/lib/props-model";
import { otherSportsBestBets } from "@/lib/sports/best-bets";
import { WelcomeTour } from "./welcome-tour";

/** One row in the Dashboard's unified, cross-sport Best Bets list. NFL rows carry a real edge% (computed against the sportsbook line); every other sport's row is the model's own confidence pick — see lib/sports/best-bets.ts for why those sports don't have a real edge yet. */
interface BestBetRow {
  key: string;
  sportLabel: string;
  href: string | null;
  matchup: string;
  pickLabel: string;
  moved: boolean;
  score: number | null;
  tier: ConfidenceTier | null;
  edgePct: number | null;
  stakePct: number | null;
  stakeUsd: number | null;
  highlightFav: boolean;
}

/** True when the Best Bet's own market line or price has moved since the opening number — same opening-vs-current columns CLV uses, just as a yes/no badge for the Dashboard summary list. */
function bestBetHasMoved(g: {
  bestMarket: string | null;
  spreadHomeLine: number | null;
  openingSpreadHomeLine: number | null;
  totalLine: number | null;
  openingTotalLine: number | null;
  moneylineHomeOdds: number | null;
  openingMoneylineHomeOdds: number | null;
}): boolean {
  if (g.bestMarket === "SPREAD") return g.spreadHomeLine !== g.openingSpreadHomeLine;
  if (g.bestMarket === "TOTAL") return g.totalLine !== g.openingTotalLine;
  if (g.bestMarket === "ML") return g.moneylineHomeOdds !== g.openingMoneylineHomeOdds;
  return false;
}

/** Best Bet's own price, for the stake-sizing formula — whichever side/market the pick actually is. */
function bestBetPriceAmerican(g: {
  bestMarket: string | null;
  aiPickTeam: string | null;
  homeTeam: string;
  moneylineHomeOdds: number | null;
  moneylineAwayOdds: number | null;
  spreadAiPickTeam: string | null;
  spreadHomePriceAmerican: number | null;
  spreadAwayPriceAmerican: number | null;
  totalAiPick: string | null;
  totalOverPriceAmerican: number | null;
  totalUnderPriceAmerican: number | null;
}): number | null {
  if (g.bestMarket === "ML") {
    return g.aiPickTeam === g.homeTeam ? g.moneylineHomeOdds : g.moneylineAwayOdds;
  }
  if (g.bestMarket === "SPREAD") {
    return g.spreadAiPickTeam === "HOME" ? g.spreadHomePriceAmerican : g.spreadAwayPriceAmerican;
  }
  if (g.bestMarket === "TOTAL") {
    return g.totalAiPick === "OVER" ? g.totalOverPriceAmerican : g.totalUnderPriceAmerican;
  }
  return null;
}

export const dynamic = "force-dynamic";

function currentNflSeason(): number {
  const now = new Date();
  return now.getMonth() >= 1 ? now.getFullYear() : now.getFullYear() - 1;
}

function formatPrice(price: number | null): string {
  if (price === null) return "—";
  return price > 0 ? `+${price}` : `${price}`;
}

export default async function DashboardPage() {
  const season = currentNflSeason();
  const favTeam = await getFavoriteTeam();
  const user = await getCurrentUser();

  const [gameCountRow] = await db
    .select({ n: count() })
    .from(games)
    .where(eq(games.season, season));

  const [finalCountRow] = await db
    .select({ n: count() })
    .from(games)
    .where(sql`${games.season} = ${season} AND ${games.isFinal} = true`);

  const [injuryCountRow] = await db
    .select({ n: count() })
    .from(injuryReports)
    .where(eq(injuryReports.season, season));

  const hasSynced = (gameCountRow?.n ?? 0) > 0;

  // Everything below only makes sense once there's actually data — the rest
  // of this page's queries are cheap no-ops against an empty table, but
  // skipping them when there's nothing synced yet keeps the "first run"
  // experience simple (just the amber notice + stat cards).
  const upcomingGames = hasSynced
    ? await db
        .select()
        .from(games)
        .where(sql`${games.season} = ${season} AND ${games.isFinal} = false`)
        .orderBy(sql`${games.week} asc, ${games.gameDate} asc`)
    : [];

  const activeWeek =
    upcomingGames.length > 0 ? Math.min(...upcomingGames.map((g) => g.week)) : null;

  // Top edges this week, regardless of which market they came from — this is
  // the single list someone opening the app wants to see first.
  const bestBets = upcomingGames
    .filter((g) => g.week === activeWeek && g.bestMarket !== null)
    .sort((a, b) => (b.bestMarketEdgePct ?? 0) - (a.bestMarketEdgePct ?? 0))
    .slice(0, 5);

  // Every other sport's best upcoming pick, by the model's own confidence
  // (no real sportsbook edge for these yet — see lib/sports/best-bets.ts).
  const otherBets = await otherSportsBestBets();

  const nflRows: BestBetRow[] = bestBets.map((g) => {
    const score = g.bestMarketConfidencePct !== null ? confidenceScore(g.bestMarketConfidencePct) : null;
    const price = bestBetPriceAmerican(g);
    return {
      key: `nfl-${g.id}`,
      sportLabel: "NFL",
      href: "/model-tracker",
      matchup: `${g.awayTeam} @ ${g.homeTeam}`,
      pickLabel: g.bestMarketLabel ?? "",
      moved: bestBetHasMoved(g),
      score,
      tier: score !== null ? confidenceTier(score) : null,
      edgePct: g.bestMarketEdgePct,
      stakePct:
        g.bestMarketConfidencePct !== null && price !== null
          ? suggestedStakePct(g.bestMarketConfidencePct, price)
          : null,
      stakeUsd:
        g.bestMarketConfidencePct !== null && price !== null
          ? suggestedStakeUsd(g.bestMarketConfidencePct, price, user?.bankrollUsd ?? null)
          : null,
      highlightFav: g.homeTeam === favTeam?.code || g.awayTeam === favTeam?.code,
    };
  });

  const otherRows: BestBetRow[] = otherBets.map((b) => ({
    key: `${b.sportKey}-${b.matchup}`,
    sportLabel: b.sportLabel,
    href: b.href,
    matchup: b.matchup,
    pickLabel: b.pickLabel,
    moved: false,
    score: b.score,
    tier: b.tier,
    edgePct: null,
    stakePct: null,
    stakeUsd: null,
    highlightFav: false,
  }));

  // One ranked list across every sport — real NFL edge picks and every
  // other sport's model-confidence pick, sorted by the same 0-100
  // confidence score so they compete fairly on one list.
  const allBets = [...nflRows, ...otherRows]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 8);

  const favTeamNextGame = favTeam
    ? (upcomingGames.find((g) => g.homeTeam === favTeam.code || g.awayTeam === favTeam.code) ??
      null)
    : null;

  const parlayOfTheWeek =
    activeWeek !== null
      ? (
          await db
            .select()
            .from(parlayPicks)
            .where(
              sql`${parlayPicks.kind} = 'auto' AND ${parlayPicks.season} = ${season} AND ${parlayPicks.week} = ${activeWeek}`
            )
            .orderBy(desc(parlayPicks.combinedWinPct))
            .limit(1)
        )[0] ?? null
      : null;

  // "Parlay for Today" — same auto-built parlay pool as Parlay of the Week,
  // just restricted at sync time (lib/sync.ts) to picks whose game is today,
  // so this reads as "what's live today" next to the whole-week view above.
  // Most days of an NFL week have no games at all, so an empty result here
  // is the normal case, not a bug.
  const parlayForToday =
    activeWeek !== null
      ? (
          await db
            .select()
            .from(parlayPicks)
            .where(
              sql`${parlayPicks.kind} = 'auto_daily' AND ${parlayPicks.season} = ${season} AND ${parlayPicks.week} = ${activeWeek}`
            )
            .orderBy(desc(parlayPicks.combinedWinPct))
            .limit(1)
        )[0] ?? null
      : null;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-lg font-semibold">Dashboard — {season} season</h1>
          <p className="text-sm text-neutral-400">
            Seasonz picks, odds, and model ratings for this week.
          </p>
        </div>
        {/* sports="all" so one click pulls NFL and every other sport in a
            single request (app/api/sync/route.ts runs them in one POST) —
            per-sport pages still have their own single-sport button. */}
        <SyncButton season={season} sports="all" />
      </div>

      <WelcomeTour />

      <PageInfo>
        <p>
          This is your home base for the week: the model&rsquo;s top picks across every sport,
          your favorite team&rsquo;s next game, and the top auto-built parlay — all pulled from
          the same model behind Model Tracker, Player Props, and Parlays.
        </p>
        <p>
          Click &ldquo;Sync now&rdquo; any time to pull the latest schedule, scores, ratings,
          injury news, and betting lines. It also runs once a day on its own.
        </p>
        <p>
          Use the nav bar (or &ldquo;More&rdquo; on mobile) to explore Injury Impact, Model
          Tracker, Factor Performance, Elo Ratings, Player Props, Parlays, and every other sport
          (NBA, WNBA, NHL, MLB, and college).
        </p>
      </PageInfo>

      {!hasSynced && (
        <div className="rounded-md border border-amber-900 bg-amber-950/40 px-4 py-3 text-sm text-amber-200">
          No data yet for {season} — click &ldquo;Sync now&rdquo; to pull the schedule, run Elo,
          and check injury reports for the first time.
        </div>
      )}

      {favTeamNextGame && favTeam && (
        <div
          className="rounded-md border border-neutral-800 px-4 py-3 space-y-1"
          style={favoriteHighlightStyle(favTeam, true)}
        >
          <div className="text-xs text-neutral-400">
            Week {favTeamNextGame.week} · {favTeam.name}&rsquo;s next game
          </div>
          <div className="text-lg font-semibold">
            {favTeamNextGame.awayTeam} @ {favTeamNextGame.homeTeam}
          </div>
          <div className="text-sm text-neutral-300">
            {favTeamNextGame.bestMarket ? (
              <>
                Best bet:{" "}
                <span className="text-emerald-400 font-medium">
                  {favTeamNextGame.bestMarketLabel}
                </span>{" "}
                ({((favTeamNextGame.bestMarketEdgePct ?? 0) * 100).toFixed(1)}% edge)
              </>
            ) : favTeamNextGame.homeWinPctPre !== null ? (
              <>
                Model favorite:{" "}
                {favTeamNextGame.homeWinPctPre > 0.5
                  ? favTeamNextGame.homeTeam
                  : favTeamNextGame.awayTeam}{" "}
                (
                {(
                  (favTeamNextGame.homeWinPctPre > 0.5
                    ? favTeamNextGame.homeWinPctPre
                    : 1 - favTeamNextGame.homeWinPctPre) * 100
                ).toFixed(1)}
                %)
              </>
            ) : (
              "No prediction yet — sync to get one."
            )}
          </div>
        </div>
      )}

      <div>
        <h2 className="text-sm font-semibold text-neutral-300 mb-2">
          This Week&rsquo;s Best Bets — All Sports
        </h2>
        <SectionNote>
          Ranked by the model&rsquo;s own confidence (0-100) across every sport. NFL rows also
          show a real edge% (how far the model disagrees with the sportsbook line) and a
          suggested stake — 📈 means that line has moved since it opened. Other sports don&rsquo;t
          have betting lines synced yet, so their pick is the model&rsquo;s own favorite, not a
          real edge. Full NFL breakdown on Model Tracker, or log a bet on Bet Tracker.
        </SectionNote>
        {allBets.length === 0 ? (
          <p className="text-sm text-neutral-500">
            {hasSynced ? "No picks found this week yet." : "Sync to see this week's picks."}
          </p>
        ) : (
          <div className="rounded-md border border-neutral-800 divide-y divide-neutral-800">
            {allBets.map((row) => {
              const rowContent = (
                <div
                  className="px-4 py-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-3 text-sm"
                  style={favoriteHighlightStyle(favTeam, row.highlightFav)}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="shrink-0 rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-400">
                      {row.sportLabel}
                    </span>
                    <span className="text-neutral-400 truncate">{row.matchup}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-emerald-400 font-medium">
                      {row.pickLabel}
                      {row.moved && (
                        <span className="ml-1" title="Line has moved since it opened">
                          📈
                        </span>
                      )}
                    </span>
                    {row.score !== null && row.tier && (
                      <span
                        className={`px-1.5 py-0.5 rounded text-xs font-medium ${CONFIDENCE_TIER_CLASS[row.tier]}`}
                        title="Model's own win probability for this pick, 0-100"
                      >
                        {row.score}
                      </span>
                    )}
                    {row.edgePct !== null && (
                      <span className="text-neutral-500 text-xs shrink-0">
                        {(row.edgePct * 100).toFixed(1)}% edge
                      </span>
                    )}
                    {row.stakePct !== null && (
                      <span className="text-neutral-500 text-xs shrink-0">
                        Stake: {(row.stakePct * 100).toFixed(1)}%
                        {row.stakeUsd !== null ? ` (~$${row.stakeUsd})` : ""}
                      </span>
                    )}
                  </div>
                </div>
              );
              return row.href ? (
                <Link key={row.key} href={row.href} className="block hover:bg-neutral-900/50">
                  {rowContent}
                </Link>
              ) : (
                <div key={row.key}>{rowContent}</div>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <h2 className="text-sm font-semibold text-neutral-300 mb-2">Parlay for Today</h2>
          <SectionNote>
            Same auto-built parlay pool, narrowed to picks whose game is today. Most days of an
            NFL week don&rsquo;t have a game at all — that&rsquo;s expected, not a bug.
          </SectionNote>
          {!parlayForToday ? (
            <p className="text-sm text-neutral-500">
              {hasSynced
                ? "No games today — check back on gameday."
                : "Sync to generate today's parlay."}
            </p>
          ) : (
            <div className="rounded-md border border-neutral-800 px-4 py-3 space-y-2">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <span className="text-sm font-medium">{parlayForToday.size}-leg parlay</span>
                <span className="text-xs text-neutral-500">
                  {parlayForToday.confidence} confidence ·{" "}
                  {((parlayForToday.combinedWinPct ?? 0) * 100).toFixed(1)}% combined
                </span>
              </div>
              <ul className="text-sm text-neutral-300 space-y-0.5">
                {(parlayForToday.legs as ParlayLeg[]).map((leg, i) => (
                  <li key={i} className="text-neutral-400">
                    {leg.player} ({leg.team}) {leg.side} {leg.line} {leg.statType} (
                    {formatPrice(leg.priceAmerican)})
                  </li>
                ))}
              </ul>
              <Link
                href="/parlays"
                className="inline-block text-sm text-blue-400 hover:text-blue-300 font-medium"
              >
                See all parlays →
              </Link>
            </div>
          )}
        </div>

        <div>
          <h2 className="text-sm font-semibold text-neutral-300 mb-2">Parlay of the Week</h2>
          <SectionNote>
            The model&rsquo;s best auto-built player-prop combo for this week, ranked by combined
            win chance. Build your own on the Parlays page.
          </SectionNote>
          {!parlayOfTheWeek ? (
            <p className="text-sm text-neutral-500">
              {hasSynced
                ? "No auto-parlay for this week yet — needs player prop lines."
                : "Sync to generate this week's parlays."}
            </p>
          ) : (
            <div className="rounded-md border border-neutral-800 px-4 py-3 space-y-2">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <span className="text-sm font-medium">
                  {parlayOfTheWeek.size}-leg parlay
                </span>
                <span className="text-xs text-neutral-500">
                  {parlayOfTheWeek.confidence} confidence ·{" "}
                  {((parlayOfTheWeek.combinedWinPct ?? 0) * 100).toFixed(1)}% combined
                </span>
              </div>
              <ul className="text-sm text-neutral-300 space-y-0.5">
                {(parlayOfTheWeek.legs as ParlayLeg[]).map((leg, i) => (
                  <li key={i} className="text-neutral-400">
                    {leg.player} ({leg.team}) {leg.side} {leg.line} {leg.statType} (
                    {formatPrice(leg.priceAmerican)})
                  </li>
                ))}
              </ul>
              <Link
                href="/parlays"
                className="inline-block text-sm text-blue-400 hover:text-blue-300 font-medium"
              >
                See all parlays →
              </Link>
            </div>
          )}
        </div>
      </div>

      <div>
        <SectionNote>
          Season totals — these three numbers grow as the season goes on.
        </SectionNote>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard label="Games tracked" value={gameCountRow?.n ?? 0} />
          <StatCard label="Final results" value={finalCountRow?.n ?? 0} />
          <StatCard label="Injury report rows" value={injuryCountRow?.n ?? 0} />
        </div>
      </div>

      <NextStep
        href="/factor-performance"
        label="Factor Performance"
        reason="See which of the model's factors have actually been right so far this season."
      />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-neutral-800 px-4 py-3">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-sm text-neutral-400">{label}</div>
    </div>
  );
}
