"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

async function markSeen() {
  await fetch("/api/whats-new/seen", { method: "POST" }).catch(() => {});
}

/** Shown when there's a release the user hasn't seen yet. Dismissing (or opening What's new) hides it until the next release. */
export function UpdateBanner({ version, title }: { version: string; title: string }) {
  const [hidden, setHidden] = useState(false);
  const pathname = usePathname();
  if (hidden || pathname === "/whats-new") return null;
  return (
    <div className="mb-4 flex items-center gap-3 rounded-md border border-emerald-800 bg-emerald-950/40 px-3 py-2 text-sm">
      <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
        New
      </span>
      <span className="flex-1 text-neutral-200">
        Seasonz {version}: {title}.{" "}
        <Link
          href="/whats-new"
          onClick={() => void markSeen()}
          className="font-medium text-emerald-300 underline underline-offset-2 hover:text-emerald-200"
        >
          See what changed
        </Link>
      </span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => {
          setHidden(true);
          void markSeen();
        }}
        className="text-neutral-500 hover:text-neutral-200"
      >
        ✕
      </button>
    </div>
  );
}

/** Marks the newest release seen once the What's new page is opened. */
export function MarkUpdateSeen({ unseen }: { unseen: boolean }) {
  useEffect(() => {
    if (unseen) void markSeen();
  }, [unseen]);
  return null;
}
