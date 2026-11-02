import Link from "next/link";
import { db } from "@/db";
import { trades } from "@/db/schema";
import { and, desc, gte, inArray } from "drizzle-orm";
import { PageInfo } from "../page-info";
import { TRADE_FADE_GAMES, NEW_TEAM_SHARE, type TradeSport } from "@/lib/trades";

export const dynamic = "force-dynamic";

const SPORT_TABS: { key: TradeSport | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "nfl", label: "NFL" },
  { key: "nba", label: "NBA" },
  { key: "nhl", label: "NHL" },
  { key: "mlb", label: "MLB" },
  { key: "wnba", label: "WNBA" },
];

const pts = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)} pts`);
const day = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });

type Row = typeof trades.$inferSelect;

/** Start of the window shown (the model's trade window). */
function windowStart(): Date {
  return new Date(Date.now() - 120 * 86_400_000);
}

export default async function TradesPage({ searchParams }: { searchParams: Promise<{ sport?: string }> }) {
  const { sport: sportParam } = await searchParams;
  const sport = (SPORT_TABS.find((t) => t.key === sportParam)?.key ?? "all") as TradeSport | "all";
  const since = windowStart();
  const rows = await db
    .select()
    .from(trades)
    .where(and(gte(trades.tradeDate, since), sport === "all" ? undefined : inArray(trades.sport, [sport])))
    .orderBy(desc(trades.tradeDate))
    .limit(400);

  // One card per trade: group both teams' sides of the same deal (same sport, day, teams).
  const deals = new Map<string, Row[]>();
  for (const r of rows) {
    const teams = [r.team, r.otherTeam ?? "?"].sort().join("|");
    const k = `${r.sport}|${r.tradeDate.toISOString().slice(0, 10)}|${teams}`;
    deals.set(k, [...(deals.get(k) ?? []), r]);
  }

  // Each team's net trade effect today (what the model is adding right now).
  const teamNow = new Map<string, number>();
  for (const r of rows) {
    if (r.impactNowPct == null) continue;
    const k = `${r.sport}|${r.team}`;
    teamNow.set(k, (teamNow.get(k) ?? 0) + r.impactNowPct);
  }
  const movers = [...teamNow.entries()].filter(([, v]) => Math.abs(v) >= 0.002).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div>
          <h1 className="text-lg font-semibold">Trades</h1>
          <p className="text-sm text-neutral-400">Every trade in the last four months, and what it&rsquo;s worth to each team&rsquo;s chance of winning.</p>
        </div>
        <PageInfo>
          <p>
            Trades come from each league&rsquo;s transaction wire and are checked every sync. The model counts a trade like an injury in
            reverse: the team that sent a player away loses his production above a replacement-level fill-in, and the team that got him gains
            it ({Math.round(NEW_TEAM_SHARE * 100)}% at first, while he learns a new system).
          </p>
          <p className="mt-2">
            <strong>Impact</strong> is the change in that team&rsquo;s chance of winning an even game. <strong>Now</strong> is what the model
            still adds today: the effect fades as the team plays games with its new roster ({TRADE_FADE_GAMES.nfl} NFL games,{" "}
            {TRADE_FADE_GAMES.nba} NBA/NHL, {TRADE_FADE_GAMES.mlb} MLB), because by then its rating and recent form already show the change.
            NFL players are valued like the injury report (starting QBs, and running backs and receivers by their share of the offense);
            other positions show &ldquo;no estimate&rdquo;. Draft picks aren&rsquo;t counted.
          </p>
        </PageInfo>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {SPORT_TABS.map((t) => (
          <Link
            key={t.key}
            prefetch={false}
            href={t.key === "all" ? "/trades" : `/trades?sport=${t.key}`}
            aria-current={t.key === sport ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 text-sm ${t.key === sport ? "bg-neutral-200 text-neutral-900" : "bg-neutral-900 text-neutral-300 hover:bg-neutral-800"}`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {movers.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-neutral-200">Biggest trade effects in the model today</h2>
          <div className="flex flex-wrap gap-2">
            {movers.map(([k, v]) => {
              const [sp, team] = k.split("|");
              return (
                <span key={k} className={`rounded-md border px-2.5 py-1 text-xs ${v > 0 ? "border-emerald-700/60 text-emerald-300" : "border-rose-700/60 text-rose-300"}`}>
                  {sp.toUpperCase()} {team} {pts(v)}
                </span>
              );
            })}
          </div>
        </section>
      )}

      {deals.size === 0 ? (
        <p className="text-sm text-neutral-500">No trades in the last four months{sport !== "all" ? " for this league" : ""} yet. They appear after the next sync.</p>
      ) : (
        <div className="space-y-3">
          {[...deals.values()].map((sides) => {
            const first = sides[0];
            const teams = [...new Set(sides.flatMap((s) => [s.team, s.otherTeam]).filter(Boolean))] as string[];
            const byTeam = teams.map((t) => ({ team: t, rows: sides.filter((s) => s.team === t) }));
            return (
              <div key={`${first.id}`} className="rounded-md border border-neutral-800 p-3 space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="text-sm font-semibold text-neutral-100">
                    {first.sport.toUpperCase()}: {teams.join(" ⇄ ")}
                  </div>
                  <div className="text-[11px] text-neutral-500">{day(first.tradeDate)}</div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {byTeam.map(({ team, rows: tr }) => {
                    const net = tr.reduce((s, r) => s + (r.impactPct ?? 0), 0);
                    const now = tr.reduce((s, r) => s + (r.impactNowPct ?? 0), 0);
                    return (
                      <div key={team} className="rounded bg-neutral-900/60 px-2.5 py-2 text-xs space-y-1">
                        <div className="flex items-baseline justify-between">
                          <span className="font-medium text-neutral-200">{team}</span>
                          <span className={net > 0 ? "text-emerald-400" : net < 0 ? "text-rose-400" : "text-neutral-500"}>
                            {tr.some((r) => r.impactPct != null) ? `${pts(net)} · now ${pts(now)}` : "no estimate"}
                          </span>
                        </div>
                        {tr.length === 0 ? (
                          <div className="text-neutral-500">Only the other team&rsquo;s side is listed.</div>
                        ) : (
                          tr.map((r) => (
                            <div key={r.id} className="flex items-baseline justify-between gap-2 text-neutral-400">
                              <span>
                                <span className={r.direction === "in" ? "text-emerald-400" : "text-rose-400"}>{r.direction === "in" ? "Gets" : "Sends"}</span>{" "}
                                {r.position ? `${r.position} ` : ""}
                                <span className="text-neutral-200">{r.player}</span>
                                {r.valueLabel ? <span className="text-neutral-500"> ({r.valueLabel})</span> : null}
                              </span>
                              <span className="whitespace-nowrap">{r.impactPct != null ? pts(r.impactPct) : "no estimate"}</span>
                            </div>
                          ))
                        )}
                        {tr[0]?.gamesSince != null && <div className="text-[10px] text-neutral-600">{tr[0].gamesSince} game(s) played since</div>}
                      </div>
                    );
                  })}
                </div>
                <details className="text-[11px] text-neutral-500">
                  <summary className="cursor-pointer">Transaction text</summary>
                  <ul className="mt-1 space-y-0.5">
                    {[...new Set(sides.map((s) => `${s.team}: ${s.description}`))].map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                </details>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
