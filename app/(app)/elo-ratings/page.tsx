import { db } from "@/db";
import { teamEloRatings } from "@/db/schema";
import { desc, eq, max } from "drizzle-orm";
import { PageInfo } from "../page-info";
import { SectionNote } from "../section-note";
import { NextStep } from "../next-step";
import { getFavoriteTeam } from "@/lib/favorite-team";
import { favoriteHighlightStyle } from "@/lib/team-colors";
import { UpgradeGate } from "../upgrade-gate";
import { getCurrentUser } from "@/lib/current-user";
import { canViewAdvancedAnalytics } from "@/lib/entitlements";

export const dynamic = "force-dynamic";

function currentNflSeason(): number {
  const now = new Date();
  return now.getMonth() >= 1 ? now.getFullYear() : now.getFullYear() - 1;
}

export default async function EloRatingsPage() {
  const user = await getCurrentUser();
  if (!canViewAdvancedAnalytics(user?.tier ?? "free")) {
    return <UpgradeGate feature="Elo Ratings" />;
  }

  const season = currentNflSeason();
  const favTeam = await getFavoriteTeam();

  const [latest] = await db
    .select({ week: max(teamEloRatings.week) })
    .from(teamEloRatings)
    .where(eq(teamEloRatings.season, season));

  const rows = latest?.week
    ? await db
        .select()
        .from(teamEloRatings)
        .where(eq(teamEloRatings.season, season))
        .orderBy(desc(teamEloRatings.rating))
    : [];

  // Keep only each team's row for the latest week (ratings are inserted
  // fresh each sync, so older weeks may still be present historically).
  const seen = new Set<string>();
  const current = rows.filter((r) => {
    if (r.week !== latest?.week) return false;
    if (seen.has(r.team)) return false;
    seen.add(r.team);
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div>
          <h1 className="text-lg font-semibold">Elo Ratings</h1>
          <p className="text-sm text-neutral-400">
            Every team&rsquo;s current strength rating, based on this season&rsquo;s results
            through week {latest?.week ?? "—"}.
          </p>
        </div>
        <PageInfo>
          <p>
            Elo is a simple rating system, first used for chess. Every team starts at the same
            baseline. Win, and you gain points — more if you beat a stronger team. Lose, and
            you drop points — more if you lose to a weaker team. It&rsquo;s the foundation of
            the whole model: every win probability starts from the gap between two teams&rsquo;
            Elo ratings, before weather, injuries, or anything else nudges it.
          </p>
          <p>
            This table ranks every team from highest to lowest rating. A higher number means
            the model currently sees that team as stronger.
          </p>
        </PageInfo>
      </div>

      <SectionNote>
        Highest to lowest. This is where every win percentage in the app starts, before any
        other factor adjusts it.
      </SectionNote>
      {current.length === 0 ? (
        <p className="text-sm text-neutral-500">No ratings yet — sync from the Dashboard.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900 text-neutral-400 text-left">
              <tr>
                <Th>#</Th>
                <Th>Team</Th>
                <Th>Rating</Th>
                <Th>Games Played</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {current.map((r, i) => (
                <tr key={r.team} style={favoriteHighlightStyle(favTeam, r.team === favTeam?.code)}>
                  <Td>{i + 1}</Td>
                  <Td className="font-medium">{r.team}</Td>
                  <Td>{r.rating.toFixed(1)}</Td>
                  <Td>{r.gamesPlayed}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NextStep
        href="/feedback"
        label="Feedback"
        reason="Tell us what's confusing, broken, or missing so the app can get better."
      />
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 font-medium whitespace-nowrap">{children}</th>;
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 whitespace-nowrap ${className}`}>{children}</td>;
}
