// Long Shots (1.43.0): every NFL player with an anytime-touchdown projection
// this week, with our model's chance next to the sportsbooks' chance.
//
// Model chance comes from prop_projections (stat "Anytime TD"): the
// projected TD count m and, when the model fitted one, a negative-binomial
// size r. P(at least one TD) = 1 - (r/(r+m))^r, or 1 - e^-m without r.
// Market chance is the median implied chance across the latest price from
// each book in prop_lines_raw (Yes/Over side). "Team rank" orders each
// team by the market's chance, so 1 and 2 are the players the books expect
// to score and 3+ are the surprise options.
import { db } from "@/db";
import { sql } from "drizzle-orm";

export interface LongShot {
  player: string;
  team: string;
  /** e.g. "JAX@BAL" */
  game: string | null;
  kickoffAt: string | null;
  /** 1 = the market's favourite on his team. */
  teamRank: number;
  /** 0-100 */
  model: number;
  /** 0-100, null when no book prices him */
  market: number | null;
  /** model - market, in percentage points */
  edge: number | null;
  bestPrice: number | null;
  books: number;
  games: number;
}

export interface LongShotBoard {
  season: number;
  week: number;
  oddsAt: string | null;
  rows: LongShot[];
}

function nflSeason(now = new Date()) {
  return now.getMonth() >= 1 ? now.getFullYear() : now.getFullYear() - 1;
}

export async function getLongShots(): Promise<LongShotBoard | null> {
  const season = nflSeason();
  // The week we have projections for: the latest one whose games aren't all final.
  const wk = await db.execute<{ week: number }>(sql`
    select p.week from prop_projections p
    where p.sport = 'nfl' and p.season = ${season} and p.stat_type = 'Anytime TD'
      and exists (select 1 from games g where g.season = p.season and g.week = p.week and not g.is_final)
    group by p.week order by p.week limit 1`);
  let week = wk[0]?.week;
  if (week == null) {
    const last = await db.execute<{ week: number }>(sql`
      select max(week) as week from prop_projections where sport = 'nfl' and season = ${season} and stat_type = 'Anytime TD'`);
    week = last[0]?.week ?? undefined;
  }
  if (week == null) return null;

  const rows = await db.execute<{
    player: string;
    team: string;
    model: number;
    games: number;
    market: number | null;
    best: number | null;
    books: number | null;
    odds_at: string | null;
    game: string | null;
    kickoff_at: string | null;
  }>(sql`
    with p as (
      select player, team,
        (data->'proj'->>'mean')::float as m,
        nullif(data->'proj'->>'nbSize', '')::float as r,
        coalesce((data->'proj'->>'games')::int, 0) as games
      from prop_projections
      where sport = 'nfl' and season = ${season} and week = ${week} and stat_type = 'Anytime TD' and team is not null
    ),
    lr as (
      select distinct on (player, book) player, book, price_american, fetched_at
      from prop_lines_raw
      where season = ${season} and week = ${week} and stat_type = 'Anytime TD' and side in ('Over', 'Yes')
      order by player, book, fetched_at desc
    ),
    o as (
      select player, count(*)::int as books, max(price_american)::int as best, max(fetched_at) as odds_at,
        100 * percentile_cont(0.5) within group (order by
          case when price_american > 0 then 100.0 / (price_american + 100) else -price_american / (100.0 - price_american) end) as market
      from lr group by player
    ),
    g as (
      select home_team as team, away_team || '@' || home_team as game, kickoff_at from games where season = ${season} and week = ${week}
      union all
      select away_team, away_team || '@' || home_team, kickoff_at from games where season = ${season} and week = ${week}
    )
    select p.player, p.team, p.games,
      100 * case when p.r > 0 then 1 - power(p.r / (p.r + p.m), p.r) else 1 - exp(-p.m) end as model,
      o.market, o.best, o.books, o.odds_at::text, g.game, g.kickoff_at::text
    from p left join o using (player) left join g on g.team = p.team`);

  // Team rank by market chance (players the books don't price go last).
  type Raw = (typeof rows)[number];
  const byTeam = new Map<string, Raw[]>();
  for (const r of rows) byTeam.set(r.team, [...(byTeam.get(r.team) ?? []), r]);
  const rank = new Map<string, number>();
  for (const list of byTeam.values()) {
    [...list]
      .sort((a, b) => (b.market ?? -1) - (a.market ?? -1) || Number(b.model) - Number(a.model))
      .forEach((r, i) => rank.set(`${r.team}|${r.player}`, i + 1));
  }

  let oddsAt: string | null = null;
  const out: LongShot[] = rows.map((r) => {
    if (r.odds_at && (!oddsAt || r.odds_at > oddsAt)) oddsAt = r.odds_at;
    const model = Math.round(Number(r.model) * 10) / 10;
    const market = r.market == null ? null : Math.round(Number(r.market) * 10) / 10;
    return {
      player: r.player,
      team: r.team,
      game: r.game,
      // Stored as UTC without a zone (lib/time.ts): mark it as UTC for the browser.
      kickoffAt: r.kickoff_at ? `${r.kickoff_at.replace(" ", "T")}Z` : null,
      teamRank: rank.get(`${r.team}|${r.player}`) ?? 99,
      model,
      market,
      edge: market == null ? null : Math.round((model - market) * 10) / 10,
      bestPrice: r.best,
      books: r.books ?? 0,
      games: Number(r.games),
    };
  });
  out.sort((a, b) => (b.edge ?? -999) - (a.edge ?? -999));
  return { season, week, oddsAt: oddsAt ? `${String(oddsAt).replace(" ", "T")}Z` : null, rows: out };
}
