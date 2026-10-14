import { getResults, type Card, type SportResults } from "@/lib/results";
import { getWeightReport } from "@/lib/model-weights";
import { PageInfo } from "../page-info";

export const dynamic = "force-dynamic";

const f1 = (v: number | null, d = 1) => (v === null ? "—" : v.toFixed(d));

export default async function ResultsPage() {
  const [results, weights] = await Promise.all([getResults(), getWeightReport()]);
  const liveTotal = results.reduce((s, r) => s + r.live.n, 0);
  const liveCorrect = results.reduce((s, r) => s + r.live.correct, 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Results</h1>
        <p className="text-sm text-neutral-400 max-w-2xl">How the model has actually done, every sport, graded honestly.</p>
      </div>
      <PageInfo>
        <p>
          <strong>Live</strong> counts only games where the model&rsquo;s number was locked in before kickoff, so it can&rsquo;t be
          changed after the fact. That&rsquo;s the real track record. <strong>Rebuilt</strong> scores every final game from this and
          last season using only pre-game information; it&rsquo;s a bigger sample, but the model was tuned on those seasons, so it reads
          a little better than a true live record.
        </p>
        <p>
          <strong>Brier score</strong> measures how good the percentages are (lower is better; 0.25 is a coin flip).
          <strong> Calibration</strong> checks that when the model says 70%, those picks win about 70% of the time.
          <strong> Line moved our way</strong>: when the model disagreed with the opening line, did the line move toward it before
          kickoff? Sharp money moving the same way is the best early sign of a real edge.
        </p>
      </PageInfo>

      <div className="rounded-md border border-neutral-800 px-4 py-3">
        <div className="text-[11px] uppercase tracking-wide text-neutral-500">Live record, all sports</div>
        <div className="text-2xl font-semibold">
          {liveTotal ? `${liveCorrect}-${liveTotal - liveCorrect}` : "—"}{" "}
          {liveTotal > 0 && <span className="text-sm font-normal text-neutral-400">{((liveCorrect / liveTotal) * 100).toFixed(1)}% picked right</span>}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {results.map((r) => (
          <SportCard key={r.key} r={r} />
        ))}
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-neutral-200">How much we trust the model vs the line</h2>
        <p className="text-xs text-neutral-400 max-w-2xl">
          Each sport&rsquo;s final number blends the model with the betting line. The blend is re-tested on live graded games every
          week; a new weight is only used once a sport has 300+ live games and the change clearly helps.
        </p>
        <div className="overflow-x-auto rounded-md border border-neutral-800">
          <table className="w-full text-xs">
            <thead className="bg-neutral-900 text-neutral-400 text-left">
              <tr>
                <th className="px-2.5 py-1.5 font-medium">Sport</th>
                <th className="px-2.5 py-1.5 font-medium">Model share now</th>
                <th className="px-2.5 py-1.5 font-medium">Live games tested</th>
                <th className="px-2.5 py-1.5 font-medium">Best share on them</th>
                <th className="px-2.5 py-1.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {weights.map((w) => (
                <tr key={w.sport}>
                  <td className="px-2.5 py-1.5 text-neutral-200">{w.label}</td>
                  <td className="px-2.5 py-1.5">{Math.round(w.current * 100)}%</td>
                  <td className="px-2.5 py-1.5">{w.n}</td>
                  <td className="px-2.5 py-1.5">{w.best === null ? "—" : `${Math.round(w.best * 100)}%`}</td>
                  <td className="px-2.5 py-1.5 text-neutral-400">{w.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SportCard({ r }: { r: SportResults }) {
  return (
    <div className="rounded-md border border-neutral-800 p-3 space-y-2.5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-neutral-100">{r.label}</h2>
        <span className="text-[11px] text-neutral-500">
          {r.liveSince ? `Live since ${new Date(r.liveSince).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : "No live games graded yet"}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-neutral-500 text-left">
            <tr>
              <th className="py-1 pr-2 font-medium" />
              <th className="py-1 pr-2 font-medium">Live</th>
              <th className="py-1 pr-2 font-medium">Rebuilt</th>
            </tr>
          </thead>
          <tbody className="text-neutral-300">
            <Row label="Record" a={rec(r.live)} b={rec(r.rebuilt)} />
            <Row label="Picked right" a={r.live.pct === null ? "—" : `${f1(r.live.pct)}%`} b={r.rebuilt.pct === null ? "—" : `${f1(r.rebuilt.pct)}%`} />
            <Row label="Brier (lower better)" a={f1(r.live.brier, 3)} b={f1(r.rebuilt.brier, 3)} />
            <Row label="Model vs book favorite, same games" a={vsBook(r.live)} b={vsBook(r.rebuilt)} />
            <Row
              label="Line moved our way"
              a={r.live.clvGames ? `${r.live.clvToward} of ${r.live.clvGames} (${r.live.clvAvgPts! >= 0 ? "+" : ""}${f1(r.live.clvAvgPts)} pts)` : "—"}
              b={r.rebuilt.clvGames ? `${r.rebuilt.clvToward} of ${r.rebuilt.clvGames}` : "—"}
            />
          </tbody>
        </table>
      </div>
      {r.calibration.length > 0 && (
        <div>
          <div className="text-[11px] uppercase tracking-wide text-neutral-500 mb-1">Calibration (rebuilt)</div>
          <div className="space-y-1">
            {r.calibration.map((b) => (
              <div key={b.label} className="flex items-center gap-2 text-[11px]">
                <span className="w-16 text-neutral-400">{b.label}</span>
                <div className="relative h-2 flex-1 rounded bg-neutral-800">
                  <div className="absolute inset-y-0 left-0 rounded bg-sky-600/70" style={{ width: `${b.actual * 100}%` }} />
                  <div className="absolute inset-y-[-2px] w-0.5 bg-amber-300" style={{ left: `${b.predicted * 100}%` }} title="Predicted" />
                </div>
                <span className="w-28 text-right text-neutral-400">
                  {Math.round(b.predicted * 100)}% → {Math.round(b.actual * 100)}% <span className="text-neutral-600">({b.n})</span>
                </span>
              </div>
            ))}
          </div>
          <div className="text-[10px] text-neutral-600 mt-1">Bar = how often picks won; yellow tick = what the model said.</div>
        </div>
      )}
    </div>
  );
}

const rec = (c: Card) => (c.n ? `${c.correct}-${c.n - c.correct}` : "—");
const vsBook = (c: Card) => (c.bookN ? `${c.modelOnBookGames} vs ${c.bookCorrect} of ${c.bookN}` : "—");

function Row({ label, a, b }: { label: string; a: string; b: string }) {
  return (
    <tr className="border-t border-neutral-800/70">
      <td className="py-1 pr-2 text-neutral-400">{label}</td>
      <td className="py-1 pr-2">{a}</td>
      <td className="py-1 pr-2">{b}</td>
    </tr>
  );
}
