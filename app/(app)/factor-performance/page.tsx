import { db } from "@/db";
import { factorSnapshots } from "@/db/schema";
import { sql } from "drizzle-orm";
import { PageInfo } from "../page-info";
import { SectionNote } from "../section-note";
import { NextStep } from "../next-step";
import { UpgradeGate } from "../upgrade-gate";
import { getCurrentUser } from "@/lib/current-user";
import { canViewAdvancedAnalytics } from "@/lib/entitlements";

export const dynamic = "force-dynamic";

const FACTOR_LABELS: Record<string, string> = {
  WEATHER: "Weather",
  REST_TRAVEL: "Rest/Travel",
  REFEREE: "Referee",
  SCHEME_OFF: "Offensive scheme",
  SCHEME_DEF: "Defensive scheme",
  TURNOVER: "Turnovers",
  PENALTY: "Penalties",
  TRENCHES: "Trenches (O/D line)",
  AGGRESSION: "Aggressiveness (2pt rate)",
  FPI: "ESPN FPI",
  QBR: "ESPN Total QBR",
  INJURY: "Injury report",
};

// Below this many graded predictions, a hit rate is still mostly noise —
// same "don't trust a small sample" philosophy as MIN_GAMES_FOR_FACTORS
// elsewhere in the model (lib/team-factors.ts).
const MIN_SAMPLE_FOR_READ = 20;

interface FactorRow {
  factor: string;
  total: number;
  resolved: number;
  correct: number;
}

export default async function FactorPerformancePage() {
  const user = await getCurrentUser();
  if (!canViewAdvancedAnalytics(user?.tier ?? "free")) {
    return <UpgradeGate feature="Factor Performance" />;
  }

  const rows = await db
    .select({
      factor: factorSnapshots.factor,
      total: sql<number>`count(*)`,
      resolved: sql<number>`count(*) filter (where ${factorSnapshots.resolved})`,
      correct: sql<number>`count(*) filter (where ${factorSnapshots.correct})`,
    })
    .from(factorSnapshots)
    .groupBy(factorSnapshots.factor);

  const typedRows = rows as unknown as FactorRow[];
  const sorted = [...typedRows].sort((a, b) => {
    const rateA = a.resolved > 0 ? a.correct / a.resolved : -1;
    const rateB = b.resolved > 0 ? b.correct / b.resolved : -1;
    return rateB - rateA;
  });

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div>
          <h1 className="text-lg font-semibold">Factor Performance</h1>
          <p className="text-sm text-neutral-400 max-w-2xl">
            The model&rsquo;s calibration tracker — every time one of the factors below actually
            moved a game&rsquo;s pre-game win% (nonzero adjustment, written once at kickoff and
            never rewritten), it&rsquo;s logged as a prediction of which side that factor
            favored. Once the game goes final, it&rsquo;s graded: did the favored side really
            win? A factor sitting near 50% isn&rsquo;t adding real signal, whatever its cap is
            currently set to — that&rsquo;s the honest point of this page.
          </p>
        </div>
        <PageInfo>
          <p>
            The model adjusts its picks using 11 different factors — things like weather, the
            referee, injuries, and team strength ratings from ESPN. Each row below is one
            factor. <strong>Predictions</strong> counts how many times that factor actually
            changed a game&rsquo;s numbers at all. <strong>Graded</strong> counts how many of
            those games are now final, so we can check if the factor was right.{" "}
            <strong>Hit Rate</strong> is simple: when this factor picked a side, how often did
            that side actually win?
          </p>
          <p>
            A hit rate clearly above 50% (green) means the factor is actually helping. A hit
            rate at or below 50% (red) means it isn&rsquo;t — and it may need to count for less
            in the model. Gray rows don&rsquo;t have enough games yet (under 20) to know either
            way.
          </p>
        </PageInfo>
      </div>

      <SectionNote>
        Best factors are listed first. Green is doing well, red isn&rsquo;t helping, and gray
        just needs more games before we can tell.
      </SectionNote>
      {sorted.length === 0 ? (
        <p className="text-sm text-neutral-500">
          No factor snapshots yet — run a sync to start recording predictions.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-neutral-800">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900 text-neutral-400 text-left">
              <tr>
                <Th>Factor</Th>
                <Th>Predictions</Th>
                <Th>Graded</Th>
                <Th>Correct</Th>
                <Th>Hit Rate</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {sorted.map((r) => {
                const hitRate = r.resolved > 0 ? (r.correct / r.resolved) * 100 : null;
                const lowSample = r.resolved < MIN_SAMPLE_FOR_READ;
                return (
                  <tr key={r.factor}>
                    <Td>{FACTOR_LABELS[r.factor] ?? r.factor}</Td>
                    <Td className="text-neutral-400">{r.total}</Td>
                    <Td className="text-neutral-400">{r.resolved}</Td>
                    <Td className="text-neutral-400">{r.correct}</Td>
                    <Td>
                      {hitRate === null ? (
                        <span className="text-neutral-500">—</span>
                      ) : (
                        <span
                          className={
                            lowSample
                              ? "text-neutral-500"
                              : hitRate >= 55
                                ? "text-emerald-400"
                                : hitRate <= 50
                                  ? "text-red-400"
                                  : "text-neutral-200"
                          }
                        >
                          {hitRate.toFixed(1)}%{lowSample ? " (small sample)" : ""}
                        </span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <NextStep
        href="/injury-impact"
        label="Injury Impact"
        reason="See which injuries are already factored into this week's picks."
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
