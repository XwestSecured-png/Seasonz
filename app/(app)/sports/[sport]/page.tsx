import { notFound } from "next/navigation";
import { db } from "@/db";
import { sportEloRatings, sportGames, sportTeamMetrics, sportUserPicks, users } from "@/db/schema";
import { and, desc, eq, max, min, sql } from "drizzle-orm";
import { PageInfo } from "../../page-info";
import { SectionNote } from "../../section-note";
import { SyncButton } from "../../sync-button";
import { SportTabs } from "../../sport-tabs";
import { SportPickToggle } from "./sport-pick-toggle";
import { getCurrentUser } from "@/lib/current-user";
import { isPickLocked, PICK_LOCK_MINUTES_BEFORE_KICKOFF } from "@/lib/time";
import { SPORTS, type SportKey } from "@/lib/sports/types";
import { currentSeasonYear } from "@/lib/sports/espn";

export const dynamic = "force-dynamic";

function isSportKey(v: string): v is SportKey {
  return v in SPORTS;
}

function pct(p: number | null): string {
  if (p === null) return "—";
  return `${(p * 100).toFixed(1)}%`;
}

// Shape of sportTeamMetrics.factors as written by lib/sports/sync.ts's
// teamMetrics stage — plain scoring metrics derived straight from synced
// final scores (no separate, unverified ESPN stats endpoint involved).
interface TeamFactors {
  pointsFor?: number;
  pointsAgainst?: number;
  avgPointsFor?: number | null;
  avgPointsAgainst?: number | null;
  differential?: number;
  avgDifferential?: number | null;
  streak?: number; // positive = win streak, negative = losing streak
}

function diffClass(v: number | null): string {
  if (v === null || v === 0) return "text-neutral-400";
  return v > 0 ? "text-emerald-400" : "text-rose-400";
}

function formatStreak(streak: number | null): string {
  if (streak === null || streak === 0) return "—";
  return streak > 0 ? `W${streak}` : `L${Math.abs(streak)}`;
}

/** "Locks in 2h 14m" / "Locks in 38m" / "Picks locked" — same copy as the NFL Model Tracker's lock label. Null kickoffAt shows nothing. */
function lockLabel(kickoffAt: Date | null, locked: boolean): string | null {
  if (!kickoffAt) return null;
  if (locked) return "Picks locked";
  const msUntilLock = kickoffAt.getTime() - PICK_LOCK_MINUTES_BEFORE_KICKOFF * 60 * 1000 - Date.now();
  const totalMin = Math.max(0, Math.round(msUntilLock / 60000));
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  return `Locks in ${hours > 0 ? `${hours}h ` : ""}${mins}m`;
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

export default async function SportPage({ params }: { params: Promise<{ sport: string }> }) {
  const { sport: sportParam } = await params;
  if (!isSportKey(sportParam)) notFound();
  const sport = sportParam;
  const def = SPORTS[sport];
  const season = currentSeasonYear(sport);
  const user = await getCurrentUser();

  const [latestEloWeek] = await db
    .select({ week: max(sportEloRatings.week) })
    .from(sportEloRatings)
    .where(and(eq(sportEloRatings.sport, sport), eq(sportEloRatings.season, season)));

  const eloRows = latestEloWeek?.week
    ? await db
        .select()
        .from(sportEloRatings)
        .where(
          and(
            eq(sportEloRatings.sport, sport),
            eq(sportEloRatings.season, season),
            eq(sportEloRatings.week, latestEloWeek.week)
          )
        )
        .orderBy(desc(sportEloRatings.rating))
    : [];

  const metricsBy = new Map(
    (
      await db
        .select()
        .from(sportTeamMetrics)
        .where(and(eq(sportTeamMetrics.sport, sport), eq(sportTeamMetrics.season, season)))
    ).map((m) => [m.team, m])
  );

  // The CURRENT week = the soonest week that still has unplayed games.
  // Games that started more than 12 hours ago but never went final
  // (postponed/canceled) are ignored, or they'd pin the page to an old week.
  const [latestGameWeek] = await db
    .select({ week: min(sportGames.week) })
    .from(sportGames)
    .where(
      and(
        eq(sportGames.sport, sport),
        eq(sportGames.season, season),
        eq(sportGames.isFinal, false),
        sql`(${sportGames.kickoffAt} is null or ${sportGames.kickoffAt} > now() - interval '12 hours')`
      )
    );

  const upcoming = latestGameWeek?.week
    ? await db
        .select()
        .from(sportGames)
        .where(
          and(
            eq(sportGames.sport, sport),
            eq(sportGames.season, season),
            eq(sportGames.week, latestGameWeek.week)
          )
        )
    : [];

  // --- "Make your own pick vs the model", generalized from the NFL Model
  // Tracker (games/userPicks/users) onto this sport's own tables
  // (sportGames/sportUserPicks) — see db/schema.ts's sportUserPicks comment.
  const finalGames = await db
    .select()
    .from(sportGames)
    .where(and(eq(sportGames.sport, sport), eq(sportGames.season, season), eq(sportGames.isFinal, true)))
    .orderBy(desc(sportGames.week));

  const myPicks = user
    ? await db
        .select()
        .from(sportUserPicks)
        .where(and(eq(sportUserPicks.userId, user.id), eq(sportUserPicks.sport, sport)))
    : [];
  const myPickByGame = new Map(myPicks.map((p) => [p.gameId, p.team]));

  let aiCorrect = 0;
  let aiGraded = 0;
  let userCorrect = 0;
  let userGraded = 0;

  const gradedRows = finalGames.map((g) => {
    let result: "CORRECT" | "WRONG" | "N/A" = "N/A";
    // No tie branch: unlike NFL, these sports' box scores don't resolve in
    // equal final scores (OT/extra innings always settle it) — same note
    // as lib/sports/accuracy.ts's otherSportsAccuracy.
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

  // Only this week's results are listed (season totals above still count
  // every graded game). If nothing this week is final yet, show last week.
  const currentWeek = latestGameWeek?.week ?? null;
  const shownWeek =
    currentWeek !== null && gradedRows.some((g) => g.week === currentWeek)
      ? currentWeek
      : gradedRows.length > 0
        ? Math.max(...gradedRows.map((g) => g.week))
        : null;
  const weekGradedRows = gradedRows.filter((g) => g.week === shownWeek);

  const aiAccuracyPct = aiGraded > 0 ? ((aiCorrect / aiGraded) * 100).toFixed(1) : null;
  const userAccuracyPct = userGraded > 0 ? ((userCorrect / userGraded) * 100).toFixed(1) : null;

  // Leaderboard — everyone's picks against this sport's final games this
  // season, not just the signed-in user's own (same join shape as NFL's
  // Model Tracker, just scoped to sportUserPicks/sportGames for this sport).
  const allGradedPicks = await db
    .select({
      username: users.username,
      team: sportUserPicks.team,
      homeTeam: sportGames.homeTeam,
      awayTeam: sportGames.awayTeam,
      homeScore: sportGames.homeScore,
      awayScore: sportGames.awayScore,
    })
    .from(sportUserPicks)
    .innerJoin(users, eq(users.id, sportUserPicks.userId))
    .innerJoin(sportGames, eq(sportGames.id, sportUserPicks.gameId))
    .where(and(eq(sportUserPicks.sport, sport), eq(sportGames.season, season), eq(sportGames.isFinal, true)));

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
      <SportTabs active={sport} />
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-lg font-semibold">{def.label}</h1>
            <p className="text-sm text-neutral-400 max-w-2xl">
              Elo ratings and model win probabilities for {def.label}, {season} — plus your own
              picks against the model, graded, with a leaderboard against everyone else&rsquo;s.
            </p>
          </div>
          {user?.isLegacyAdmin && (
            <SyncButton season={season} sports={sport} nfl={false} label={`Sync ${def.label}`} />
          )}
        </div>
        <PageInfo>
          <p>
            {def.label} runs on the same Elo rating engine as the NFL model (538-style: win and
            gain points, more against a stronger opponent; lose and drop points, more against a
            weaker one), fed by ESPN&rsquo;s own schedule and score data instead of nflverse.
          </p>
          <p>
            <strong>AI</strong> is the model&rsquo;s own pick — whichever team it gave over 50% to
            win — graded automatically once a game is final. <strong>You</strong> is your own
            record from the picks you make using the team buttons under &ldquo;Your Pick&rdquo; in
            Upcoming Games. Each person has their own picks for {def.label}, separate from your
            picks in any other sport. The <strong>Leaderboard</strong> shows everyone&rsquo;s{" "}
            {def.label} record side by side. Picks lock {PICK_LOCK_MINUTES_BEFORE_KICKOFF} minutes
            before a game&rsquo;s real start time, same as NFL.
          </p>
          <p>
            <strong>PF/G, PA/G, Diff, and Streak</strong> are real scoring metrics — points
            scored and allowed per game, average point differential, and the current
            win/loss streak — computed directly from this season&rsquo;s synced final scores,
            same as a league standings page would show.
          </p>
          <p>
            This is the foundation layer only, shared across every new sport added this way —
            NFL-specific extras like weather, referee tendencies, the six team-factor
            adjustments, and injury-impact modeling are sport-specific by nature and are being
            built out one sport at a time on top of this, not generated generically. Treat the
            win probabilities here as Elo-only for now, a step less refined than the NFL
            page&rsquo;s numbers until that catches up.
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

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-neutral-300">Elo Ratings</h2>
        <SectionNote>Highest to lowest, through the latest synced results.</SectionNote>
        {eloRows.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No ratings yet — tap &ldquo;Sync {def.label}&rdquo; above to pull the current season.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-neutral-800">
            <table className="w-full text-sm">
              <thead className="bg-neutral-900 text-neutral-400 text-left">
                <tr>
                  <Th>#</Th>
                  <Th>Team</Th>
                  <Th>Rating</Th>
                  <Th>Record</Th>
                  <Th>PF/G</Th>
                  <Th>PA/G</Th>
                  <Th>Diff</Th>
                  <Th>Streak</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {eloRows.map((r, i) => {
                  const m = metricsBy.get(r.team);
                  const f = (m?.factors ?? null) as TeamFactors | null;
                  return (
                    <tr key={r.team}>
                      <Td>{i + 1}</Td>
                      <Td className="font-medium">{r.team}</Td>
                      <Td>{r.rating.toFixed(1)}</Td>
                      <Td>{m ? `${m.wins}-${m.losses}` : "—"}</Td>
                      <Td>{f?.avgPointsFor != null ? f.avgPointsFor.toFixed(1) : "—"}</Td>
                      <Td>{f?.avgPointsAgainst != null ? f.avgPointsAgainst.toFixed(1) : "—"}</Td>
                      <Td className={diffClass(f?.avgDifferential ?? null)}>
                        {f?.avgDifferential != null
                          ? `${f.avgDifferential > 0 ? "+" : ""}${f.avgDifferential.toFixed(1)}`
                          : "—"}
                      </Td>
                      <Td className={diffClass(f?.streak ?? null)}>{formatStreak(f?.streak ?? null)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {leaderboard.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-neutral-300 mb-2">Leaderboard</h2>
          <SectionNote>
            Everyone&rsquo;s {def.label} pick record this season, best first — the same record
            shown in your own &ldquo;You&rdquo; card above, just side by side with everyone
            else&rsquo;s.
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

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-neutral-300">
          {latestGameWeek?.week ? `Week ${latestGameWeek.week} — Open for Picks` : "Upcoming Games"}
        </h2>
        <SectionNote>
          Click a team under &ldquo;Your Pick&rdquo; to make your call for {def.label}. Each
          game&rsquo;s pick locks {PICK_LOCK_MINUTES_BEFORE_KICKOFF} minutes before its real start
          time.
        </SectionNote>
        {upcoming.length === 0 ? (
          <p className="text-sm text-neutral-500">No upcoming games synced yet for this week.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {upcoming.map((g) => (
              <div key={g.id} className="rounded-md border border-neutral-800 p-3 text-sm space-y-1.5">
                <div className="font-medium">
                  {g.awayTeam} @ {g.homeTeam}
                </div>
                <div className="text-neutral-500 text-xs">
                  {g.kickoffAt ? new Date(g.kickoffAt).toLocaleString() : "Time TBD"}
                </div>
                <div className="text-neutral-400 text-xs">
                  Model: {g.homeTeam} {pct(g.homeWinPctPre)} to win
                </div>
                <div className="pt-1">
                  <div className="text-[10px] uppercase tracking-wide text-neutral-500 mb-1">
                    Your Pick
                  </div>
                  <SportPickToggle
                    sport={sport}
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
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-neutral-300">
          {shownWeek !== null ? `Week ${shownWeek} — Results` : "Results"}
        </h2>
        <SectionNote>
          This week&rsquo;s final {def.label} games, graded against what the model said before each
          one&rsquo;s start time. Your season record above counts every week.
        </SectionNote>
        {weekGradedRows.length === 0 ? (
          <p className="text-sm text-neutral-500">No graded games yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-neutral-800">
            <table className="w-full text-sm">
              <thead className="bg-neutral-900 text-neutral-400 text-left">
                <tr>
                  <Th>Wk</Th>
                  <Th>Matchup</Th>
                  <Th>Score</Th>
                  <Th>Pre-game Home Win %</Th>
                  <Th>AI Result</Th>
                  <Th>Your Pick</Th>
                  <Th>Your Result</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {weekGradedRows.map((g) => (
                  <tr key={g.id}>
                    <Td>{g.week}</Td>
                    <Td>
                      {g.awayTeam} @ {g.homeTeam}
                    </Td>
                    <Td>
                      {g.awayScore}–{g.homeScore}
                    </Td>
                    <Td>{g.homeWinPctPre !== null ? `${(g.homeWinPctPre * 100).toFixed(1)}%` : "—"}</Td>
                    <Td>
                      <ResultBadge result={g.result} />
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
        )}
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 font-medium whitespace-nowrap">{children}</th>;
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 whitespace-nowrap ${className}`}>{children}</td>;
}
