import Link from "next/link";
import { getCurrentUser } from "@/lib/current-user";
import { hasUnseenUpdate, releasesFor, type ChangeKind } from "@/lib/changelog";
import { MarkUpdateSeen } from "../update-banner";

export const dynamic = "force-dynamic";
export const metadata = { title: "What's new · Seasonz" };

const KIND: Record<ChangeKind, { label: string; cls: string }> = {
  new: { label: "New", cls: "bg-emerald-950 text-emerald-300" },
  improved: { label: "Improved", cls: "bg-sky-950 text-sky-300" },
  fixed: { label: "Fixed", cls: "bg-amber-950 text-amber-300" },
};

function formatDate(d: string) {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export default async function WhatsNewPage() {
  const user = await getCurrentUser();
  const releases = releasesFor(user?.isAdmin ?? false);
  const unseen = !!user && hasUnseenUpdate(user.lastSeenUpdate);

  return (
    <div className="space-y-8">
      <MarkUpdateSeen unseen={unseen} />
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">What&rsquo;s new</h1>
        <p className="max-w-2xl text-sm text-neutral-400">
          Every Seasonz update, what changed, and what it means for you.
        </p>
      </div>

      {releases.map((r, i) => (
        <article key={r.version} className="space-y-3">
          <header className="space-y-1">
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className="text-base font-semibold text-neutral-100">{r.title}</h2>
              <span className="font-mono text-xs text-neutral-500">v{r.version}</span>
              <span className="text-xs text-neutral-500">· {formatDate(r.date)}</span>
              {i === 0 && (
                <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold text-white">Latest</span>
              )}
            </div>
            <p className="max-w-2xl text-sm text-neutral-400">{r.summary}</p>
          </header>
          <ul className="space-y-2">
            {r.changes.map((c) => (
              <li key={c.title} className="rounded-md border border-neutral-800 bg-neutral-900/40 p-3">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${KIND[c.kind].cls}`}>
                    {KIND[c.kind].label}
                  </span>
                  {c.audience === "admin" && (
                    <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-400">Admins only</span>
                  )}
                  <h3 className="text-sm font-medium text-neutral-100">{c.title}</h3>
                </div>
                <p className="text-sm text-neutral-300">
                  <span className="font-medium text-neutral-400">What changed: </span>
                  {c.whatChanged}
                </p>
                <p className="mt-1 text-sm text-neutral-300">
                  <span className="font-medium text-emerald-400">What it means: </span>
                  {c.whatItMeans}
                </p>
                {c.href && (
                  <Link prefetch={false} href={c.href} className="mt-1.5 inline-block text-xs text-emerald-400 underline underline-offset-2 hover:text-emerald-300">
                    Take me there →
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  );
}
