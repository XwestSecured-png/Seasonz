import { db } from "@/db";
import { feedback } from "@/db/schema";
import { desc } from "drizzle-orm";
import { StatusToggle } from "./status-toggle";
import { PageInfo } from "../page-info";
import { SectionNote } from "../section-note";

export const dynamic = "force-dynamic";

const CATEGORY_COLOR: Record<string, string> = {
  Bug: "bg-rose-950 text-rose-300",
  Idea: "bg-sky-950 text-sky-300",
  Question: "bg-violet-950 text-violet-300",
  Other: "bg-neutral-800 text-neutral-300",
};

export default async function FeedbackPage() {
  const rows = await db.select().from(feedback).orderBy(desc(feedback.createdAt));
  const newCount = rows.filter((r) => r.status === "new").length;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div>
          <h1 className="text-lg font-semibold">Feedback</h1>
          <p className="text-sm text-neutral-400 max-w-2xl">
            Everything submitted through the &ldquo;Feedback&rdquo; button on any page, newest
            first. {newCount > 0 ? `${newCount} not yet reviewed.` : "All caught up."}
          </p>
        </div>
        <PageInfo>
          <p>
            Click the blue &ldquo;Feedback&rdquo; button on any page to leave a note — it&rsquo;s
            tagged with your name, the page you were on, and a category (Bug, Idea, Question,
            or Other). Everyone&rsquo;s feedback shows up here, in one place. Click the colored
            status pill on any item to mark it reviewed, or back to new.
          </p>
        </PageInfo>
      </div>

      <SectionNote>Newest items first. Everyone in the group can see this list.</SectionNote>
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-500">No feedback submitted yet.</p>
      ) : (
        <div className="rounded-md border border-neutral-800 divide-y divide-neutral-800">
          {rows.map((r) => (
            <div key={r.id} className="px-4 py-3 space-y-1.5">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      CATEGORY_COLOR[r.category] ?? CATEGORY_COLOR.Other
                    }`}
                  >
                    {r.category}
                  </span>
                  <span className="text-sm font-medium text-neutral-200">
                    {r.username ?? "Someone"}
                  </span>
                  {r.page && (
                    <span className="text-xs text-neutral-500 font-mono">{r.page}</span>
                  )}
                  <span className="text-xs text-neutral-500">
                    {r.createdAt.toLocaleString()}
                  </span>
                </div>
                <StatusToggle id={r.id} status={r.status} />
              </div>
              <p className="text-sm text-neutral-300 whitespace-pre-wrap">{r.message}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
