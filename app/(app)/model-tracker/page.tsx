import { db } from "@/db";
import { games, userPicks, users, lineHistory } from "@/db/schema";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { PickToggle } from "./pick-toggle";
import { americanToImpliedProb } from "@/lib/props-model";
import { getCurrentUser } from "@/lib/current-user";
import { getFavoriteTeam } from "@/lib/favorite-team";
import { favoriteHighlightStyle } from "@/lib/team-colors";
import { PageInfo } from "../page-info";
import { SectionNote } from "../section-note";
import { NextStep } from "../next-step";
import { confidenceScore, confidenceTier, CONFIDENCE_TIER_CLASS } from "@/lib/confidence";
import { isPickLocked, PICK_LOCK_MINUTES_BEFORE_KICKOFF } from "@/lib/time";
import { otherSportsAccuracy } from "@/lib/sports/accuracy";
import Link from "next/link";
import { SportTabs } from "../sport-tabs";

export const dynamic = "force-dynamic";

function currentNflSeason(): number {
  const now = new Date();
  return now.getMonth() >= 1 ? now.getFullYear() : now.getFullYear() - 1;
}

function formatPrice(price: number | null): string {
  if (price === null) return "—";
  return price > 0 ? `+${price}` : `${price}`;
}

function pct(v: number | null): string {
  return `${((v ?? 0) * 100).toFixed(2)}%`;
}

function formatSpread(g: {
  homeTeam: string;
  spreadHomeLine: number | null;
  spreadHomePriceAmerican: number | null;
  spreadAwayPriceAmerican: number | null;
}): string {
  if (g.spreadHomeLine === null) return "—";
  const homeLineStr = `${g.spreadHomeLine > 0 ? "+" : ""}${g.spreadHomeLine}`;
  return `${g.homeTeam} ${homeLineStr} (${formatPrice(g.spreadHomePriceAmerican)}) / ${formatPrice(g.spreadAwayPriceAmerican)}`;
}

function formatTotal(g: {
  totalLine: number | null;
  totalOverPriceAmerican: number | null;
  totalUnderPriceAmerican: number | null;
}): string {
  if (g.totalLine === null) return "—";
  return `O/U ${g.totalLine} (O ${formatPrice(g.totalOverPriceAmerican)} / U ${formatPrice(g.totalUnderPriceAmerican)})`;
}

/** Full breakdown of all three markets' edges, for the Best Bet column's tooltip — so the one-line recommendation doesn't hide what the other two markets looked like. */
function bestBetTooltip(g: {
  aiPickTeam: string | null;
  aiEdgePct: number | null;
  spreadAiPickTeam: string | null;
  spreadAiEdgePct: number | null;
  totalAiPick: string | null;
  totalAiEdgePct: number | null;
}): string {
  const parts = [
    `Moneyline: ${g.aiPickTeam ? `${g.aiPickTeam} (${(Math.abs(g.aiEdgePct ?? 0) * 100).toFixed(1)}%)` : "no edge"}`,
    `Spread: ${g.spreadAiPickTeam ? `${g.spreadAiPickTeam} (${(Math.abs(g.spreadAiEdgePct ?? 0) * 100).toFixed(1)}%)` : "no edge"}`,
    `Total: ${g.totalAiPick ? `${g.totalAiPick} (${(Math.abs(g.totalAiEdgePct ?? 0) * 100).toFixed(1)}%)` : "no edge"}`,
  ];
  return parts.join(" · ");
}

function factorsTooltip(g: {
  weatherAdjPct: number | null;
  restTravelAdjPct: number | null;
  refAdjPct: number | null;
  schemeOffAdjPct: number | null;
  schemeDefAdjPct: number | null;
  turnoverAdjPct: number | null;
  penaltyAdjPct: number | null;
  trenchesAdjPct: number | null;
  aggressionAdjPct: number | null;
  ngsSeparationAdjPct?: number | null;
  pressureAdjPct?: number | null;
  fpiAdjPct: number | null;
  qbrAdjPct: number | null;
  fpiHome: number | null;
  fpiAway: number | null;
  sosHome: number | null;
  sosAway: number | null;
  qbrHome: number | null;
  qbrAway: number | null;
  injuryAdjPct: number | null;
  homeInjuryImpactPct: number | null;
  awayInjuryImpactPct: number | null;
}): string {
  const total =
    (g.weatherAdjPct ?? 0) +
    (g.restTravelAdjPct ?? 0) +
    (g.refAdjPct ?? 0) +
    (g.schemeOffAdjPct ?? 0) +
    (g.schemeDefAdjPct ?? 0) +
    (g.turnoverAdjPct ?? 0) +
    (g.penaltyAdjPct ?? 0) +
    (g.trenchesAdjPct ?? 0) +
    (g.aggressionAdjPct ?? 0) +
    (g.ngsSeparationAdjPct ?? 0) +
    (g.pressureAdjPct ?? 0) +
    (g.fpiAdjPct ?? 0) +
    (g.qbrAdjPct ?? 0) +
    (g.injuryAdjPct ?? 0);
  const parts = [
    `Weather: ${pct(g.weatherAdjPct)}`,
    `Rest/Travel: ${pct(g.restTravelAdjPct)}`,
    `Referee: ${pct(g.refAdjPct)}`,
    `Off scheme: ${pct(g.schemeOffAdjPct)}`,
    `Def scheme: ${pct(g.schemeDefAdjPct)}`,
    `Turnovers: ${pct(g.turnoverAdjPct)}`,
    `Penalties: ${pct(g.penaltyAdjPct)}`,
    `Trenches: ${pct(g.trenchesAdjPct)}`,
    `Aggression: ${pct(g.aggressionAdjPct)}`,
    `NGS separation: ${pct(g.ngsSeparationAdjPct ?? null)}`,
    `Pressure: ${pct(g.pressureAdjPct ?? null)}`,
    `ESPN FPI: ${pct(g.fpiAdjPct)}`,
    `ESPN QBR: ${pct(g.qbrAdjPct)}`,
    `Injuries: ${pct(g.injuryAdjPct)}`,
    `Total: ${(total * 100).toFixed(2)}%`,
  ];
  if (g.fpiHome !== null || g.fpiAway !== null) {
    parts.push(`(FPI ${g.fpiAway ?? "—"} / ${g.fpiHome ?? "—"})`);
  }
  if (g.qbrHome !== null || g.qbrAway !== null) {
    parts.push(`(QBR ${g.qbrAway ?? "—"} / ${g.qbrHome ?? "—"})`);
  }
  if (g.sosHome !== null || g.sosAway !== null) {
    parts.push(`(SOS ${g.sosAway ?? "—"} / ${g.sosHome ?? "—"}, informational only)`);
  }
  if (g.homeInjuryImpactPct !== null || g.awayInjuryImpactPct !== null) {
    parts.push(
      `(Injury impact ${pct(g.awayInjuryImpactPct)} / ${pct(g.homeInjuryImpactPct)}, pre-cap)`
    );
  }
  return parts.join(" · ");
}

/**
 * Closing-line value, from the model's pick's own perspective: did the
 * market move TOWARD the side the model picked since the first line was
 * seen (positive — a classic sign the model found something real) or away
 * from it (negative — the book's own price agreed less by kickoff)?
 * Needs both an opening line and a pick; returns null otherwise.
 */
function closingLineValuePct(g: {
  aiPickTeam: string | null;
  homeTeam: string;
  openingMoneylineHomeOdds: number | null;
  openingMoneylineAwayOdds: number | null;
  moneylineHomeOdds: number | null;
  moneylineAwayOdds: number | null;
}): number | null {
  if (!g.aiPickTeam) return null;
  const pickIsHome = g.aiPickTeam === g.homeTeam;
  const openingPrice = pickIsHome ? g.openingMoneylineHomeOdds : g.openingMoneylineAwayOdds;
  const closingPrice = pickIsHome ? g.moneylineHomeOdds : g.moneylineAwayOdds;
  if (openingPrice === null || closingPrice === null) return null;
  return americanToImpliedProb(closingPrice) - americanToImpliedProb(openingPrice);
}

/**
 * Same idea as closingLineValuePct, but generalized to whichever market the
 * Best Bet actually is — spread and total each keep their own opening/
 * current price pair the same way moneyline does (see db/schema.ts), so the
 * same price-implied-probability-shift math applies, just on a different
 * pair of columns depending on g.bestMarket.
 */
function bestBetClv(g: {
  bestMarket: string | null;
  homeTeam: string;
  aiPickTeam: string | null;
  openingMoneylineHomeOdds: number | null;
  openingMoneylineAwayOdds: number | null;
  moneylineHomeOdds: number | null;
  moneylineAwayOdds: number | null;
  spreadAiPickTeam: string | null;
  openingSpreadHomePriceAmerican: number | null;
  openingSpreadAwayPriceAmerican: number | null;
  spreadHomePriceAmerican: number | null;
  spreadAwayPriceAmerican: number | null;
  totalAiPick: string | null;
  openingTotalOverPriceAmerican: number | null;
  openingTotalUnderPriceAmerican: number | null;
  totalOverPriceAmerican: number | null;
  totalUnderPriceAmerican: number | null;
}): number | null {
  if (g.bestMarket === "SPREAD" && g.spreadAiPickTeam) {
    const isHome = g.spreadAiPickTeam === "HOME";
    const opening = isHome ? g.openingSpreadHomePriceAmerican : g.openingSpreadAwayPriceAmerican;
    const closing = isHome ? g.spreadHomePriceAmerican : g.spreadAwayPriceAmerican;
    if (opening === null || closing === null) return null;
    return americanToImpliedProb(closing) - americanToImpliedProb(opening);
  }
  if (g.bestMarket === "TOTAL" && g.totalAiPick) {
    const isOver = g.totalAiPick === "OVER";
    const opening = isOver ? g.openingTotalOverPriceAmerican : g.openingTotalUnderPriceAmerican;
    const closing = isOver ? g.totalOverPriceAmerican : g.totalUnderPriceAmerican;
    if (opening === null || closing === null) return null;
    return americanToImpliedProb(closing) - americanToImpliedProb(opening);
  }
  // Default / "ML" / no Best Bet yet — the original moneyline-only CLV.
  return closingLineValuePct(g);
}

export default async function ModelTrackerPage() {
  const season = currentNflSeason();
  const user = await getCurrentUser();
  const favTeam = await getFavoriteTeam();

  const finalGames = await db
    .select()
    .from(games)
    .where(and(eq(games.season, season), eq(games.isFinal, true)))
    .orderBy(desc(games.week));

  const allUpcomingGames = await db
    .select()
    .from(games)
    .where(and(eq(games.season, season), eq(games.isFinal, false)))
    .orderBy(asc(games.week));

  // Only the active (soonest) week is open for picks — showing every future
  // week at once just invites someone to accidentally pick a game several
  // weeks out and forget about it.
  const activeWeek =
    allUpcomingGames.length > 0 ? Math.min(...allUpcomingGames.map((g) => g.week)) : null;
  const upcomingGames = allUpcomingGames.filter((g) => g.week === activeWeek);

  // How many times each game's Best Bet market has moved (see db/schema.ts's
  // lineHistory — a row is only appended when the line/price actually
  // changes, so this count is exactly "how many real moves", not sync runs).
  const upcomingGameIds = upcomingGames.map((g) => g.id);
  const moveCountRows =
    upcomingGameIds.length > 0
      ? await db
          .select({ gameId: lineHistory.gameId, market: lineHistory.market, n: count() })
          .from(lineHistory)
          .where(inArray(lineHistory.gameId, upcomingGameIds))
          .groupBy(lineHistory.gameId, lineHistory.market)
      : [];
  const moveCountByGameMarket = new Map(
    moveCountRows.map((r) => [`${r.gameId}|${r.market}`, r.n])
  );

  // This person's own picks only — each account has its own set now (see
  // db/schema.ts's user_picks table).
  const myPicks = user
    ? await db.select().from(userPicks).where(eq(userPicks.userId, user.id))
    : [];
  const myPickByGame = new Map(myPicks.map((p) => [p.gameId, p.team]));

  let aiCorrect = 0;
  let aiGraded = 0;
  let userCorrect = 0;
  let userGraded = 0;

  const gradedRows = finalGames.map((g) => {
    let result: "CORRECT" | "WRONG" | "N/A" = "N/A";
    const actualHome =
      g.homeScore !== null && g.awayScore !== null && g.homeScore !== g.awayScore
        ? g.homeScore > g.awayScore
        : null;

    if (g.homeWinPctPre !== null && actualHome !== null) {
      const predictedHome = g.homeWinPctPre > 0.5;
      result = predictedHome === actualHome ? "CORRECT" : "WRONG";
      aiGraded++;
      if (result === "CORRECT") aiCorrect++;
    }

    const myPick = myPickByGame.get(g.id) ?? null;
    let userResult: "CORRECT" | "WRONG" | "N/A" = "N/A";
    if (myPick && actualHome !== null) {
      const actualWinner = actualHome ? g.homeTeam : g.awayTeam;
      userResult = myPick === actualWinner ? "CORRECT" : "WRONG";
      userGraded++;
      if (userResult === "CORRECT") userCorrect++;
    }

    return { ...g, result, userResult, myPick };
  });

  // Only this week's results are listed (the season accuracy above still
  // counts every graded game). Before any of this week's games are final,
  // show last week's results instead of an empty table.
  const shownWeek =
    activeWeek !== null && gradedRows.some((g) => g.week === activeWeek)
      ? activeWeek
      : gradedRows.length > 0
        ? Math.max(...gradedRows.map((g) => g.week))
        : null;
  const weekGradedRows = gradedRows.filter((g) => g.week === shownWeek);

  const aiAccuracyPct = aiGraded > 0 ? ((aiCorrect / aiGraded) * 100).toFixed(1) : null;
  const userAccuracyPct = userGraded > 0 ? ((userCorrect / userGraded) * 100).toFixed(1) : null;

  // Same "model favorite vs. actual winner" grading as the NFL AI card
  // above, run per other sport against sportGames instead of games.
  const otherAccuracy = await otherSportsAccuracy();

  // Group leaderboard — everyone's picks against final games this season,
  // not just the signed-in user's own. Joined here rather than scoped to
  // one user like myPicks above.
  const allGradedPicks = await db
    .select({
      username: users.username,
      team: userPicks.team,
      homeTeam: games.homeTeam,
      awayTeam: games.awayTeam,
      homeScore: games.homeScore,
      awayScore: games.awayScore,
    })
    .from(userPicks)
    .innerJoin(users, eq(users.id, userPicks.userId))
    .innerJoin(games, eq(games.id, userPicks.gameId))
    .where(and(eq(games.season, season), eq(games.isFinal, true)));

  const leaderboardTotals = new Map<string, { correct: number; total: number }>();
  for (const r of allGradedPicks) {
    if (r.homeScore === null || r.awayScore === null || r.homeScore === r.awayScore) continue;
    const winner = r.homeScore > r.awayScore ? r.homeTeam : r.awayTeam;
    const entry = leaderboardTotals.get(r.username) ?? { correct: 0, total: 0 };
    entry.total += 1;
    if (r.team === winner) entry.correct += 1;
    leaderboardTotals.set(r.username, entry);
  }
  const leaderboard = Array.from(leaderboardTotals.entries())
    .map(([username, { correct, total }]) => ({
      username,
      correct,
      total,
      pct: total > 0 ? (correct / total) * 100 : 0,
    }))
    .sort((a, b) => b.pct - a.pct || b.total - a.total);

  return (
    <div className="space-y-8">
      <SportTabs active="nfl" />
      <div className="space-y-3">
        <div>
          <h1 className="text-lg font-semibold">Model Tracker</h1>
          <p className="text-sm text-neutral-400 max-w-2xl">
            See how the model&rsquo;s picks turned out, and make your own picks to compare
            against it.
          </p>
        </div>
        <PageInfo>
          <p>
            Two scoreboards live here. <strong>AI</strong> is the model&rsquo;s own pick —
            whichever team it gave over 50% to win — graded automatically once the game is
            final. <strong>You</strong> is your own record from the picks you make using the
            team buttons below. Everyone has their own picks, so yours are always just yours.
            The <strong>Leaderboard</strong> further down shows everyone&rsquo;s record side by
            side, ranked by win percentage.
          </p>
          <p>
            Only this week&rsquo;s games are open for picks. Once this week is over, next week
            opens automatically — so you&rsquo;ll never find yourself picking a game that&rsquo;s
            weeks away. Each game&rsquo;s own pick locks{" "}
            {PICK_LOCK_MINUTES_BEFORE_KICKOFF} minutes before its real kickoff time — shown under
            the team buttons — so a pick can&rsquo;t be changed once the game&rsquo;s basically
            underway.
          </p>
          <p>
            The first table shows upcoming games: the model&rsquo;s favorite and its win chance,
            moneyline/spread/total odds, and <strong>Best Bet</strong> — the single market
            (moneyline, spread, or total) where the model&rsquo;s own number disagrees most with
            the sportsbook&rsquo;s. Hover it to see how all three markets compared.{" "}
            <strong>Confidence</strong> is the model&rsquo;s own win probability for that specific
            pick, 0-100 — 75+ is colored green (high), under 62 is gray (low). CLV — short for
            &ldquo;closing line value&rdquo; — now follows whichever market the Best Bet actually
            is: a positive CLV means the betting market has been moving toward the model&rsquo;s
            pick, which is usually a good sign; negative means the market moved the other way.
          </p>
          <p>
            The <strong>Graded</strong> table shows final games: the real score, what the model
            predicted, and whether each of you got it right. Hover over &ldquo;Factors&rdquo; on
            any row to see everything that went into that prediction. Weather shown as
            &ldquo;(forecast)&rdquo; is a pre-game forecast for an outdoor stadium — it&rsquo;s
            replaced with the real reading automatically once the game is actually played. The
            model also now accounts for short rest (e.g. Thursday off a Sunday game) and how far
            the away team had to travel — both small, capped nudges, visible in the Factors
            tooltip as &ldquo;Rest/Travel&rdquo;.
          </p>
        </PageInfo>
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="rounded-md border border-neutral-800 px-4 py-3 inline-block">
          <div className="text-xs text-neutral-500 mb-1">AI (model favorite)</div>
          <div className="text-2xl font-semibold">{aiAccuracyPct ? `${aiAccuracyPct}%` : "—"}</div>
          <div className="text-sm text-neutral-400">
            {aiGraded > 0 ? `${aiCorrect}-${aiGraded - aiCorrect} (${aiGraded} graded)` : "No graded games yet"}
          </div>
        </div>
        <div className="rounded-md border border-neutral-800 px-4 py-3 inline-block">
          <div className="text-xs text-neutral-500 mb-1">You</div>
          <div className="text-2xl font-semibold">
            {userAccuracyPct ? `${userAccuracyPct}%` : "—"}
          </div>
          <div className="text-sm text-neutral-400">
            {userGraded > 0
              ? `${userCorrect}-${userGraded - userCorrect} (${userGraded} graded)`
              : "Set a pick below to start your record"}
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-neutral-300 mb-2">All Sports — Model Accuracy</h2>
        <SectionNote>
          How often each sport&rsquo;s model favorite (whichever team had the higher pre-game win
          probability) has actually won, so far this season. These sports don&rsquo;t have the
          full NFL breakdown yet (no CLV, no Best Bet edge) — just the same favorite-vs-actual
          grading as the AI card above. Click through to make your own game-winner picks for that
          sport, see your graded record, and check that sport&rsquo;s own leaderboard — the same
          AI-vs-You tracking NFL gets above, kept separate per sport.
        </SectionNote>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {otherAccuracy.map((s) => (
            <Link prefetch={false}
              key={s.sportKey}
              href={`/sports/${s.sportKey}`}
              className="rounded-md border border-neutral-800 px-4 py-3 hover:bg-neutral-900/50 transition-colors"
            >
              <div className="text-xs text-neutral-500 mb-1">{s.sportLabel}</div>
              <div className="text-xl font-semibold">{s.pct !== null ? `${s.pct.toFixed(1)}%` : "—"}</div>
              <div className="text-xs text-neutral-400">
                {s.graded > 0 ? `${s.correct}-${s.graded - s.correct} (${s.graded} graded)` : "No graded games yet"}
              </div>
            </Link>
          ))}
        </div>
      </div>

      {leaderboard.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-neutral-300 mb-2">Leaderboard</h2>
          <SectionNote>
            Everyone&rsquo;s pick record this season, best first. This is the same record shown
            in your own &ldquo;You&rdquo; card above, just side by side with everyone else&rsquo;s.
          </SectionNote>
          <div className="overflow-x-auto rounded-md border border-neutral-800">
            <table className="w-full text-sm">
              <thead className="bg-neutral-900 text-neutral-400 text-left">
                <tr>
                  <Th>#</Th>
                  <Th>User</Th>
                  <Th>Record</Th>
                  <Th>Win %</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {leaderboard.map((row, i) => (
                  <tr
                    key={row.username}
                    className={row.username === user?.username ? "bg-neutral-900/60" : undefined}
                  >
                    <Td>{i + 1}</Td>
                    <Td className="font-medium">
                      {row.username}
                      {row.username === user?.username && (
                        <span className="ml-1.5 text-xs text-neutral-500">(you)</span>
                      )}
                    </Td>
                    <Td className="text-neutral-400">
                      {row.correct}-{row.total - row.correct} ({row.total} graded)
                    </Td>
                    <Td>{row.pct.toFixed(1)}%</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div>
        <h2 className="text-sm font-semibold text-neutral-300 mb-2">
          {activeWeek !== null ? `Week ${activeWeek} — Open for Picks` : "Upcoming"} (
          {upcomingGames.length})
        </h2>
        <SectionNote>
          Click a team under &ldquo;Your Pick&rdquo; to make your call. &ldquo;Best Bet&rdquo;
          only shows up when the model finds a real edge on at least one of moneyline, spread, or
          total — hover it to see all three. CLV turns green once the betting market starts
          agreeing with the model&rsquo;s moneyline pick.
        </SectionNote>
        {upcomingGames.length === 0 ? (
          <p className="text-sm text-neutral-500">No upcoming games synced yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-neutral-800">
            <table className="w-full text-sm">
              <thead className="bg-neutral-900 text-neutral-400 text-left">
                <tr>
                  <Th>Wk</Th>
                  <Th>Matchup</Th>
                  <Th>Factors</Th>
                  <Th>Moneyline</Th>
                  <Th>Spread</Th>
                  <Th>Total</Th>
                  <Th>Model Favorite</Th>
                  <Th>Best Bet</Th>
                  <Th>Confidence</Th>
                  <Th>CLV</Th>
                  <Th>Your Pick</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {upcomingGames.map((g) => (
                  <tr
                    key={g.id}
                    style={favoriteHighlightStyle(
                      favTeam,
                      g.homeTeam === favTeam?.code || g.awayTeam === favTeam?.code
                    )}
                  >
                    <Td>{g.week}</Td>
                    <Td>
                      {g.awayTeam} @ {g.homeTeam}
                    </Td>
                    <Td
                      className="text-neutral-400"
                      title={factorsTooltip(g)}
                    >
                      <FactorsCell game={g} />
                    </Td>
                    <Td className="text-neutral-400">
                      {g.moneylineHomeOdds !== null
                        ? `${g.awayTeam} ${formatPrice(g.moneylineAwayOdds)} / ${g.homeTeam} ${formatPrice(g.moneylineHomeOdds)}`
                        : "—"}
                    </Td>
                    <Td className="text-neutral-400">{formatSpread(g)}</Td>
                    <Td className="text-neutral-400">{formatTotal(g)}</Td>
                    <Td>
                      {g.homeWinPctPre !== null
                        ? `${g.homeWinPctPre > 0.5 ? g.homeTeam : g.awayTeam} (${(
                            (g.homeWinPctPre > 0.5 ? g.homeWinPctPre : 1 - g.homeWinPctPre) * 100
                          ).toFixed(1)}%)`
                        : "—"}
                    </Td>
                    <Td title={bestBetTooltip(g)}>
                      {g.bestMarket ? (
                        <span className="text-emerald-400">
                          {g.bestMarketLabel} ({((g.bestMarketEdgePct ?? 0) * 100).toFixed(1)}% edge)
                          {(() => {
                            const moves = moveCountByGameMarket.get(`${g.id}|${g.bestMarket}`) ?? 0;
                            return moves > 1 ? (
                              <span
                                className="ml-1 text-xs text-neutral-500"
                                title={`Line has moved ${moves} time(s) since it opened`}
                              >
                                📈×{moves}
                              </span>
                            ) : null;
                          })()}
                        </span>
                      ) : (
                        <span className="text-neutral-500">No edge</span>
                      )}
                    </Td>
                    <Td title="The model's own win probability for the Best Bet pick, 0-100. 75+ is high confidence, under 62 is low.">
                      <ConfidenceCell confidencePct={g.bestMarketConfidencePct} />
                    </Td>
                    <Td title="Positive = the market has moved toward the Best Bet pick since the opening line (closing line value). Negative = it's moved away.">
                      <ClvCell game={g} />
                    </Td>
                    <Td>
                      <PickToggle
                        gameId={g.id}
                        homeTeam={g.homeTeam}
                        awayTeam={g.awayTeam}
                        currentPick={myPickByGame.get(g.id) ?? null}
                        locked={isPickLocked(g.kickoffAt)}
                      />
                      {lockLabel(g.kickoffAt, isPickLocked(g.kickoffAt)) && (
                        <div className="text-[10px] text-neutral-500 mt-0.5">
                          {lockLabel(g.kickoffAt, isPickLocked(g.kickoffAt))}
                        </div>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h2 className="text-sm font-semibold text-neutral-300 mb-2">
          {shownWeek !== null ? `Week ${shownWeek} — Results` : "Results"}
        </h2>
        <SectionNote>
          This week&rsquo;s final games, graded against what the model said before kickoff. Your
          season record above counts every week.
          Hover &ldquo;Factors&rdquo; on any row to see what went into that prediction.
        </SectionNote>
        <div className="overflow-x-auto rounded-md border border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900 text-neutral-400 text-left">
              <tr>
                <Th>Wk</Th>
                <Th>Matchup</Th>
                <Th>Factors</Th>
                <Th>Score</Th>
                <Th>Pre-game Home Win %</Th>
                <Th>AI Result</Th>
                <Th>CLV</Th>
                <Th>Your Pick</Th>
                <Th>Your Result</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {weekGradedRows.map((g) => (
                <tr
                  key={g.id}
                  style={favoriteHighlightStyle(
                    favTeam,
                    g.homeTeam === favTeam?.code || g.awayTeam === favTeam?.code
                  )}
                >
                  <Td>{g.week}</Td>
                  <Td>
                    {g.awayTeam} @ {g.homeTeam}
                  </Td>
                  <Td
                    className="text-neutral-400"
                    title={factorsTooltip(g)}
                  >
                    <FactorsCell game={g} />
                  </Td>
                  <Td>
                    {g.awayScore}–{g.homeScore}
                  </Td>
                  <Td>
                    {g.homeWinPctPre !== null ? `${(g.homeWinPctPre * 100).toFixed(1)}%` : "—"}
                  </Td>
                  <Td>
                    <ResultBadge result={g.result} />
                  </Td>
                  <Td title="Positive = the market moved toward the Best Bet pick between the opening and closing line.">
                    <ClvCell game={g} />
                  </Td>
                  <Td className="text-neutral-400">{g.myPick ?? "—"}</Td>
                  <Td>
                    <ResultBadge result={g.userResult} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <NextStep
        href="/props"
        label="Player Props"
        reason="Browse this week's player prop picks and projections."
      />
    </div>
  );
}

function FactorsCell({
  game,
}: {
  game: {
    roof: string | null;
    surface: string | null;
    tempF: number | null;
    windMph: number | null;
    weatherIsForecast: boolean;
    precipPct: number | null;
    referee: string | null;
  };
}) {
  const parts: string[] = [];
  if (game.roof === "dome" || game.roof === "closed") {
    parts.push("Indoor");
  } else if (game.tempF !== null || game.windMph !== null) {
    parts.push(
      [
        game.tempF !== null ? `${game.tempF}°F` : null,
        game.windMph !== null ? `${game.windMph}mph` : null,
        game.precipPct !== null && game.precipPct >= 30 ? `${game.precipPct}% precip` : null,
      ]
        .filter(Boolean)
        .join("/") + (game.weatherIsForecast ? " (forecast)" : "")
    );
  }
  if (game.referee) parts.push(`Ref: ${game.referee}`);
  return <span className="text-xs">{parts.length > 0 ? parts.join(" · ") : "—"}</span>;
}

function ClvCell({
  game,
}: {
  game: Parameters<typeof bestBetClv>[0];
}) {
  const clv = bestBetClv(game);
  if (clv === null) return <span className="text-neutral-500">—</span>;
  const clvPctStr = `${clv >= 0 ? "+" : ""}${(clv * 100).toFixed(1)}%`;
  return (
    <span className={clv > 0 ? "text-emerald-400" : clv < 0 ? "text-red-400" : "text-neutral-400"}>
      {clvPctStr}
    </span>
  );
}

/** "Locks in 2h 14m" / "Locks in 38m" / "Picks locked" — shown under the pick toggle so the 5-minutes-before-kickoff cutoff isn't a silent surprise. Null kickoffAt (not synced yet) shows nothing, matching isPickLocked's "never locks" fallback. */
function lockLabel(kickoffAt: Date | null, locked: boolean): string | null {
  if (!kickoffAt) return null;
  if (locked) return "Picks locked";
  const msUntilLock = kickoffAt.getTime() - PICK_LOCK_MINUTES_BEFORE_KICKOFF * 60 * 1000 - Date.now();
  const totalMin = Math.max(0, Math.round(msUntilLock / 60000));
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  return `Locks in ${hours > 0 ? `${hours}h ` : ""}${mins}m`;
}

function ConfidenceCell({ confidencePct }: { confidencePct: number | null }) {
  if (confidencePct === null) return <span className="text-neutral-500">—</span>;
  const score = confidenceScore(confidencePct);
  const tier = confidenceTier(score);
  return (
    <span className={`shrink-0 px-1.5 py-0.5 rounded text-xs font-medium ${CONFIDENCE_TIER_CLASS[tier]}`}>
      {score}
    </span>
  );
}

function ResultBadge({ result }: { result: "CORRECT" | "WRONG" | "N/A" }) {
  return (
    <span
      className={
        result === "CORRECT"
          ? "text-emerald-400"
          : result === "WRONG"
            ? "text-red-400"
            : "text-neutral-500"
      }
    >
      {result}
    </span>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 font-medium whitespace-nowrap">{children}</th>;
}

function Td({
  children,
  className = "",
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <td className={`px-3 py-2 whitespace-nowrap ${className}`} title={title}>
      {children}
    </td>
  );
}
