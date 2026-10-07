"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";

const CATEGORIES = ["Bug", "Idea", "Question", "Other"] as const;

export function FeedbackWidget({ username }: { username: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("Idea");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function submit() {
    if (!message.trim()) return;
    setSubmitting(true);
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, message, page: pathname }),
      });
      setDone(true);
      setMessage("");
      setTimeout(() => {
        setOpen(false);
        setDone(false);
      }, 1500);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      // Bottom offset leaves room for the fixed sports ticker (z-40, just
      // under this widget's z-50) plus the mobile tab bar below that — see
      // app/(app)/sports-ticker.tsx and bottom-nav.tsx for those heights.
      className="fixed right-4 z-50 bottom-[calc(6.5rem+env(safe-area-inset-bottom))] sm:bottom-12"
    >
      {open ? (
        <div className="w-80 rounded-lg border border-neutral-800 bg-neutral-900 shadow-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-neutral-200">Send feedback</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-neutral-500 hover:text-neutral-300 text-sm"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
          {done ? (
            <p className="text-sm text-emerald-400">
              Thanks, {username} — got it.
            </p>
          ) : (
            <>
              <div className="flex gap-1 flex-wrap">
                {CATEGORIES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(c)}
                    className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                      category === c
                        ? "bg-blue-600 text-white"
                        : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={
                  category === "Bug"
                    ? "What happened, and what did you expect instead?"
                    : "What's on your mind?"
                }
                rows={4}
                className="w-full rounded-md bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-600 resize-none"
              />
              <p className="text-xs text-neutral-500">
                Sent as {username}, from this page ({pathname}).
              </p>
              <button
                type="button"
                onClick={submit}
                disabled={submitting || !message.trim()}
                className="w-full rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors px-3 py-2 text-sm text-white font-medium"
              >
                {submitting ? "Sending…" : "Send"}
              </button>
            </>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-full bg-blue-600 hover:bg-blue-500 transition-colors text-white text-sm font-medium px-4 py-2.5 shadow-lg"
        >
          Feedback
        </button>
      )}
    </div>
  );
}
