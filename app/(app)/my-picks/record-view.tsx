"use client";

import { useMemo } from "react";
import type { MyPick } from "@/lib/my-picks";

// Your historical record against the model, built from every graded pick
// (preseason excluded). For game picks the model's side is the number it
// showed before the game started, so "you vs model" is graded on the same
// games. Prop picks have a record of their own (the model doesn't make a
// side on every prop a user picks).

interface Line {
  w: number;
  l: number;
}
const pct = (x: Line) => (x.w + x.l ? (x.w / (x.w + x.l)) * 100 : null);
const rec = (x: Line) => `${x.w}-${x.l}`;
const fmtPct = (v: number | null) => (v === null ? "—" : `${v.toFixed(0)}%`);

function monthKey(iso: string) {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" }).slice(0, 7);
}
function monthLabel(key: string) {
  return new Date(`${key}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

export function RecordView({ picks }: { picks: MyPick[] }) {
  const r = useMemo(() => {
    const graded = picks.filter((p) => !p.preseason && (p.status === "won" || p.status === "lost"));
    const games = graded.filter((p) => p.kind === "Game" && p.model);
    const props = graded.filter((p) => p.kind === "Prop");
    const won = (p: MyPick) => p.status === "won";
    const modelWon = (p: MyPick) => (p.model!.agrees ? won(p) : !won(p));
    const tally = (list: MyPick[], f: (p: MyPick) => boolean): Line => ({ w: list.filter(f).length, l: list.filter((p) => !f(p)).length });

    const you = tally(games, won);
    const model = tally(games, modelWon);
    const agree = games.filter((p) => p.model!.agrees);
    const disagree = games.filter((p) => !p.model!.agrees);
    const youBeat = disagree.filter(won).length; // you right, model wrong

    // By sport
    const sports = new Map<string, MyPick[]>();
    for (const p of games) sports.set(p.sportLabel, [...(sports.get(p.sportLabel) ?? []), p]);
    const bySport = [...sports.entries()]
      .map(([label, list]) => ({ label, n: list.length, you: tally(list, won), model: tally(list, modelWon) }))
      .sort((a, b) => b.n - a.n);

    // By month (oldest first)
    const months = new Map<string, MyPick[]>();
    for (const p of games) if (p.kickoffAt) months.set(monthKey(p.kickoffAt), [...(months.get(monthKey(p.kickoffAt)) ?? []), p]);
    const byMonth = [...months.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, list]) => ({ label: monthLabel(key), n: list.length, you: tally(list, won), model: tally(list, modelWon) }));

    // How confident the model was
    const buckets = [
      { label: "Toss-up (50–59%)", lo: 0.5, hi: 0.6 },
      { label: "Lean (60–69%)", lo: 0.6, hi: 0.7 },
      { label: "Strong (70%+)", lo: 0.7, hi: 1.01 },
    ].map((b) => {
      const list = games.filter((p) => p.model!.pct >= b.lo && p.model!.pct < b.hi);
      const dis = list.filter((p) => !p.model!.agrees);
      return { ...b, n: list.length, you: tally(list, won), model: tally(list, modelWon), disagreeN: dis.length, disagreeYou: tally(dis, won) };
    });

    // Streaks (all graded picks, games and props, by start time)
    const chrono = [...graded].sort((a, b) => (a.kickoffAt ?? "").localeCompare(b.kickoffAt ?? ""));
    let best = 0;
    let run = 0;
    for (const p of chrono) {
      run = won(p) ? run + 1 : 0;
      best = Math.max(best, run);
    }
    let current = 0;
    const lastWon = chrono.length ? won(chrono[chrono.length - 1]) : null;
    for (let i = chrono.length - 1; i >= 0 && won(chrono[i]) === lastWon; i--) current++;

    return {
      games: games.length,
      you,
      model,
      agree: { n: agree.length, rec: tally(agree, won) },
      disagree: { n: disagree.length, you: tally(disagree, won), youBeat, modelBeat: disagree.length - youBeat },
      props: tally(props, won),
      bySport,
      byMonth,
      buckets,
      streak: { current, lastWon, best },
    };
  }, [picks]);

  if (r.games === 0 && r.props.w + r.props.l === 0) {
    return <p className="text-sm text-neutral-500">Your record starts once your first picks are graded. It keeps every pick, every season.</p>;
  }

  const youPct = pct(r.you);
  const modelPct = pct(r.model);
  const edge = youPct !== null && modelPct !== null ? youPct - modelPct : null;

  return (
    <div className="space-y-5">
      {r.games > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-neutral-200">You vs the model</h2>
          <div className="grid grid-cols-2 gap-2">
            <Box label="You" value={rec(r.you)} sub={fmtPct(youPct)} accent="text-emerald-300" />
            <Box label="Model, same games" value={rec(r.model)} sub={fmtPct(modelPct)} accent="text-sky-300" />
          </div>
          <Bar label="You" v={youPct} color="bg-emerald-500" />
          <Bar label="Model" v={modelPct} color="bg-sky-500" />
          <p className="text-xs text-neutral-400">
            {edge === null
              ? ""
              : Math.abs(edge) < 1
                ? `Dead even with the model over ${r.games} graded game pick${r.games === 1 ? "" : "s"}.`
                : edge > 0
                  ? `You're ${edge.toFixed(0)} points ahead of the model over ${r.games} graded game picks.`
                  : `The model is ${(-edge).toFixed(0)} points ahead of you over ${r.games} graded game picks.`}
            {r.games < 30 && " Small sample: give it 30+ picks before reading much into it."}
          </p>
        </section>
      )}

      {r.games > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-neutral-200">Agree vs disagree</h2>
          <div className="grid grid-cols-2 gap-2">
            <Box label={`Agreed with model (${r.agree.n})`} value={rec(r.agree.rec)} sub={fmtPct(pct(r.agree.rec))} />
            <Box label={`Went against it (${r.disagree.n})`} value={rec(r.disagree.you)} sub={fmtPct(pct(r.disagree.you))} />
          </div>
          {r.disagree.n > 0 && (
            <p className="text-xs text-neutral-400">
              When you went against the model, you were right {r.disagree.youBeat} time{r.disagree.youBeat === 1 ? "" : "s"} and the model was
              right {r.disagree.modelBeat}.
            </p>
          )}
        </section>
      )}

      {r.games > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-neutral-200">By how confident the model was</h2>
          <Table
            head={["Model confidence", "Games", "You", "Model", "You when disagreeing"]}
            rows={r.buckets
              .filter((b) => b.n > 0)
              .map((b) => [
                b.label,
                String(b.n),
                `${rec(b.you)} (${fmtPct(pct(b.you))})`,
                `${rec(b.model)} (${fmtPct(pct(b.model))})`,
                b.disagreeN ? `${rec(b.disagreeYou)} (${fmtPct(pct(b.disagreeYou))})` : "—",
              ])}
          />
        </section>
      )}

      {r.bySport.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-neutral-200">By sport</h2>
          <Table
            head={["Sport", "Games", "You", "Model"]}
            rows={r.bySport.map((s) => [s.label, String(s.n), `${rec(s.you)} (${fmtPct(pct(s.you))})`, `${rec(s.model)} (${fmtPct(pct(s.model))})`])}
          />
        </section>
      )}

      {r.byMonth.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-neutral-200">Month by month</h2>
          <Table
            head={["Month", "Games", "You", "Model"]}
            rows={r.byMonth.map((m) => [m.label, String(m.n), `${rec(m.you)} (${fmtPct(pct(m.you))})`, `${rec(m.model)} (${fmtPct(pct(m.model))})`])}
          />
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-neutral-200">Streaks and props</h2>
        <div className="grid grid-cols-3 gap-2">
          <Box
            label="Current streak"
            value={r.streak.lastWon === null ? "—" : `${r.streak.lastWon ? "W" : "L"}${r.streak.current}`}
            accent={r.streak.lastWon ? "text-emerald-300" : r.streak.lastWon === false ? "text-red-300" : undefined}
          />
          <Box label="Best win streak" value={r.streak.best ? `W${r.streak.best}` : "—"} />
          <Box label="Prop picks" value={r.props.w + r.props.l ? rec(r.props) : "—"} sub={fmtPct(pct(r.props))} />
        </div>
      </section>

      <p className="text-xs text-neutral-500">
        Every graded pick counts, all seasons, with preseason left out. The model&rsquo;s side is the number it showed before each game
        started, so it can&rsquo;t change after the fact.
      </p>
    </div>
  );
}

function Box({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-md border border-neutral-800 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</div>
      <div className={`text-base font-semibold ${accent ?? "text-neutral-100"}`}>
        {value} {sub && <span className="text-xs font-normal text-neutral-400">{sub}</span>}
      </div>
    </div>
  );
}

function Bar({ label, v, color }: { label: string; v: number | null; color: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-12 text-neutral-400">{label}</span>
      <div className="h-2 flex-1 rounded bg-neutral-800 overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${v ?? 0}%` }} />
      </div>
      <span className="w-10 text-right text-neutral-300">{fmtPct(v)}</span>
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-neutral-800">
      <table className="w-full text-xs">
        <thead className="bg-neutral-900 text-neutral-400 text-left">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-2.5 py-1.5 font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-800">
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((c, j) => (
                <td key={j} className={`px-2.5 py-1.5 whitespace-nowrap ${j === 0 ? "text-neutral-200" : "text-neutral-300"}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
