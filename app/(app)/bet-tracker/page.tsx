import { db } from "@/db";
import { games, userBets } from "@/db/schema";
import { and, asc, desc, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/current-user";
import { getFavoriteTeam } from "@/lib/favorite-team";
import { getSportsbookPrefs } from "@/lib/sportsbook-pref";
import { allowedPlatformCategories } from "@/lib/entitlements";
import { favoriteHighlightStyle } from "@/lib/team-colors";
import { PageInfo } from "../page-info";
import { SectionNote } from "../section-note";
import { BetForm } from "./bet-form";
import { BankrollInput } from "./bankroll-input";
import { DeleteBetButton } from "./delete-bet-button";
import { WhatItMeans } from "../what-it-means";

export const dynamic = "force-dynamic";

function currentNflSeason(): number {
  const now = new Date();
  return now.getMonth() >= 1 ? now.getFullYear() : now.getFullYear() - 1;
}

function formatPrice(price: number): string {
  return price > 0 ? `+${price}` : `${price}`;
}

function describeBet(bet: {
  market: string;
  selection: string;
  line: number | null;
  priceAmerican: number;
}): string {
  if (bet.market === "ML") return `${bet.selection} ML (${formatPrice(bet.priceAmerican)})`;
  if (bet.market === "SPREAD") {
    const lineStr = bet.line !== null ? `${bet.line > 0 ? "+" : ""}${bet.line}` : "";
    return `${bet.selection} ${lineStr} (${formatPrice(bet.priceAmerican)})`;
  }
  const side = bet.selection === "OVER" ? "Over" : "Under";
  return `${side} ${bet.line ?? "—"} (${formatPrice(bet.priceAmerican)})`;
}

export default async function BetTrackerPage() {
  const season = currentNflSeason();
  const user = await getCurrentUser();
  const favTeam = await getFavoriteTeam();
  const sportsbookPrefs = await getSportsbookPrefs();

  if (!user) {
    return (
      <div className="space-y-3">
        <h1 className="text-lg font-semibold">Bet Tracker</h1>
        <p className="text-sm text-neutral-400">Sign in to log and track your own bets.</p>
      </div>
    );
  }

  const allUpcomingGames = await db
    .select()
    .from(games)
    .where(and(eq(games.season, season), eq(games.isFinal, false)))
    .orderBy(asc(games.week));
  const activeWeek =
    allUpcomingGames.length > 0 ? Math.min(...allUpcomingGames.map((g) => g.week)) : null;
  const upcomingGames = allUpcomingGames.filter((g) => g.week === activeWeek);

  const myBetsRaw = await db
    .select({
      bet: userBets,
      game: games,
    })
    .from(userBets)
    .innerJoin(games, eq(games.id, userBets.gameId))
    .where(eq(userBets.userId, user.id))
    .orderBy(desc(userBets.placedAt));

  const pending = myBetsRaw.filter((r) => r.bet.result === "PENDING");
  const graded = myBetsRaw.filter((r) => r.bet.result !== "PENDING");

  const totalStaked = graded.reduce((sum, r) => sum + r.bet.stakeUsd, 0);
  const totalReturned = graded.reduce((sum, r) => sum + (r.bet.payoutUsd ?? 0), 0);
  const wins = graded.filter((r) => r.bet.result === "WON").length;
  const losses = graded.filter((r) => r.bet.result === "LOST").length;
  const pushes = graded.filter((r) => r.bet.result === "PUSH").length;
  const roiPct = totalStaked > 0 ? (totalReturned / totalStaked) * 100 : null;
  const winRatePct = wins + losses > 0 ? (wins / (wins + losses)) * 100 : null;

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div>
          <h1 className="text-lg font-semibold">Bet Tracker</h1>
          <p className="text-sm text-neutral-400 max-w-2xl">
            Log the bets you actually place, and this grades them automatically once the game
            goes final — a real win/loss record and ROI, separate from the model&rsquo;s own
            picks.
          </p>
        </div>
        <PageInfo>
          <p>
            Pick a game and market, choose your side, and the line/price pull from the latest
            sync — edit them if you bet at a different number or book. When your pick matches the
            model&rsquo;s own Best Bet for that game, you&rsquo;ll see a suggested stake sized
            with a conservative (half-)Kelly formula from the model&rsquo;s edge, capped at 5% of
            your bankroll — set a bankroll below to see it in dollars, or just use the percentage.
          </p>
          <p>
            Bets stay <strong>Pending</strong> until the game is final, then the next sync grades
            them automatically — Won, Lost, or Push — and your net profit/loss rolls into the
            totals above the list.
          </p>
          <p>
            <strong>Push</strong> copies this pick as plain text and opens every platform you&rsquo;ve
            saved (set your list in the header/menu — any mix of sportsbooks, prediction markets, or
            Underdog) so you can paste and place it wherever you actually bet — none of them let an
            outside app fill in their bet slip directly. Use <strong>Log bet</strong> above it to
            actually track the result here.
          </p>
        </PageInfo>
      </div>

      <BankrollInput current={user.bankrollUsd} />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard
          label="Record"
          value={wins + losses + pushes > 0 ? `${wins}-${losses}-${pushes}` : "—"}
        />
        <StatCard label="Win %" value={winRatePct !== null ? `${winRatePct.toFixed(1)}%` : "—"} />
        <StatCard
          label="Net"
          value={graded.length > 0 ? `${totalReturned >= 0 ? "+" : ""}$${totalReturned.toFixed(0)}` : "—"}
          accent={totalReturned > 0 ? "emerald" : totalReturned < 0 ? "red" : undefined}
        />
        <StatCard label="ROI" value={roiPct !== null ? `${roiPct >= 0 ? "+" : ""}${roiPct.toFixed(1)}%` : "—"} />
      </div>

      <div>
        <h2 className="text-sm font-semibold text-neutral-300 mb-2">Log a bet</h2>
        <BetForm
          games={upcomingGames.map((g) => ({
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
            bestMarket: g.bestMarket,
            bestMarketLabel: g.bestMarketLabel,
            bestMarketConfidencePct: g.bestMarketConfidencePct,
          }))}
          bankrollUsd={user.bankrollUsd}
          sportsbookPrefs={sportsbookPrefs}
          allowedCategories={allowedPlatformCategories(user.tier)}
        />
      </div>

      {pending.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-neutral-300 mb-2">Pending ({pending.length})</h2>
          <div className="rounded-md border border-neutral-800 divide-y divide-neutral-800">
            {pending.map((r) => (
              <div
                key={r.bet.id}
                className="px-4 py-2.5 space-y-2 text-sm"
                style={favoriteHighlightStyle(
                  favTeam,
                  r.game.homeTeam === favTeam?.code || r.game.awayTeam === favTeam?.code
                )}
              >
                <div className="flex items-center justify-between gap-4">
                  <span className="text-neutral-400 w-32 shrink-0">
                    {r.game.awayTeam} @ {r.game.homeTeam}
                  </span>
                  <span className="flex-1">{describeBet(r.bet)}</span>
                  <span className="text-neutral-500 shrink-0">${r.bet.stakeUsd.toFixed(0)}</span>
                  <DeleteBetButton id={r.bet.id} />
                </div>
                <WhatItMeans
                  compact
                  bet={{
                    market: r.bet.market === "SPREAD" ? "SPREAD" : r.bet.market === "TOTAL" ? "TOTAL" : "ML",
                    sport: "nfl",
                    pick: r.bet.market === "TOTAL" ? null : r.bet.selection,
                    opponent:
                      r.bet.market === "TOTAL"
                        ? null
                        : r.bet.selection === r.game.homeTeam
                          ? r.game.awayTeam
                          : r.game.homeTeam,
                    side: r.bet.market === "TOTAL" ? r.bet.selection : null,
                    line: r.bet.line,
                    priceAmerican: r.bet.priceAmerican,
                    stakeUsd: r.bet.stakeUsd,
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="text-sm font-semibold text-neutral-300 mb-2">Graded ({graded.length})</h2>
        <SectionNote>Settled bets, newest first. Net is this bet&rsquo;s own profit or loss.</SectionNote>
        {graded.length === 0 ? (
          <p className="text-sm text-neutral-500">No graded bets yet.</p>
        ) : (
          <div className="rounded-md border border-neutral-800 divide-y divide-neutral-800">
            {graded.map((r) => (
              <div
                key={r.bet.id}
                className="px-4 py-2.5 flex items-center justify-between gap-4 text-sm"
                style={favoriteHighlightStyle(
                  favTeam,
                  r.game.homeTeam === favTeam?.code || r.game.awayTeam === favTeam?.code
                )}
              >
                <span className="text-neutral-400 w-32 shrink-0">
                  {r.game.awayTeam} @ {r.game.homeTeam}
                </span>
                <span className="flex-1">{describeBet(r.bet)}</span>
                <span className="text-neutral-500 shrink-0">${r.bet.stakeUsd.toFixed(0)}</span>
                <ResultBadge result={r.bet.result} payoutUsd={r.bet.payoutUsd} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "emerald" | "red";
}) {
  return (
    <div className="rounded-md border border-neutral-800 px-4 py-3">
      <div
        className={`text-2xl font-semibold ${
          accent === "emerald" ? "text-emerald-400" : accent === "red" ? "text-red-400" : ""
        }`}
      >
        {value}
      </div>
      <div className="text-sm text-neutral-400">{label}</div>
    </div>
  );
}

function ResultBadge({ result, payoutUsd }: { result: string; payoutUsd: number | null }) {
  const color =
    result === "WON" ? "text-emerald-400" : result === "LOST" ? "text-red-400" : "text-neutral-400";
  const payoutStr =
    payoutUsd !== null ? ` (${payoutUsd >= 0 ? "+" : ""}$${payoutUsd.toFixed(0)})` : "";
  return (
    <span className={`shrink-0 font-medium ${color}`}>
      {result}
      {payoutStr}
    </span>
  );
}
