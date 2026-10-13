import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { getMyPicks } from "@/lib/my-picks";
import { PageInfo } from "../page-info";
import { MyPicksView } from "./my-picks-view";

export const dynamic = "force-dynamic";

export default async function MyPicksPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const picks = await getMyPicks(user.id);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">My Picks</h1>
        <p className="text-sm text-neutral-400 max-w-2xl">Every pick you&rsquo;ve made, every sport, in one place.</p>
      </div>
      <PageInfo>
        <p>
          Game picks from the NFL Model Tracker and each sport&rsquo;s page, plus your player-prop picks. <strong>Upcoming</strong>{" "}
          shows what&rsquo;s still to play; <strong>Results</strong> shows how each one finished and whether you and the model agreed.
          Tap a pick to go to its game. Preseason picks are shown but don&rsquo;t count toward your record.
        </p>
      </PageInfo>
      <MyPicksView picks={picks} />
    </div>
  );
}
