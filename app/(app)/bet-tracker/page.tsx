import { db } from "@/db";
import { games, sportGames, userBets } from "@/db/schema";
import { and, asc, desc, eq } from "drizzle-orm";
import { SPORTS, type SportKey } from "@/lib/sports/types";
import { SettleButtons } from "./settle-buttons";
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
  description?: string | null;
}): string {
  if (bet.market === "PROP" || bet.market === "PARLAY") return `${bet.description ?? bet.market} (${formatPrice(bet.priceAmerican)})`;
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

  // Every sport: NFL bets join games, other sports join sport_games,
  // parlays have no single game.
  const myBetsRows = await db
    .select({ bet: userBets, nfl: games, other: sportGames })
    .from(userBets)
    .leftJoin(games, eq(games.id, userBets.gameId))
    .leftJoin(sportGames, eq(sportGames.id, userBets.sportGameId))
    .where(eq(userBets.userId, user.id))
    .orderBy(desc(userBets.placedAt));
  const myBetsRaw = myBetsRows.map((r) => {
    const g = r.nfl ?? r.other;
    return {
      bet: r.bet,
      game: { homeTeam: g?.homeTeam ?? "", awayTeam: g?.awayTeam ?? "", isFinal: g?.isFinal ?? false },
      matchup: g ? `${g.awayTeam} @ ${g.homeTeam}` : "Parlay",
      sportLabel:
        r.bet.sport === "nfl" ? "NFL" : r.bet.sport === "multi" ? "Multi" : (SPORTS[r.bet.sport as SportKey]?.label ?? r.bet.sport.toUpperCase()),
    };
  });

  const pending = myBetsRaw.filter((r) => r.bet.result === "PENDING");
  const graded = myBetsRaw.filter((r) => r.bet.result !== "PENDING");

  const totalStaked = graded.reduce((sum, r) => sum + r.bet.stakeUsd, 0);
  const totalReturned = graded.reduce((sum, r) => sum + (r.bet.payoutUsd ?? 0), 0);
  const wins = graded.filter((r) => r.bet.result === "WON").length;
  const losses = graded.filter((r) => r.bet.result === "LOST").length;
  const pushes = graded.filter((r) => r.bet.result === "PUSH").length;
  const roiPct = totalStaked > 0 ? (totalReturned / totalStaked) * 100 : null;
  const winRatePct = wins + losses > 0 ? (wins / (wins + losses)) * 100 : null;
  // Closing-line value: the long-run sign of real skill (beating the close
  // predicts profit better than a short win/loss streak).
  const withClv = graded.filter((r) => r.bet.clvPct !== null);
  const avgClv = withClv.length ? (withClv.reduce((s, r) => s + (r.bet.clvPct ?? 0), 0) / withClv.length) * 100 : null;
  const beatClose = withClv.filter((r) => (r.bet.clvPct ?? 0) > 0).length;
  // Per-sport breakdown.
  const bySport = new Map<string, { n: number; w: number; l: number; staked: number; net: number }>();
  for (const r of graded) {
    const e = bySport.get(r.sportLabel) ?? { n: 0, w: 0, l: 0, staked: 0, net: 0 };
    e.n++;
    if (r.bet.result === "WON") e.w++;
    if (r.bet.result === "LOST") e.l++;
    e.staked += r.bet.stakeUsd;
    e.net += r.bet.payoutUsd ?? 0;
    bySport.set(r.sportLabel, e);
  }

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
      <div className="grid grid-cols-2 gap-4">
        <StatCard
          label="Avg closing-line value"
          value={avgClv !== null ? `${avgClv >= 0 ? "+" : ""}${avgClv.toFixed(1)} pts` : "—"}
          accent={avgClv !== null ? (avgClv > 0 ? "emerald" : avgClv < 0 ? "red" : undefined) : undefined}
        />
        <StatCard label="Beat the closing line" value={withClv.length ? `${beatClose} of ${withClv.length}` : "—"} />
      </div>
      <p className="text-xs text-neutral-500 -mt-4">
        Closing-line value compares the chance your price implied with the market&rsquo;s final no-vig chance when the game started.
        Positive means you got a better number than the close, which over many bets is the best single sign you&rsquo;re winning for real.
      </p>
      {bySport.size > 1 && (
        <div className="overflow-x-auto rounded-md border border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900 text-neutral-400 text-left text-xs">
              <tr>
                <th className="px-3 py-1.5 font-medium">Sport</th>
                <th className="px-3 py-1.5 font-medium">Bets</th>
                <th className="px-3 py-1.5 font-medium">Record</th>
                <th className="px-3 py-1.5 font-medium">Net</th>
                <th className="px-3 py-1.5 font-medium">ROI</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {[...bySport.entries()].map(([label, e]) => (
                <tr key={label}>
                  <td className="px-3 py-1.5">{label}</td>
                  <td className="px-3 py-1.5 text-neutral-400">{e.n}</td>
                  <td className="px-3 py-1.5 text-neutral-300">
                    {e.w}-{e.l}
                  </td>
                  <td className={`px-3 py-1.5 ${e.net > 0 ? "text-emerald-400" : e.net < 0 ? "text-red-400" : "text-neutral-300"}`}>
                    {e.net >= 0 ? "+" : "-"}${Math.abs(e.net).toFixed(0)}
                  </td>
                  <td className="px-3 py-1.5 text-neutral-300">{e.staked ? `${((e.net / e.staked) * 100).toFixed(1)}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div>
        <h2 className="text-sm font-semibold text-neutral-300 mb-1">Log an NFL game bet</h2>
        <p className="text-xs text-neutral-500 mb-2">
          For other sports, props and parlays, tap <strong>💵 Log bet</strong> on any game, prop, best bet or saved parlay.
        </p>
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
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <span className="text-neutral-400 w-32 shrink-0">
                    <span className="text-neutral-500">{r.sportLabel}</span> {r.matchup}
                  </span>
                  <span className="flex-1">{describeBet(r.bet)}</span>
                  <span className="text-neutral-500 shrink-0">${r.bet.stakeUsd.toFixed(0)}</span>
                  {(r.bet.market === "PARLAY" || (r.bet.market === "PROP" && r.game.isFinal)) && <SettleButtons id={r.bet.id} />}
                  <DeleteBetButton id={r.bet.id} />
                </div>
                {(r.bet.market === "ML" || r.bet.market === "SPREAD" || r.bet.market === "TOTAL") && r.bet.sport === "nfl" && (
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
                )}
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
                  <span className="text-neutral-500">{r.sportLabel}</span> {r.matchup}
                </span>
                <span className="flex-1">
                  {describeBet(r.bet)}
                  {r.bet.clvPct !== null && (
                    <span className={`ml-2 text-xs ${r.bet.clvPct > 0 ? "text-emerald-400" : "text-amber-400"}`}>
                      CLV {r.bet.clvPct > 0 ? "+" : ""}
                      {(r.bet.clvPct * 100).toFixed(1)}
                    </span>
                  )}
                </span>
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
