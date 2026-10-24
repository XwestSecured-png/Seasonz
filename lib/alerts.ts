// Push alerts, run every 30 minutes by pg_cron (/api/alerts):
//   locks: games in sports you've picked recently that lock in the next
//     half hour and you haven't picked yet.
//   edges: once a day (from 11am ET), the day's three strongest edges.
//   moves: the line moved 5+ points of win chance since you picked or bet
//     (toward or against your side), for games in the next two days.
// Every alert is deduped through alert_log, so a rerun never repeats one.
import { db } from "@/db";
import { games, pushSubscriptions, sportGames, sportPropLinesRaw, sportUserPicks, userBets, userPicks, userPropPicks } from "@/db/schema";
import { betterLine, statTypesForLabel } from "./better-line";
import { and, eq, gt, gte, inArray, isNotNull, lt } from "drizzle-orm";
import { SPORTS, type SportKey } from "./sports/types";
import { getBestBetsFeed } from "./best-bets-feed";
import { DEFAULT_PREFS, sendAlert, type PushPrefs } from "./push";
import { noVigHome } from "./sports/game-model";
import { PICK_LOCK_MINUTES_BEFORE_KICKOFF } from "./time";
import { recentReturns } from "./injury-returns";

const MIN = 60_000;
const HOUR = 60 * MIN;
export const MOVE_ALERT = 0.05;
const implied = (a: number) => (a < 0 ? -a / (-a + 100) : 100 / (a + 100));
const etTime = (d: Date) => d.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
const label = (sport: string) => (sport === "nfl" ? "NFL" : (SPORTS[sport as SportKey]?.label ?? sport));

/** Run slot: the half hour this run belongs to (dedupes lock reminders). */
export function slotOf(now: Date): string {
  const t = new Date(Math.floor(now.getTime() / (30 * MIN)) * 30 * MIN);
  return t.toISOString().slice(0, 16);
}

/** Change in the market's chance for a side, as a signed number. */
export function moveFor(atPick: number, nowPct: number): number {
  return nowPct - atPick;
}

export async function runAlerts(now = new Date()): Promise<string> {
  const subs = await db.select({ userId: pushSubscriptions.userId, prefs: pushSubscriptions.prefs }).from(pushSubscriptions);
  if (subs.length === 0) return "No subscribers.";
  const prefsBy = new Map<number, PushPrefs>();
  for (const s of subs) {
    const p = { ...DEFAULT_PREFS, ...((s.prefs ?? {}) as Partial<PushPrefs>) };
    const prev = prefsBy.get(s.userId);
    // Any device that wants a kind turns it on for the user.
    prefsBy.set(
      s.userId,
      prev ? { locks: prev.locks || p.locks, edges: prev.edges || p.edges, moves: prev.moves || p.moves, returns: prev.returns || p.returns } : p
    );
  }
  const userIds = [...prefsBy.keys()];
  const sent = { locks: 0, edges: 0, moves: 0, returns: 0, lines: 0 };

  // ---- Lock reminders -----------------------------------------------------
  // Games locking in this run's window: kickoff - lock minutes in [now, now+30m).
  const lockFrom = new Date(now.getTime() + PICK_LOCK_MINUTES_BEFORE_KICKOFF * MIN);
  const lockTo = new Date(lockFrom.getTime() + 30 * MIN);
  const lockUsers = userIds.filter((u) => prefsBy.get(u)!.locks);
  if (lockUsers.length) {
    const recent = new Date(now.getTime() - 21 * 24 * HOUR);
    const sportPicks = await db
      .select({ userId: sportUserPicks.userId, sport: sportUserPicks.sport, gameId: sportUserPicks.gameId, at: sportUserPicks.updatedAt })
      .from(sportUserPicks)
      .where(inArray(sportUserPicks.userId, lockUsers));
    const nflPicks = await db
      .select({ userId: userPicks.userId, gameId: userPicks.gameId, at: userPicks.updatedAt })
      .from(userPicks)
      .where(inArray(userPicks.userId, lockUsers));
    const plays = new Map<number, Set<string>>();
    const picked = new Set<string>();
    for (const p of sportPicks) {
      picked.add(`${p.sport}:${p.gameId}:${p.userId}`);
      if (p.at && p.at >= recent) (plays.get(p.userId) ?? plays.set(p.userId, new Set()).get(p.userId)!).add(p.sport);
    }
    for (const p of nflPicks) {
      picked.add(`nfl:${p.gameId}:${p.userId}`);
      if (p.at && p.at >= recent) (plays.get(p.userId) ?? plays.set(p.userId, new Set()).get(p.userId)!).add("nfl");
    }
    const upSport = await db
      .select({ id: sportGames.id, sport: sportGames.sport, home: sportGames.homeTeam, away: sportGames.awayTeam, at: sportGames.kickoffAt })
      .from(sportGames)
      .where(and(eq(sportGames.isFinal, false), gte(sportGames.kickoffAt, lockFrom), lt(sportGames.kickoffAt, lockTo)));
    const upNfl = await db
      .select({ id: games.id, home: games.homeTeam, away: games.awayTeam, at: games.kickoffAt })
      .from(games)
      .where(and(eq(games.isFinal, false), gte(games.kickoffAt, lockFrom), lt(games.kickoffAt, lockTo)));
    const up = [...upSport, ...upNfl.map((g) => ({ ...g, sport: "nfl" }))];
    const slot = slotOf(now);
    for (const u of lockUsers) {
      const mine = plays.get(u);
      if (!mine) continue;
      const open = up.filter((g) => mine.has(g.sport) && !picked.has(`${g.sport}:${g.id}:${u}`));
      if (open.length === 0) continue;
      const first = open[0];
      const body =
        open.length === 1
          ? `${label(first.sport)}: ${first.away} @ ${first.home} locks at ${etTime(new Date(first.at!.getTime() - PICK_LOCK_MINUTES_BEFORE_KICKOFF * MIN))} ET. Make your pick.`
          : `${open.length} games lock in the next half hour: ${open
              .slice(0, 4)
              .map((g) => `${g.away}@${g.home}`)
              .join(", ")}${open.length > 4 ? "…" : ""}`;
      if (
        await sendAlert(u, "locks", `locks:${slot}`, {
          title: "Picks about to lock",
          body,
          url: first.sport === "nfl" ? "/model-tracker" : `/sports/${first.sport}`,
          tag: "locks",
        })
      )
        sent.locks++;
    }
  }

  // ---- Daily best edges ---------------------------------------------------
  const etHour = Number(now.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }));
  const edgeUsers = userIds.filter((u) => prefsBy.get(u)!.edges);
  if (edgeUsers.length && etHour >= 11 && etHour < 22) {
    const top = (await getBestBetsFeed(24)).filter((x) => x.edge >= 0.04).slice(0, 3);
    if (top.length) {
      const day = now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
      const body = top.map((x) => `${x.label} (${x.sportLabel}, +${(x.edge * 100).toFixed(1)} pts at ${x.bestBook})`).join(" · ");
      for (const u of edgeUsers) {
        if (await sendAlert(u, "edges", `edges:${day}`, { title: "Today's best edges", body, url: "/best-bets", tag: "edges" })) sent.edges++;
      }
    }
  }

  // ---- Line moves on your picks and bets -----------------------------------
  const moveUsers = userIds.filter((u) => prefsBy.get(u)!.moves);
  if (moveUsers.length) {
    const until = new Date(now.getTime() + 48 * HOUR);
    const sp = await db
      .select({
        userId: sportUserPicks.userId,
        sport: sportUserPicks.sport,
        gameId: sportUserPicks.gameId,
        team: sportUserPicks.team,
        atPick: sportUserPicks.marketAtPick,
        home: sportGames.homeTeam,
        away: sportGames.awayTeam,
        extra: sportGames.extra,
      })
      .from(sportUserPicks)
      .innerJoin(sportGames, eq(sportGames.id, sportUserPicks.gameId))
      .where(
        and(inArray(sportUserPicks.userId, moveUsers), isNotNull(sportUserPicks.marketAtPick), gt(sportGames.kickoffAt, now), lt(sportGames.kickoffAt, until))
      );
    const np = await db
      .select({
        userId: userPicks.userId,
        gameId: userPicks.gameId,
        team: userPicks.team,
        atPick: userPicks.marketAtPick,
        home: games.homeTeam,
        away: games.awayTeam,
        market: games.marketPct,
      })
      .from(userPicks)
      .innerJoin(games, eq(games.id, userPicks.gameId))
      .where(and(inArray(userPicks.userId, moveUsers), isNotNull(userPicks.marketAtPick), gt(games.kickoffAt, now), lt(games.kickoffAt, until)));

    const items: { userId: number; ref: string; sport: string; side: string; matchup: string; from: number; to: number; what: string }[] = [];
    for (const p of sp) {
      const m = (p.extra as { model?: { marketPct?: number | null } } | null)?.model?.marketPct;
      if (m == null || p.atPick == null) continue;
      const to = p.team === p.home ? m : 1 - m;
      items.push({ userId: p.userId, ref: `${p.sport}:${p.gameId}`, sport: p.sport, side: p.team, matchup: `${p.away} @ ${p.home}`, from: p.atPick, to, what: "your pick" });
    }
    for (const p of np) {
      if (p.market == null || p.atPick == null) continue;
      const to = p.team === p.home ? p.market : 1 - p.market;
      items.push({ userId: p.userId, ref: `nfl:${p.gameId}`, sport: "nfl", side: p.team, matchup: `${p.away} @ ${p.home}`, from: p.atPick, to, what: "your pick" });
    }

    // Moneyline bets: the price you got vs the market now.
    const bets = await db
      .select()
      .from(userBets)
      .where(and(inArray(userBets.userId, moveUsers), eq(userBets.result, "PENDING"), eq(userBets.market, "ML")));
    const sgIds = bets.map((b) => b.sportGameId).filter((x): x is number => x != null);
    const gIds = bets.map((b) => b.gameId).filter((x): x is number => x != null);
    const sgRows = sgIds.length ? await db.select().from(sportGames).where(inArray(sportGames.id, sgIds)) : [];
    const gRows = gIds.length ? await db.select().from(games).where(inArray(games.id, gIds)) : [];
    for (const b of bets) {
      let home: string, away: string, at: Date | null, homeNow: number | null;
      if (b.sportGameId != null) {
        const g = sgRows.find((r) => r.id === b.sportGameId);
        if (!g) continue;
        ({ homeTeam: home, awayTeam: away, kickoffAt: at } = g);
        homeNow = (g.extra as { model?: { marketPct?: number | null } } | null)?.model?.marketPct ?? noVigHome(g.moneylineHomeOdds, g.moneylineAwayOdds);
      } else {
        const g = gRows.find((r) => r.id === b.gameId);
        if (!g) continue;
        ({ homeTeam: home, awayTeam: away, kickoffAt: at } = g);
        homeNow = g.marketPct ?? noVigHome(g.moneylineHomeOdds, g.moneylineAwayOdds);
      }
      if (!at || at <= now || at >= until || homeNow == null) continue;
      const to = b.selection === home ? homeNow : 1 - homeNow;
      items.push({ userId: b.userId, ref: `bet:${b.id}`, sport: b.sport, side: b.selection, matchup: `${away} @ ${home}`, from: implied(b.priceAmerican), to, what: "your bet" });
    }

    for (const it of items) {
      const d = moveFor(it.from, it.to);
      if (Math.abs(d) < MOVE_ALERT) continue;
      const dir = d > 0 ? "toward" : "against";
      // One alert per direction per pick/bet.
      const ok = await sendAlert(it.userId, "moves", `move:${it.ref}:${dir}`, {
        title: `Line moved ${dir} ${it.what}`,
        body: `${label(it.sport)} ${it.matchup}: ${it.side} now ${Math.round(it.to * 100)}% to win (was ${Math.round(it.from * 100)}%).`,
        url: it.sport === "nfl" ? "/model-tracker" : `/sports/${it.sport}`,
        tag: `move-${it.ref}`,
      });
      if (ok) sent.moves++;
    }
  }

  // ---- A better line for a saved prop pick (1.26.0) ----------------------
  // Pending saved props whose game starts in the next 24 hours: when a book
  // posts the same prop at an easier number (lower for an Over, higher for an
  // Under) at -150 or better, tell the user once (lib/better-line.ts).
  const lineUsers = userIds.filter((u) => prefsBy.get(u)!.moves);
  if (lineUsers.length) {
    const until = new Date(now.getTime() + 24 * HOUR);
    const pend = await db
      .select({
        id: userPropPicks.id,
        userId: userPropPicks.userId,
        sport: userPropPicks.sport,
        player: userPropPicks.player,
        statLabel: userPropPicks.statLabel,
        threshold: userPropPicks.threshold,
        side: userPropPicks.side,
      })
      .from(userPropPicks)
      .innerJoin(sportGames, eq(sportGames.id, userPropPicks.gameId))
      .where(and(inArray(userPropPicks.userId, lineUsers), eq(userPropPicks.result, "pending"), gt(sportGames.kickoffAt, now), lt(sportGames.kickoffAt, until)));
    const bySport = new Map<string, typeof pend>();
    for (const p of pend) (bySport.get(p.sport) ?? bySport.set(p.sport, []).get(p.sport)!).push(p);
    for (const [sport, picks] of bySport) {
      const statTypes = new Set(picks.flatMap((p) => statTypesForLabel(sport as SportKey, p.statLabel)));
      if (!statTypes.size) continue;
      const lines = await db
        .select({ player: sportPropLinesRaw.player, statType: sportPropLinesRaw.statType, line: sportPropLinesRaw.line, side: sportPropLinesRaw.side, book: sportPropLinesRaw.book, priceAmerican: sportPropLinesRaw.priceAmerican })
        .from(sportPropLinesRaw)
        .where(and(eq(sportPropLinesRaw.sport, sport), inArray(sportPropLinesRaw.statType, [...statTypes]), gte(sportPropLinesRaw.fetchedAt, new Date(now.getTime() - 36 * HOUR))));
      for (const p of picks) {
        const types = new Set(statTypesForLabel(sport as SportKey, p.statLabel));
        const side = p.side === "under" ? "under" : "over";
        const b = betterLine({ player: p.player, side, threshold: p.threshold }, lines.filter((l) => types.has(l.statType)));
        if (!b) continue;
        const word = side === "over" ? "Over" : "Under";
        const ok = await sendAlert(p.userId, "moves", `betterline:${p.id}`, {
          title: "A better line for your pick",
          body: `${p.player} ${word} ${p.threshold} ${p.statLabel}: ${b.book} now has ${word} ${b.line} (${b.priceAmerican > 0 ? "+" : ""}${b.priceAmerican}).`,
          url: `/props?sport=${sport}`,
          tag: `betterline-${p.id}`,
        });
        if (ok) sent.lines++;
      }
    }
  }

  // ---- Key players back from injury --------------------------------------
  // Detected in the last 12 hours, team plays in the next 2 days, for users
  // who've picked or bet that sport in the last 30 days (or everyone, for
  // users with no picks yet). At most 3 per user per run.
  const returnUsers = userIds.filter((u) => prefsBy.get(u)!.returns);
  if (returnUsers.length) {
    const fresh = await recentReturns(12);
    if (fresh.length) {
      const until = new Date(now.getTime() + 48 * HOUR);
      const nextGame = new Map<string, { opp: string; home: boolean; at: Date }>();
      const sg = await db
        .select({ sport: sportGames.sport, home: sportGames.homeTeam, away: sportGames.awayTeam, at: sportGames.kickoffAt })
        .from(sportGames)
        .where(and(eq(sportGames.isFinal, false), gt(sportGames.kickoffAt, now), lt(sportGames.kickoffAt, until)));
      const ng = await db
        .select({ home: games.homeTeam, away: games.awayTeam, at: games.kickoffAt })
        .from(games)
        .where(and(eq(games.isFinal, false), gt(games.kickoffAt, now), lt(games.kickoffAt, until)));
      for (const g of [...sg, ...ng.map((x) => ({ ...x, sport: "nfl" }))]) {
        if (!g.at) continue;
        for (const [team, opp, home] of [[g.home, g.away, true], [g.away, g.home, false]] as const) {
          const k = `${g.sport}|${team}`;
          const cur = nextGame.get(k);
          if (!cur || g.at < cur.at) nextGame.set(k, { opp, home, at: g.at });
        }
      }
      const relevant = fresh.filter((r) => nextGame.has(`${r.sport}|${r.team}`));
      if (relevant.length) {
        const since = new Date(now.getTime() - 30 * 24 * HOUR);
        const follows = new Map<number, Set<string>>();
        const addF = (u: number, sp: string) => (follows.get(u) ?? follows.set(u, new Set()).get(u)!).add(sp);
        for (const p of await db
          .select({ u: sportUserPicks.userId, sp: sportUserPicks.sport })
          .from(sportUserPicks)
          .where(and(inArray(sportUserPicks.userId, returnUsers), gte(sportUserPicks.updatedAt, since))))
          addF(p.u, p.sp);
        for (const p of await db
          .select({ u: userPicks.userId })
          .from(userPicks)
          .where(and(inArray(userPicks.userId, returnUsers), gte(userPicks.updatedAt, since))))
          addF(p.u, "nfl");
        for (const b of await db
          .select({ u: userBets.userId, sp: userBets.sport })
          .from(userBets)
          .where(and(inArray(userBets.userId, returnUsers), gte(userBets.placedAt, since))))
          addF(b.u, b.sp);
        const day = (d: Date) => d.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short" });
        for (const u of returnUsers) {
          const f = follows.get(u);
          let n = 0;
          for (const r of relevant) {
            if (n >= 3) break;
            if (f && !f.has(r.sport)) continue;
            const g = nextGame.get(`${r.sport}|${r.team}`)!;
            const missedTxt = r.missed > 0 ? ` after missing ${r.missed} game${r.missed === 1 ? "" : "s"}` : "";
            const ok = await sendAlert(u, "returns", `return:${r.id}`, {
              title: `${label(r.sport)}: ${r.player} is back`,
              body: `${r.player} (${r.team}, ${r.detail}) is off the injury report${missedTxt}. ${r.team} ${g.home ? "vs" : "@"} ${g.opp}, ${day(g.at)} ${etTime(g.at)} ET. Lines and our chances may shift.`,
              url: r.sport === "nfl" ? "/injury-impact" : `/sports/${r.sport}`,
              tag: `return-${r.id}`,
            });
            if (ok) {
              sent.returns++;
              n++;
            }
          }
        }
      }
    }
  }

  return `Alerts sent: ${sent.locks} lock, ${sent.edges} edge, ${sent.moves} line-move, ${sent.lines} better-line, ${sent.returns} back-from-injury (${userIds.length} subscriber(s)).`;
}
