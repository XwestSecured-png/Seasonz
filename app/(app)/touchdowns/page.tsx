import Link from "next/link";
import { getScoringBoard, type BoardPlayer, type EventKey } from "@/lib/scoring-board";
import { PageInfo } from "../page-info";
import { verdictFor, VERDICT_CLASS } from "@/lib/prop-verdict";

export const dynamic = "force-dynamic";

type Tab = "tds" | "ints" | "fumbles" | "next";
const TABS: { key: Tab; label: string }[] = [
  { key: "next", label: "Who scores next" },
  { key: "tds", label: "Touchdowns" },
  { key: "ints", label: "Interceptions" },
  { key: "fumbles", label: "Fumbles" },
];

interface Col {
  key: EventKey;
  label: string;
}
const COLS: Record<Exclude<Tab, "next">, Col[]> = {
  tds: [
    { key: "rushTd", label: "Rush" },
    { key: "recTd", label: "Rec" },
    { key: "returnTd", label: "Return" },
    { key: "defTd", label: "Defense" },
    { key: "passTd", label: "Pass (thrown)" },
  ],
  ints: [
    { key: "intThrown", label: "Thrown" },
    { key: "defInt", label: "Caught (defense)" },
  ],
  fumbles: [
    { key: "fumbles", label: "Fumbles" },
    { key: "fumblesLost", label: "Lost" },
    { key: "forced", label: "Forced" },
    { key: "recovered", label: "Recovered" },
  ],
};
// What a tab ranks by.
const scoreFor = (tab: Exclude<Tab, "next">, p: BoardPlayer, sort: string | undefined) => {
  if (sort && (COLS[tab] as Col[]).some((c) => c.key === sort)) return p.totals[sort as EventKey];
  if (tab === "tds") return p.totals.rushTd + p.totals.recTd + p.totals.returnTd + p.totals.defTd;
  if (tab === "ints") return p.totals.intThrown + p.totals.defInt;
  return p.totals.fumbles + p.totals.forced + p.totals.recovered;
};
const POS_GROUP: Record<string, string[]> = {
  QB: ["QB"],
  RB: ["RB", "FB"],
  WR: ["WR"],
  TE: ["TE"],
  DEF: ["CB", "DB", "DE", "DL", "DT", "FS", "ILB", "LB", "MLB", "NT", "OLB", "S", "SAF"],
};

export default async function TouchdownsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; team?: string; pos?: string; q?: string; sort?: string }>;
}) {
  const sp = await searchParams;
  const tab: Tab = (["tds", "ints", "fumbles", "next"] as const).find((t) => t === sp.tab) ?? "next";
  const board = await getScoringBoard();
  const team = sp.team && sp.team !== "all" ? sp.team : null;
  const pos = sp.pos && POS_GROUP[sp.pos] ? sp.pos : null;
  const q = (sp.q ?? "").trim().toLowerCase();
  const href = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const merged = { tab, team, pos, q: q || null, sort: sp.sort ?? null, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/touchdowns?${p.toString()}`;
  };
  const chip = (active: boolean) =>
    `rounded-full px-3 py-1 text-xs font-medium transition-colors ${active ? "bg-sky-600 text-white" : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"}`;

  if (!board) {
    return (
      <div className="space-y-3">
        <h1 className="text-lg font-semibold">TDs &amp; Turnovers</h1>
        <p className="text-sm text-neutral-500">The board builds with the next NFL sync. Check back after it runs.</p>
      </div>
    );
  }
  const teams = [...new Set(board.players.map((p) => p.team))].filter(Boolean).sort();
  const matches = (p: { player: string; team: string; position: string }) =>
    (!team || p.team === team) && (!pos || POS_GROUP[pos].includes(p.position)) && (!q || p.player.toLowerCase().includes(q));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">TDs &amp; Turnovers</h1>
        <p className="text-sm text-neutral-400 max-w-2xl">
          Every touchdown, interception and fumble by player, {board.season} season through week {board.throughWeek}, and who&rsquo;s most
          likely to score in week {board.nextWeek}.
        </p>
      </div>
      <PageInfo>
        <p>
          <strong>Who scores next</strong> ranks every running back, receiver, tight end and quarterback by his chance to score a rushing
          or receiving touchdown in his next game. Touchdowns follow opportunity, so the model starts from how often he gets the ball
          (carries and targets, recent games counted more), multiplies by how often players like him turn a touch into a touchdown (his
          own rate, pulled toward his position&rsquo;s average so a lucky month doesn&rsquo;t fool it), then scales by how many points his
          team is expected to score from this week&rsquo;s spread and total.
        </p>
        <p>
          Tested on past games, it predicted scorers much better than a plain touchdowns-per-game average (log loss 0.46 vs 0.74, lower is
          better), and its chances held up: players given about 25% scored about 26% of the time. Stats are from nflverse and update with
          each sync.
        </p>
      </PageInfo>

      <div className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <Link key={t.key} href={href({ tab: t.key, sort: null })} className={chip(tab === t.key)}>
            {t.label}
          </Link>
        ))}
      </div>

      <form action="/touchdowns" className="flex flex-wrap items-center gap-2 text-xs">
        <input type="hidden" name="tab" value={tab} />
        <input
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Search player"
          className="rounded-md bg-neutral-900 border border-neutral-700 px-2 py-1 text-neutral-100 w-40"
        />
        <select name="team" defaultValue={team ?? "all"} className="rounded-md bg-neutral-900 border border-neutral-700 px-2 py-1 text-neutral-100">
          <option value="all">All teams</option>
          {teams.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select name="pos" defaultValue={pos ?? ""} className="rounded-md bg-neutral-900 border border-neutral-700 px-2 py-1 text-neutral-100">
          <option value="">All positions</option>
          {Object.keys(POS_GROUP)
            .filter((k) => tab !== "next" || k !== "DEF")
            .map((k) => (
              <option key={k} value={k}>
                {k === "DEF" ? "Defense" : k}
              </option>
            ))}
        </select>
        <button className="rounded-md bg-neutral-800 px-2.5 py-1 text-neutral-200 hover:bg-neutral-700">Filter</button>
        {(team || pos || q) && (
          <Link href={href({ team: null, pos: null, q: null })} className="text-neutral-500 hover:text-neutral-300">
            Clear
          </Link>
        )}
      </form>

      {tab === "next" ? <NextTable board={board} filter={matches} /> : <EventTable tab={tab} board={board} filter={matches} sort={sp.sort} href={href} />}

      <p className="text-[11px] text-neutral-600">Updated {new Date(board.updatedAt).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" })} ET.</p>
    </div>
  );
}

function NextTable({ board, filter }: { board: NonNullable<Awaited<ReturnType<typeof getScoringBoard>>>; filter: (p: { player: string; team: string; position: string }) => boolean }) {
  const rows = board.next.filter(filter).slice(0, 60);
  if (rows.length === 0) return <p className="text-sm text-neutral-500">No players match.</p>;
  const fair = (p: number) => {
    const a = p >= 0.5 ? -Math.round((p / (1 - p)) * 100) : Math.round(((1 - p) / p) * 100);
    return a > 0 ? `+${a}` : `${a}`;
  };
  return (
    <div className="overflow-x-auto rounded-md border border-neutral-800">
      <table className="w-full text-xs">
        <thead className="bg-neutral-900 text-neutral-400 text-left">
          <tr>
            <th className="px-2 py-1.5 font-medium">#</th>
            <th className="px-2 py-1.5 font-medium">Player</th>
            <th className="px-2 py-1.5 font-medium text-right">Anytime TD</th>
            <th className="px-2 py-1.5 font-medium text-right">Fair odds</th>
            <th className="px-2 py-1.5 font-medium text-right">2+ TDs</th>
            <th className="px-2 py-1.5 font-medium text-right">Carries/g</th>
            <th className="px-2 py-1.5 font-medium text-right">Targets/g</th>
            <th className="px-2 py-1.5 font-medium text-right">Team pts</th>
            <th className="px-2 py-1.5 font-medium text-right">Season TDs</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-800">
          {rows.map((p, i) => (
            <tr key={`${p.player}-${p.team}`} className="text-neutral-300">
              <td className="px-2 py-1.5 text-neutral-500">{i + 1}</td>
              <td className="px-2 py-1.5">
                <span className="text-neutral-100">{p.player}</span> <span className="text-neutral-500">{p.team} · {p.position}</span>
              </td>
              <td className="px-2 py-1.5 text-right">
                <span className={`font-semibold ${VERDICT_CLASS[verdictFor(p.chance).tone]}`}>{Math.round(p.chance * 100)}%</span>
                <span className={`block text-[10px] ${VERDICT_CLASS[verdictFor(p.chance).tone]}`}>{verdictFor(p.chance).label}</span>
              </td>
              <td className="px-2 py-1.5 text-right">{fair(p.chance)}</td>
              <td className="px-2 py-1.5 text-right">{Math.round(p.multi * 100)}%</td>
              <td className="px-2 py-1.5 text-right">{p.carries.toFixed(1)}</td>
              <td className="px-2 py-1.5 text-right">{p.targets.toFixed(1)}</td>
              <td className="px-2 py-1.5 text-right">{p.implied ?? "—"}</td>
              <td className="px-2 py-1.5 text-right">
                {p.seasonTds} <span className="text-neutral-600">in {p.games}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EventTable({
  tab,
  board,
  filter,
  sort,
  href,
}: {
  tab: Exclude<Tab, "next">;
  board: NonNullable<Awaited<ReturnType<typeof getScoringBoard>>>;
  filter: (p: { player: string; team: string; position: string }) => boolean;
  sort: string | undefined;
  href: (patch: Record<string, string | null>) => string;
}) {
  const cols = COLS[tab];
  const rows = board.players
    .filter(filter)
    .map((p) => ({ p, score: scoreFor(tab, p, sort) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.p.player.localeCompare(b.p.player))
    .slice(0, 100);
  if (rows.length === 0) return <p className="text-sm text-neutral-500">No players match.</p>;
  const keys = cols.map((c) => c.key);
  const short: Partial<Record<EventKey, string>> = {
    rushTd: "rush TD",
    recTd: "rec TD",
    returnTd: "return TD",
    defTd: "def TD",
    passTd: "pass TD",
    intThrown: "INT thrown",
    defInt: "INT",
    fumbles: "fum",
    fumblesLost: "lost",
    forced: "FF",
    recovered: "FR",
  };
  return (
    <div className="overflow-x-auto rounded-md border border-neutral-800">
      <table className="w-full text-xs">
        <thead className="bg-neutral-900 text-neutral-400 text-left">
          <tr>
            <th className="px-2 py-1.5 font-medium">Player</th>
            {tab === "tds" && <th className="px-2 py-1.5 font-medium text-right">Scored</th>}
            {cols.map((c) => (
              <th key={c.key} className="px-2 py-1.5 font-medium text-right">
                <Link href={href({ sort: c.key })} className={sort === c.key ? "text-sky-300" : "hover:text-neutral-200"}>
                  {c.label}
                </Link>
              </th>
            ))}
            <th className="px-2 py-1.5 font-medium">By week</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-800">
          {rows.map(({ p }) => (
            <tr key={p.id} className="text-neutral-300 align-top">
              <td className="px-2 py-1.5 whitespace-nowrap">
                <span className="text-neutral-100">{p.player}</span> <span className="text-neutral-500">{p.team} · {p.position}</span>
              </td>
              {tab === "tds" && (
                <td className="px-2 py-1.5 text-right font-semibold text-emerald-300">{p.totals.rushTd + p.totals.recTd + p.totals.returnTd + p.totals.defTd}</td>
              )}
              {cols.map((c) => (
                <td key={c.key} className={`px-2 py-1.5 text-right ${p.totals[c.key] ? "" : "text-neutral-600"}`}>
                  {p.totals[c.key]}
                </td>
              ))}
              <td className="px-2 py-1.5 text-[11px] text-neutral-400">
                {p.weeks
                  .filter((w) => keys.some((k) => w.e[k]))
                  .map((w) => (
                    <span key={w.w} className="mr-2 whitespace-nowrap">
                      <span className="text-neutral-500">W{w.w}</span>
                      {w.opp && <span className="text-neutral-600"> v {w.opp}</span>}{" "}
                      {keys
                        .filter((k) => w.e[k])
                        .map((k) => `${w.e[k]} ${short[k]}`)
                        .join(", ")}
                    </span>
                  ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
