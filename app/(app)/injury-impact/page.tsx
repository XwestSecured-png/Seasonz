import { db } from "@/db";
import { injuryReports } from "@/db/schema";
import { eq } from "drizzle-orm";
import { PageInfo } from "../page-info";
import { SectionNote } from "../section-note";
import { NextStep } from "../next-step";
import { UpgradeGate } from "../upgrade-gate";
import { getCurrentUser } from "@/lib/current-user";
import { canViewAdvancedAnalytics } from "@/lib/entitlements";
import { recentReturns } from "@/lib/injury-returns";
import { SPORTS, type SportKey } from "@/lib/sports/types";

export const dynamic = "force-dynamic";

function currentNflSeason(): number {
  const now = new Date();
  return now.getMonth() >= 1 ? now.getFullYear() : now.getFullYear() - 1;
}

const STATUS_SECTIONS: { key: "OUT" | "DOUBTFUL" | "QUESTIONABLE"; title: string; note: string }[] = [
  {
    key: "OUT",
    title: "OUT — will not play",
    note: "This is already factored into this week's win percentages. Nothing more to watch for here.",
  },
  {
    key: "DOUBTFUL",
    title: "DOUBTFUL — unlikely to play",
    note: "Mostly factored in already — worth one more check right before kickoff.",
  },
  {
    key: "QUESTIONABLE",
    title: "GTD — game-time decision (Questionable)",
    note: "A true toss-up. The real answer often comes right before kickoff, so check back then.",
  },
];

export default async function InjuryImpactPage() {
  const user = await getCurrentUser();
  if (!canViewAdvancedAnalytics(user?.tier ?? "free")) {
    return <UpgradeGate feature="Injury Impact" />;
  }

  const season = currentNflSeason();
  const rows = await db
    .select()
    .from(injuryReports)
    .where(eq(injuryReports.season, season));
  const returns = await recentReturns(7 * 24).catch(() => []);
  const sportLabel = (s: string) => (s === "nfl" ? "NFL" : (SPORTS[s as SportKey]?.label ?? s));

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div>
          <h1 className="text-lg font-semibold">Injury Impact</h1>
          <p className="text-sm text-neutral-400 max-w-2xl">
            Shows this week&rsquo;s injured players, sorted by how likely they are to play. Only
            quarterbacks, running backs, receivers, and tight ends are covered — other
            positions aren&rsquo;t estimated yet. &ldquo;(est.)&rdquo; means the official call
            isn&rsquo;t out yet, so we&rsquo;re using practice reports instead.
          </p>
        </div>
        <PageInfo>
          <p>
            Every injured player is sorted into one of three groups: <strong>OUT</strong> (will
            not play), <strong>DOUBTFUL</strong> (probably won&rsquo;t play), or{" "}
            <strong>GTD</strong> (could go either way). &ldquo;Win % Impact&rdquo; shows how much
            that player&rsquo;s team is hurt by them being out — a bigger number means a bigger
            loss for their team.
          </p>
          <p>
            <strong>Method</strong> tells you how sure we are about that number. Missing
            quarterbacks get the most reliable estimate, based on real past games. Running
            backs, receivers, and tight ends get an estimate based on how big a role they play
            on offense. Other positions (like the offensive line) aren&rsquo;t estimated — there
            isn&rsquo;t enough reliable data yet, so they&rsquo;re left off this page instead of
            guessed at. This same number also feeds into the &ldquo;Injuries&rdquo; factor you&rsquo;ll
            see on Model Tracker and Factor Performance.
          </p>
        </PageInfo>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-neutral-300 mb-2">Back from injury (all sports, last 7 days)</h2>
        <SectionNote>
          Key players who were listed Out, missed games, and are now off the Out list. Our game chances
          stop counting them as missing. NFL props also trim the returning player&rsquo;s first game back
          and his same-position teammates, who lose the extra role they had while he was out.
        </SectionNote>
        {returns.length === 0 ? (
          <p className="text-sm text-neutral-500">No key players back from injury in the last 7 days.</p>
        ) : (
          <ul className="divide-y divide-neutral-800 rounded-md border border-neutral-800">
            {returns.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-3 py-2 text-sm">
                <span className="rounded bg-emerald-900/60 px-1.5 py-0.5 text-xs text-emerald-300">{sportLabel(r.sport)}</span>
                <span className="font-medium">{r.player}</span>
                <span className="text-neutral-400">
                  {r.team}
                  {r.position ? ` · ${r.position}` : ""}
                </span>
                <span className="w-full text-xs text-neutral-400 sm:w-auto">
                  {r.detail}
                  {r.missed > 0 ? ` · missed ${r.missed} game${r.missed === 1 ? "" : "s"}` : ""} · back{" "}
                  {new Date(r.detectedAt).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {STATUS_SECTIONS.map((section) => {
        const sectionRows = rows.filter((r) => r.status === section.key);
        return (
          <div key={section.key}>
            <h2 className="text-sm font-semibold text-neutral-300 mb-2">{section.title}</h2>
            <SectionNote>{section.note}</SectionNote>
            {sectionRows.length === 0 ? (
              <p className="text-sm text-neutral-500">
                No {section.key.toLowerCase()} players with enough real data to estimate right
                now.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-neutral-800">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-900 text-neutral-400 text-left">
                    <tr>
                      <Th>Team</Th>
                      <Th>Player</Th>
                      <Th>Pos</Th>
                      <Th>Next Opp.</Th>
                      <Th>Game They&rsquo;ll Miss</Th>
                      <Th>Anticipated Return</Th>
                      <Th>Method</Th>
                      <Th>Win % Impact</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-800">
                    {sectionRows.map((r) => (
                      <tr key={r.id}>
                        <Td>{r.team}</Td>
                        <Td>
                          {r.player}
                          {r.isEstimate && (
                            <span className="ml-1 text-xs text-amber-400">(est.)</span>
                          )}
                        </Td>
                        <Td>{r.position}</Td>
                        <Td>{r.nextOpponent ?? "—"}</Td>
                        <Td>{r.gameMissedLabel ?? "—"}</Td>
                        <Td>{r.anticipatedReturn ?? "—"}</Td>
                        <Td wrap className="text-neutral-400 min-w-[16rem] max-w-sm">
                          {r.method}
                        </Td>
                        <Td>
                          {r.winPctImpact !== null
                            ? `${(r.winPctImpact * 100).toFixed(1)}%`
                            : "—"}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}

      <NextStep
        href="/model-tracker"
        label="Model Tracker"
        reason="Make your own picks for this week's games before kickoff."
      />
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 font-medium whitespace-nowrap">{children}</th>;
}

function Td({
  children,
  className = "",
  wrap = false,
}: {
  children: React.ReactNode;
  className?: string;
  wrap?: boolean;
}) {
  return (
    <td
      className={`px-3 py-2 align-top ${wrap ? "whitespace-normal" : "whitespace-nowrap"} ${className}`}
    >
      {children}
    </td>
  );
}
