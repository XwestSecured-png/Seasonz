// Pick scorecard (1.31.0): are the picks actually beating the market?
//
// For every graded prop pick (one per player, stat, game and side; the
// latest logged version, so alternate lines of the same prop count once):
// the chance we gave it, whether it hit, the market's own no-vig chance for
// that side, and the profit of a flat 1-unit bet at the listed price. A
// model that only matches the market hits what the market says and loses
// the vig; beating the market means hitting more often than the market's
// chance and a positive return at the prices taken.
import { db } from "@/db";
import { sql } from "drizzle-orm";

export interface ScoreRow {
  sport: string;
  n: number;
  hits: number;
  /** Average chance we gave the picks. */
  pred: number;
  /** Average market no-vig chance for the same sides. */
  market: number;
  /** Units won per 1-unit bet at the listed prices. */
  roi: number;
}

export interface Scorecard {
  days: number;
  bySport: (ScoreRow & { verdict: "beating" | "matching" | "behind" | "too few"; se: number })[];
  daily: (ScoreRow & { date: string })[];
}

const VERDICT_MIN_N = 100;

export async function getScorecard(days = 14): Promise<Scorecard> {
  const rows = await db.execute<{ sport: string; date: string; n: number; hits: number; pred: number; market: number; roi: number }>(sql`
    with g as (
      select distinct on (sport, player, stat_type, coalesce(game_date::text, week::text), side) *
      from prop_pick_log
      where result in ('hit', 'miss') and market is not null
        -- prices no one could get (empty +9900 contracts, stale lines) aren't counted (lib/props-model.ts isUnusablePrice)
        and abs(price_american) < 5000
        and (case when price_american < 0 then -price_american / (-price_american + 100.0) else 100.0 / (price_american + 100) end) >= market - 0.15
        and logged_at > now() - make_interval(days => ${days})
      order by sport, player, stat_type, coalesce(game_date::text, week::text), side, logged_at desc
    )
    select sport, coalesce(game_date::text, 'week ' || week) as date, count(*)::int as n,
           count(*) filter (where result = 'hit')::int as hits,
           avg(final)::float as pred, avg(market)::float as market,
           avg(case when result = 'hit' then (case when price_american > 0 then price_american / 100.0 else 100.0 / -price_american end) else -1 end)::float as roi
    from g group by sport, 2 order by sport, 2`);
  const daily = [...rows].map((r) => ({ sport: r.sport, date: r.date, n: Number(r.n), hits: Number(r.hits), pred: Number(r.pred), market: Number(r.market), roi: Number(r.roi) }));
  const by = new Map<string, ScoreRow>();
  for (const d of daily) {
    const a = by.get(d.sport) ?? { sport: d.sport, n: 0, hits: 0, pred: 0, market: 0, roi: 0 };
    a.pred = (a.pred * a.n + d.pred * d.n) / (a.n + d.n);
    a.market = (a.market * a.n + d.market * d.n) / (a.n + d.n);
    a.roi = (a.roi * a.n + d.roi * d.n) / (a.n + d.n);
    a.n += d.n;
    a.hits += d.hits;
    by.set(d.sport, a);
  }
  const bySport = [...by.values()].map((r) => {
    const hit = r.hits / r.n;
    // Standard error of the hit rate; picks on one night move together, so this understates it a little.
    const se = Math.sqrt((r.market * (1 - r.market)) / r.n);
    const gap = hit - r.market;
    const verdict: Scorecard["bySport"][number]["verdict"] = r.n < VERDICT_MIN_N ? "too few" : gap > 2 * se ? "beating" : gap < -2 * se ? "behind" : "matching";
    return { ...r, se, verdict };
  });
  return { days, bySport: bySport.sort((a, b) => b.n - a.n), daily };
}
