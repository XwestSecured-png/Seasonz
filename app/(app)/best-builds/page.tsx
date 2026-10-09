import { getModelBuilds } from "@/lib/auto-builds";
import { getSportsbookPrefs } from "@/lib/sportsbook-pref";
import { getCurrentUser } from "@/lib/current-user";
import { allowedPlatformCategories } from "@/lib/entitlements";
import { PageInfo } from "../page-info";
import { BuildsView } from "./builds-view";

export const dynamic = "force-dynamic";

export default async function BestBuildsPage() {
  const [today, week, sportsbookPrefs, user] = await Promise.all([
    getModelBuilds("today"),
    getModelBuilds("week"),
    getSportsbookPrefs(),
    getCurrentUser(),
  ]);
  const allowedCategories = allowedPlatformCategories(user?.tier ?? "free");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Model Builds</h1>
        <p className="text-sm text-neutral-400">
          The model&rsquo;s best parlays and player-prop parlays for today and this week, 2 to 8 legs, with the reason
          behind every pick.
        </p>
      </div>
      <PageInfo>
        <p>
          These are built automatically from the latest sync. For game parlays, the model takes its most confident
          winner from each game (only picks it gives at least a 60% chance) across every sport, and stacks them from
          strongest to weakest. For player props, it takes the props it rates most likely to hit, one per team.
        </p>
        <p>
          Every leg is from a different game (or team, for props), so one result doesn&rsquo;t drag down another. The
          combined chance is each leg&rsquo;s chance multiplied together, which assumes the legs are independent. Treat
          it as an estimate.
        </p>
        <p>
          Legs come first from picks the model gives 55&ndash;90% (60&ndash;90% for game picks). On a light slate, bigger
          parlays are filled out with the model&rsquo;s next-best sides (still better than a coin flip), so every size
          from 2 to 8 can be built when there are enough games. When no sportsbook price is synced yet, the payout uses the model&rsquo;s fair price and is labelled{" "}
          <em>fair</em>. Check your book&rsquo;s real price before betting.
        </p>
        <p>Bigger parlays pay more but hit far less often. Every leg has to win.</p>
      </PageInfo>
      <BuildsView today={today} week={week} sportsbookPrefs={sportsbookPrefs} allowedCategories={allowedCategories} />
    </div>
  );
}
