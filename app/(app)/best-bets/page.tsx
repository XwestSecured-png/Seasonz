import Link from "next/link";
import { getCurrentUser } from "@/lib/current-user";
import { getBestBetsFeed } from "@/lib/best-bets-feed";
import { formatEt } from "@/lib/week-window";
import { PageInfo } from "../page-info";
import { LogBetButton } from "../log-bet-button";
import { TrustBadge } from "../trust-badge";

export const dynamic = "force-dynamic";

const fmt = (p: number) => (p > 0 ? `+${p}` : `${p}`);
const pct = (v: number) => `${Math.round(v * 100)}%`;

export default async function BestBetsPage({ searchParams }: { searchParams: Promise<{ window?: string; kind?: string }> }) {
  const { window: win, kind } = await searchParams;
  const hours = win === "3d" ? 72 : 36;
  const user = await getCurrentUser();
  const all = await getBestBetsFeed(hours);
  const items = all.filter((x) => !kind || kind === "all" || x.kind.toLowerCase() === kind);

  const chip = (active: boolean) =>
    `rounded-full px-3 py-1 text-xs font-medium transition-colors ${active ? "bg-sky-600 text-white" : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"}`;
  const q = (w: string, k: string) => `/best-bets?window=${w}&kind=${k}`;
  const w = win === "3d" ? "3d" : "today";
  const k = kind ?? "all";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Best Bets</h1>
        <p className="text-sm text-neutral-400 max-w-2xl">The strongest edges across every sport, at the best price available right now.</p>
      </div>
      <PageInfo>
        <p>
          A bet shows up when our chance for that side beats what the <strong>best available price</strong> implies, by 2+ points for
          games and 3+ points for props. Edge = our chance minus the price&rsquo;s chance.
        </p>
        <p>
          Game numbers lean mostly on the betting market (it&rsquo;s the most accurate single predictor), so a game edge usually means
          one book is out of line with the rest. Prop chances come from the prop model, which was checked on past seasons. Edges are
          estimates, not guarantees: track how they do in the Bet Tracker&rsquo;s closing-line value.
        </p>
      </PageInfo>

      <div className="flex flex-wrap gap-1.5">
        <Link href={q("today", k)} className={chip(w === "today")}>
          Next 36 hours
        </Link>
        <Link href={q("3d", k)} className={chip(w === "3d")}>
          Next 3 days
        </Link>
        <span className="mx-1 border-l border-neutral-800" />
        {(["all", "game", "prop"] as const).map((x) => (
          <Link key={x} href={q(w, x)} className={chip(k === x)}>
            {x === "all" ? "All" : x === "game" ? "Games" : "Props"}
          </Link>
        ))}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-neutral-500">
          No edges big enough right now. Lines and props refresh several times a day, so check back closer to game time.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.slice(0, 60).map((x, i) => (
            <li key={x.key} className="rounded-md border border-neutral-800 px-3 py-2.5 space-y-1.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-neutral-100">
                    <span className="text-neutral-500 mr-1.5">{i + 1}.</span>
                    {x.label}
                  </div>
                  <div className="text-xs text-neutral-500">
                    <span className="text-neutral-400">{x.sportLabel}</span> · {x.kind} · {x.matchup} · {x.kickoffAt ? formatEt(new Date(x.kickoffAt)) : "TBD"}
                    {x.preseason && <span className="ml-1 text-amber-300">· Preseason</span>}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-semibold text-emerald-400">+{(x.edge * 100).toFixed(1)} pts</div>
                  <div className="text-[11px] text-neutral-500">edge</div>
                  {x.trust && (
                    <div className="mt-0.5">
                      <TrustBadge trust={x.trust} compact />
                    </div>
                  )}
                </div>
              </div>
              <div className="text-xs text-neutral-400 flex flex-wrap gap-x-3 gap-y-0.5">
                <span>
                  Our chance <span className="text-sky-300 font-medium">{pct(x.modelPct)}</span>
                </span>
                <span>
                  Best price <span className="text-emerald-300 font-medium">{fmt(x.bestPrice)}</span> {x.bestBook} (implies{" "}
                  {pct(x.bestPrice < 0 ? -x.bestPrice / (-x.bestPrice + 100) : 100 / (x.bestPrice + 100))})
                </span>
                {x.otherPrices.length > 0 && (
                  <span className="text-neutral-500">{x.otherPrices.slice(0, 3).map((p) => `${p.book} ${fmt(p.price)}`).join(" · ")}</span>
                )}
              </div>
              {user && <LogBetButton compact options={[x.bet]} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
