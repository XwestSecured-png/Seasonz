import { getLongShots } from "@/lib/long-shots";
import { PageInfo } from "../page-info";
import { LongShotsTable } from "./long-shots-table";

export const dynamic = "force-dynamic";

export default async function LongShotsPage() {
  const board = await getLongShots();
  const oddsAt = board?.oddsAt
    ? new Date(board.oddsAt).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" }) + " ET"
    : null;

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div>
          <h1 className="text-lg font-semibold">Long Shots{board ? ` · Week ${board.week}` : ""}</h1>
          <p className="text-sm text-neutral-400">
            Every NFL player&rsquo;s chance to score a touchdown, next to the sportsbooks&rsquo; chance. The surprise scorers are the ones
            below each team&rsquo;s top two.
          </p>
        </div>
        <PageInfo>
          <p>
            <strong>Model</strong> is our anytime-touchdown chance from each player&rsquo;s game history. <strong>Market</strong> is the
            middle of what the sportsbooks imply (their latest price at each book). <strong>Edge</strong> is the gap: a positive edge means
            we rate the player higher than the books do.
          </p>
          <p className="mt-2">
            <strong>Team rank</strong> orders each team by the market&rsquo;s chance, so 1 and 2 are the players the books expect to score
            (marked <em>Starter</em>) and 3 and lower are the surprise options. <em>Thin</em> means fewer than 8 games of history, where our
            chance is likely too high. Long shots usually miss: check injuries and depth charts and keep stakes small.
          </p>
        </PageInfo>
      </div>

      {!board || board.rows.length === 0 ? (
        <p className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-4 text-sm text-neutral-400">
          No touchdown projections for this week yet. They appear after the next sync.
        </p>
      ) : (
        <LongShotsTable rows={board.rows} oddsAt={oddsAt} />
      )}
    </div>
  );
}
