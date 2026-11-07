// Google Sheets copy of the app (1.43.0).
//
// buildSheetTabs() gathers one table per app section (games and picks,
// best bets, props, long shots, injuries, trades, ratings, records).
// pushToGoogleSheet() writes those tabs into a Google Sheet, replacing each
// tab's contents, using a Google service account (no extra packages: the
// sign-in token is signed with Node's crypto).
//
// Auto-update: when GOOGLE_SERVICE_ACCOUNT_JSON and SEASONZ_SHEET_ID are set
// for the GitHub sync job, scripts/cron.ts calls pushToGoogleSheet() after
// each full sync / refresh. The Sheet must be shared (Editor) with the
// service account's email.
import { createSign } from "node:crypto";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { getLongShots } from "@/lib/long-shots";

export type Cell = string | number | boolean | null;
export interface SheetTab {
  name: string;
  note: string;
  headers: string[];
  rows: Cell[][];
}

const ET = "America/New_York";
const etTime = (col: string) => sql.raw(`to_char((${col} at time zone 'UTC') at time zone '${ET}', 'Dy Mon DD HH12:MI AM')`);
const pct = (v: unknown) => (v == null ? null : Math.round(Number(v) * 1000) / 10);
const num = (v: unknown) => (v == null ? null : Number(v));
/** The props trust badge (an object with a tier) as a single word. */
const trustTier = (v: unknown): string | null =>
  v == null ? null : typeof v === "object" ? String((v as { tier?: string }).tier ?? "") || null : String(v);
/** A 0-1 fraction shown as a percentage with one decimal. */
const fr = (v: unknown) => (v == null ? null : Math.round(Number(v) * 1000) / 10);

function nflSeason(now = new Date()) {
  return now.getMonth() >= 1 ? now.getFullYear() : now.getFullYear() - 1;
}

async function rowsOf<T extends Record<string, unknown>>(q: ReturnType<typeof sql>): Promise<T[]> {
  return (await db.execute<T>(q)) as unknown as T[];
}

export async function buildSheetTabs(): Promise<SheetTab[]> {
  const season = nflSeason();
  const [{ week } = { week: null }] = await rowsOf<{ week: number | null }>(sql`
    select coalesce(min(week) filter (where not is_final), max(week)) as week from games where season = ${season}`);
  const tabs: SheetTab[] = [];

  // NFL games and picks for the current week.
  const nfl = await rowsOf<Record<string, unknown>>(sql`
    select away_team, home_team, ${etTime("kickoff_at")} as kickoff, home_win_pct_pre, locked_pct, ai_pick_team, ai_edge_pct,
      moneyline_away_odds, moneyline_home_odds, spread_home_line, spread_ai_pick_team, spread_ai_edge_pct,
      total_line, total_ai_pick, total_ai_edge_pct, best_market_label, best_market_edge_pct, best_market_confidence_pct,
      temp_f, wind_mph, is_final, away_score, home_score
    from games where season = ${season} and week = ${week} order by kickoff_at, home_team`);
  tabs.push({
    name: `NFL Week ${week ?? "?"}`,
    note: "Every game this week with the model's win chance, picks and best bet.",
    headers: ["Away", "Home", "Kickoff (ET)", "Home win %", "Model pick", "ML edge %", "Away ML", "Home ML", "Home spread", "Spread pick", "Spread edge %", "Total", "Total pick", "Total edge %", "Best bet", "Best bet edge %", "Confidence %", "Temp °F", "Wind mph", "Final", "Score"],
    rows: nfl.map((g) => {
      const hp = pct(g.locked_pct ?? g.home_win_pct_pre);
      const pick = (g.ai_pick_team as string) || (hp == null ? null : hp >= 50 ? (g.home_team as string) : (g.away_team as string));
      return [
        g.away_team as string, g.home_team as string, g.kickoff as string, hp, pick, fr(g.ai_edge_pct),
        num(g.moneyline_away_odds), num(g.moneyline_home_odds), num(g.spread_home_line), (g.spread_ai_pick_team as string) ?? null, fr(g.spread_ai_edge_pct),
        num(g.total_line), g.total_ai_pick as string, fr(g.total_ai_edge_pct), g.best_market_label as string, fr(g.best_market_edge_pct), fr(g.best_market_confidence_pct),
        num(g.temp_f), num(g.wind_mph), g.is_final ? "Final" : "", g.is_final ? `${g.away_score}-${g.home_score}` : "",
      ];
    }),
  });

  // Other sports: yesterday through the next three days.
  const other = await rowsOf<Record<string, unknown>>(sql`
    select sport, away_team, home_team, ${etTime("kickoff_at")} as kickoff, home_win_pct_pre, moneyline_away_odds, moneyline_home_odds,
      spread_home_line, total_line, best_market_label, best_market_edge_pct, best_market_confidence_pct, is_final, away_score, home_score,
      coalesce(extra->'venue'->>'fullName', extra->>'venue') as venue
    from sport_games where kickoff_at between now() - interval '30 hours' and now() + interval '3 days'
    order by sport, kickoff_at, home_team`);
  tabs.push({
    name: "Other Sports",
    note: "NBA, WNBA, NHL, MLB and college games from yesterday through the next three days.",
    headers: ["Sport", "Away", "Home", "Start (ET)", "Home win %", "Model pick", "Away ML", "Home ML", "Home spread", "Total", "Best bet", "Best bet edge %", "Confidence %", "Final", "Score", "Venue"],
    rows: other.map((g) => {
      const hp = pct(g.home_win_pct_pre);
      return [
        String(g.sport).toUpperCase(), g.away_team as string, g.home_team as string, g.kickoff as string, hp, hp == null ? null : hp >= 50 ? (g.home_team as string) : (g.away_team as string),
        num(g.moneyline_away_odds), num(g.moneyline_home_odds), num(g.spread_home_line), num(g.total_line), g.best_market_label as string, fr(g.best_market_edge_pct), fr(g.best_market_confidence_pct),
        g.is_final ? "Final" : "", g.is_final ? `${g.away_score}-${g.home_score}` : "", (g.venue as string) ?? "",
      ];
    }),
  });

  // Best bets: every upcoming game's best market with a positive edge, most confident first.
  const best = await rowsOf<Record<string, unknown>>(sql`
    select * from (
      select 'NFL' as sport, away_team || ' @ ' || home_team as matchup, kickoff_at, ${etTime("kickoff_at")} as kickoff, best_market_label, best_market_edge_pct, best_market_confidence_pct
      from games where season = ${season} and not is_final and kickoff_at > now() and best_market_edge_pct > 0
      union all
      select upper(sport), away_team || ' @ ' || home_team, kickoff_at, ${etTime("kickoff_at")}, best_market_label, best_market_edge_pct, best_market_confidence_pct
      from sport_games where not is_final and kickoff_at between now() and now() + interval '3 days' and best_market_edge_pct > 0
    ) b order by best_market_confidence_pct desc nulls last, best_market_edge_pct desc limit 300`);
  tabs.push({
    name: "Best Bets",
    note: "Upcoming games where the model's best market has a positive edge, most confident first.",
    headers: ["Sport", "Game", "Start (ET)", "Bet", "Edge %", "Confidence %"],
    rows: best.map((b) => [b.sport as string, b.matchup as string, b.kickoff as string, b.best_market_label as string, fr(b.best_market_edge_pct), fr(b.best_market_confidence_pct)]),
  });

  // Player props.
  const props = await rowsOf<Record<string, unknown>>(sql`
    select distinct on (player, stat_type, line, side) player, team, stat_type, line, side, book, price_american, projection, model_win_pct, market_pct, edge_pct, trust
    from odds_lines where season = ${season} and week = ${week} and edge_pct is not null
    order by player, stat_type, line, side, fetched_at desc`);
  props.sort((a, b) => Number(b.edge_pct) - Number(a.edge_pct));
  tabs.push({
    name: "NFL Props",
    note: "This week's NFL player props with the model's chance, the market's chance and the edge.",
    headers: ["Player", "Team", "Prop", "Line", "Side", "Book", "Price", "Projection", "Model %", "Market %", "Edge %", "Trust"],
    rows: props.map((p) => [p.player as string, p.team as string, p.stat_type as string, num(p.line), p.side as string, p.book as string, num(p.price_american), num(p.projection), fr(p.model_win_pct), fr(p.market_pct), fr(p.edge_pct), trustTier(p.trust)]),
  });
  const sprops = await rowsOf<Record<string, unknown>>(sql`
    select distinct on (sport, player, stat_type, line, side) sport, player, team, stat_type, line, side, book, price_american, projection, model_win_pct, market_pct, edge_pct
    from sport_odds_lines where fetched_at > now() - interval '36 hours' and edge_pct is not null
    order by sport, player, stat_type, line, side, fetched_at desc`);
  sprops.sort((a, b) => Number(b.edge_pct) - Number(a.edge_pct));
  tabs.push({
    name: "Other Props",
    note: "Player props for the other sports from the last 36 hours.",
    headers: ["Sport", "Player", "Team", "Prop", "Line", "Side", "Book", "Price", "Projection", "Model %", "Market %", "Edge %"],
    rows: sprops.map((p) => [String(p.sport).toUpperCase(), p.player as string, p.team as string, p.stat_type as string, num(p.line), p.side as string, p.book as string, num(p.price_american), num(p.projection), fr(p.model_win_pct), fr(p.market_pct), fr(p.edge_pct)]),
  });

  // Long shots.
  const ls = await getLongShots();
  tabs.push({
    name: "Long Shots",
    note: `Every NFL player's anytime-TD chance vs the sportsbooks${ls ? ` (week ${ls.week})` : ""}. Team rank 1-2 = the books' favourites on that team.`,
    headers: ["Player", "Team", "Game", "Team rank", "Model %", "Market %", "Edge (pts)", "Best price", "Books", "Games of history"],
    rows: (ls?.rows ?? []).map((r) => [r.player, r.team, r.game, r.teamRank, r.model, r.market, r.edge, r.bestPrice, r.books, r.games]),
  });

  // Injuries.
  const inj = await rowsOf<Record<string, unknown>>(sql`
    select team, player, position, status, next_opponent, game_missed_label, anticipated_return, win_pct_impact
    from injury_reports where season = ${season} and updated_at > now() - interval '4 days' 
    order by abs(coalesce(win_pct_impact, 0)) desc, team, player`);
  tabs.push({
    name: "NFL Injuries",
    note: "The latest NFL injury report, biggest impact on win chance first.",
    headers: ["Team", "Player", "Pos", "Status", "Next opponent", "Missed", "Expected back", "Win % impact"],
    rows: inj.map((r) => [r.team as string, r.player as string, r.position as string, r.status as string, r.next_opponent as string, r.game_missed_label as string, r.anticipated_return as string, pct(r.win_pct_impact)]),
  });
  const sinj = await rowsOf<Record<string, unknown>>(sql`
    select sport, team, player, position, status, win_pct_impact from sport_injury_reports where updated_at > now() - interval '3 days'
    order by sport, abs(coalesce(win_pct_impact, 0)) desc, team, player`);
  tabs.push({
    name: "Other Injuries",
    note: "Injury reports for the other sports, updated in the last three days.",
    headers: ["Sport", "Team", "Player", "Pos", "Status", "Win % impact"],
    rows: sinj.map((r) => [String(r.sport).toUpperCase(), r.team as string, r.player as string, r.position as string, r.status as string, pct(r.win_pct_impact)]),
  });

  // Trades.
  const tr = await rowsOf<Record<string, unknown>>(sql`
    select sport, to_char(trade_date, 'YYYY-MM-DD') as day, team, direction, player, position, other_team, value_label, impact_pct, impact_now_pct, description
    from trades where trade_date > now() - interval '120 days' order by trade_date desc, sport, team`);
  tabs.push({
    name: "Trades",
    note: "Trades in the last four months and what each is worth to the team's win chance (Now = what the model still adds today).",
    headers: ["Sport", "Date", "Team", "In/Out", "Player", "Pos", "Other team", "Value", "Impact %", "Now %", "Details"],
    rows: tr.map((r) => [String(r.sport).toUpperCase(), r.day as string, r.team as string, r.direction as string, r.player as string, r.position as string, r.other_team as string, r.value_label as string, pct(r.impact_pct), pct(r.impact_now_pct), r.description as string]),
  });

  // Elo ratings (latest per team).
  const elo = await rowsOf<Record<string, unknown>>(sql`
    select * from (
      select distinct on (team) 'NFL' as sport, team, rating, games_played from team_elo_ratings order by team, season desc, week desc
    ) a
    union all
    select * from (
      select distinct on (sport, team) upper(sport), team, rating, games_played from sport_elo_ratings order by sport, team, season desc, week desc
    ) b order by 1, 3 desc`);
  tabs.push({
    name: "Elo Ratings",
    note: "Each team's current Elo rating (1500 = average).",
    headers: ["Sport", "Team", "Rating", "Games"],
    rows: elo.map((r) => [r.sport as string, r.team as string, Math.round(Number(r.rating)), num(r.games_played)]),
  });

  // Records: game picks and props.
  // NFL game picks graded from final scores: the model's side is the one it gave 50%+.
  const mt = await rowsOf<Record<string, unknown>>(sql`
    select season, week,
      count(*) filter (where (coalesce(locked_pct, home_win_pct_pre) >= 0.5) = (home_score > away_score)) as w,
      count(*) filter (where (coalesce(locked_pct, home_win_pct_pre) >= 0.5) <> (home_score > away_score)) as l
    from games where is_final and home_score <> away_score and coalesce(locked_pct, home_win_pct_pre) is not null
      and season >= ${season - 1}
    group by season, week order by season desc, week desc`);
  const pr = await rowsOf<Record<string, unknown>>(sql`
    select upper(sport) as sport, stat_type, count(*) filter (where result = 'hit') as w, count(*) filter (where result = 'miss') as l,
      count(*) filter (where result in ('void', 'push')) as p
    from prop_pick_log where graded_at is not null group by 1, 2
    having count(*) filter (where result in ('hit', 'miss')) > 0 order by 1, (count(*)) desc`);
  tabs.push({
    name: "Record",
    note: "The model's graded record: NFL game picks by week, then player props by sport and prop type.",
    headers: ["Section", "Season / Sport", "Week / Prop", "Wins / Hits", "Losses / Misses", "Voids", "Hit %"],
    rows: [
      ...mt.map((r) => {
        const w = Number(r.w), l = Number(r.l);
        return ["NFL game picks", num(r.season), num(r.week), w, l, 0, w + l ? Math.round((1000 * w) / (w + l)) / 10 : null] as Cell[];
      }),
      ...pr.map((r) => {
        const w = Number(r.w), l = Number(r.l);
        return ["Player props", r.sport as string, r.stat_type as string, w, l, Number(r.p), w + l ? Math.round((1000 * w) / (w + l)) / 10 : null] as Cell[];
      }),
    ],
  });

  // Model parlays (system-built only, never users' own).
  const pl = await rowsOf<Record<string, unknown>>(sql`
    select title, kind, season, week, size, combined_win_pct, weakest_leg_win_pct, confidence, status, legs::text as legs,
      to_char(created_at, 'YYYY-MM-DD') as made
    from parlay_picks where user_id is null order by created_at desc limit 100`);
  tabs.push({
    name: "Parlays",
    note: "Parlays built by the model (not users' own), newest first.",
    headers: ["Title", "Kind", "Season", "Week", "Legs", "Combined win %", "Weakest leg %", "Confidence", "Status", "Made", "Leg details"],
    rows: pl.map((r) => [(r.title as string) || `${r.size}-leg ${String(r.kind).replace(/_/g, " ")}`, r.kind as string, num(r.season), num(r.week), num(r.size), fr(r.combined_win_pct), fr(r.weakest_leg_win_pct), r.confidence as string, r.status as string, r.made as string, legsText(r.legs)]),
  });

  return tabs;
}

/** Parlay legs as one readable line: "Player Under 3.5 Receptions (-1329, Kalshi, 97%) | ...". */
function legsText(raw: unknown): string {
  try {
    const legs = JSON.parse(String(raw ?? "[]")) as { player?: string; side?: string; line?: number; statType?: string; priceAmerican?: number; book?: string; winPct?: number }[];
    return legs
      .map((l) => `${l.player} ${l.side} ${l.line} ${l.statType} (${(l.priceAmerican ?? 0) > 0 ? "+" : ""}${l.priceAmerican}, ${l.book}, ${Math.round(100 * (l.winPct ?? 0))}%)`)
      .join(" | ")
      .slice(0, 4000);
  } catch {
    return String(raw ?? "").slice(0, 4000);
  }
}

// ---- Google Sheets push -------------------------------------------------

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

async function googleToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const sig = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key).toString("base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }),
  });
  if (!r.ok) throw new Error(`Google sign-in failed (${r.status})`);
  return ((await r.json()) as { access_token: string }).access_token;
}

/** Replace every tab's contents in the Sheet (tabs are created if missing). Returns a short summary. */
export async function pushToGoogleSheet(tabs?: SheetTab[]): Promise<string> {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const sheetId = process.env.SEASONZ_SHEET_ID?.trim();
  if (!raw || !sheetId) return "skipped (no Google key or Sheet ID set)";
  const sa = JSON.parse(raw) as ServiceAccount;
  const token = await googleToken(sa);
  const api = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}`;
  const call = async (path: string, init: RequestInit = {}) => {
    const r = await fetch(`${api}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) } });
    if (!r.ok) throw new Error(`Google Sheets ${r.status} on ${path.split("?")[0]}`);
    return r.json();
  };
  const all = tabs ?? (await buildSheetTabs());
  const updated = new Date().toLocaleString("en-US", { timeZone: ET, dateStyle: "medium", timeStyle: "short" }) + " ET";
  const withReadme: SheetTab[] = [
    {
      name: "Read Me",
      note: "",
      headers: ["Seasonz", ""],
      rows: [["Updated", updated], ["", ""], ...all.map((t) => [t.name, t.note] as Cell[])],
    },
    ...all,
  ];

  const meta = (await call("?fields=sheets.properties(title,sheetId)")) as { sheets: { properties: { title: string } }[] };
  const have = new Set(meta.sheets.map((s) => s.properties.title));
  const add = withReadme.filter((t) => !have.has(t.name)).map((t) => ({ addSheet: { properties: { title: t.name, gridProperties: { frozenRowCount: 1 } } } }));
  if (add.length) await call(":batchUpdate", { method: "POST", body: JSON.stringify({ requests: add }) });

  const q = (n: string) => `'${n.replace(/'/g, "''")}'`;
  await call("/values:batchClear", { method: "POST", body: JSON.stringify({ ranges: withReadme.map((t) => q(t.name)) }) });
  await call("/values:batchUpdate", {
    method: "POST",
    body: JSON.stringify({
      valueInputOption: "RAW",
      data: withReadme.map((t) => ({ range: `${q(t.name)}!A1`, values: [t.headers, ...t.rows.map((r) => r.map((c) => (c == null ? "" : typeof c === "object" ? JSON.stringify(c) : c)))] })),
    }),
  });
  return `${withReadme.length} tabs, ${all.reduce((n, t) => n + t.rows.length, 0)} rows`;
}
