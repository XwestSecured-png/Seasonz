"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import Link from "next/link";
import { SPORTSBOOKS, serializeSportsbookPrefs, type Sportsbook, type SportsbookCategory } from "@/lib/sportsbooks";
import { formatBetSlipText, type BetSlipLeg } from "@/lib/bet-slip-text";
import { PlatformIcon } from "./platform-icon";
import { PlatformSelect } from "./platform-select";
import { LockIcon } from "./icons";

// Same cookie name as lib/sportsbook-pref.ts's SPORTSBOOK_PREF_COOKIE —
// duplicated as a local literal (same pattern as sportsbook-picker.tsx)
// since this is a client component and that file pulls in next/headers.
const COOKIE_NAME = "nfl_sportsbook_pref";

type Status = "idle" | "working" | "done";

/**
 * "Push" a bet slip: copies a plain-text summary of the legs to the
 * clipboard once, then opens EVERY platform in the user's saved "my
 * platforms" list (see app/(app)/sportsbook-picker.tsx) in its own tab, so
 * the user can paste and place it wherever they actually end up betting —
 * one tap covers however many platforms they use. No sportsbook exposes a
 * way to pre-fill someone else's bet slip from outside its own app — this
 * is the closest real equivalent, same spirit as the music launcher's
 * one-tap hand-off.
 *
 * When no platforms are saved yet (`sportsbookPrefs` is empty), this never
 * silently assumes DraftKings — it shows a "Push to…" single picker instead,
 * and picking a platform there both pushes this slip and seeds the saved
 * list with that one platform, so every push after this one opens it (and
 * anything else later added via the header/menu picker) automatically.
 *
 * When `alreadyTracked` is false (an Auto Parlay or a TD Picks combo that
 * isn't saved anywhere yet) and there are 2+ legs, pushing also saves it as
 * a pending parlay through the same endpoint the parlay builder's "Save
 * parlay" button uses, so it shows up in Your Parlays to grade later — one
 * tap covers both asks. Saving is silently skipped if the user isn't signed
 * in; the push itself (copy + open books) still happens either way. Once a
 * given set of legs has saved successfully, this button remembers that
 * exact combination (`lastSavedSignature`) so pushing again with no change
 * — the same auto parlay, the same TD Picks combo — only copies/opens and
 * never saves a duplicate row. Editing the legs first (e.g. swapping a TD
 * Picks leg) changes the signature, so that still saves as a new pick.
 *
 * `allowedCategories` (see lib/entitlements.ts's allowedPlatformCategories)
 * tier-gates which platform categories this push can actually go to — any
 * saved platform outside it (e.g. a Pro user who added Polymarket got
 * downgraded to Free) is simply skipped on push rather than silently
 * removed from the saved list, with a note naming what got skipped and why.
 */
export function PushBetButton({
  legs,
  title,
  week,
  sportsbookPrefs,
  allowedCategories,
  alreadyTracked = false,
  compact = false,
}: {
  legs: BetSlipLeg[];
  title?: string;
  week?: number;
  sportsbookPrefs: Sportsbook[];
  allowedCategories?: SportsbookCategory[];
  alreadyTracked?: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [lastSavedSignature, setLastSavedSignature] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const signature = JSON.stringify(legs.map((l) => [l.label, l.priceAmerican]));

  const isAllowed = (book: Sportsbook) =>
    !allowedCategories || allowedCategories.includes(SPORTSBOOKS[book].category);
  const pushable = sportsbookPrefs.filter(isAllowed);
  const locked = sportsbookPrefs.filter((b) => !isAllowed(b));

  // The exact text Push copies to the clipboard — shown verbatim in the
  // preview card below so "Preview slip" is never out of sync with what
  // actually gets pasted.
  const slipText = useMemo(() => formatBetSlipText(legs, title), [legs, title]);

  async function pushToAll(books: Sportsbook[]) {
    if (legs.length === 0 || status === "working" || books.length === 0) return;
    setStatus("working");

    // Fire the clipboard write and every new-tab open back to back, with no
    // await between any of them, all still inside this click/change handler.
    // Once an await happens first, iOS Safari (and some popup blockers) stop
    // treating the next call as user-initiated and silently block it — so
    // awaiting the clipboard write (or awaiting between tabs) before calling
    // window.open would make later tabs fail to open on exactly the
    // browsers this matters most for.
    const clipboardWrite = navigator.clipboard.writeText(slipText).catch(() => {
      // Clipboard access can be denied (permissions, non-HTTPS, older
      // browser) — the tabs still open either way, just without the copy.
    });
    for (const bookKey of books) {
      window.open(SPORTSBOOKS[bookKey].webUrl, "_blank", "noopener,noreferrer");
    }
    await clipboardWrite;

    if (!alreadyTracked && signature !== lastSavedSignature && legs.length >= 2) {
      try {
        const res = await fetch("/api/parlays", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, legs, week }),
        });
        if (res.ok) {
          setLastSavedSignature(signature);
          router.refresh();
        }
        // A non-ok response (401 signed-out, or a validation error) just
        // means the auto-save didn't happen — the push itself still did.
      } catch {
        // Network error — same as above, nothing to show the user for it.
      }
    }

    setStatus("done");
    window.setTimeout(() => setStatus("idle"), 2500);
  }

  // The one-tap path, once at least one platform is saved.
  function push() {
    void pushToAll(pushable);
  }

  // The first-time path: picking a platform here both pushes this slip and
  // seeds the saved list with it, via the same cookie SportsbookPicker
  // writes — router.refresh() picks that up so every push after this one
  // renders the one-tap button instead of this picker again.
  function choosePlatformAndPush(bookKey: Sportsbook) {
    document.cookie = `${COOKIE_NAME}=${serializeSportsbookPrefs([bookKey])}; path=/; max-age=31536000`;
    router.refresh();
    void pushToAll([bookKey]);
  }

  const disabled = status === "working" || legs.length === 0;
  const pushLabel =
    pushable.length === 1
      ? `Push to ${SPORTSBOOKS[pushable[0]].label}`
      : `Push to ${pushable.length} platforms`;

  return (
    <div className={compact ? "space-y-1.5" : "space-y-2"}>
      <div className="flex items-center gap-3 flex-wrap">
        {pushable.length > 0 ? (
          <button
            type="button"
            onClick={push}
            disabled={disabled}
            title={`Copy this slip and open ${pushable.map((b) => SPORTSBOOKS[b].label).join(", ")}`}
            className={
              compact
                ? "flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50 disabled:cursor-not-allowed"
                : "flex items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-900/80 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed"
            }
          >
            {status !== "working" && status !== "done" && (
              <span className="flex -space-x-1">
                {pushable.slice(0, 3).map((b) => (
                  <PlatformIcon key={b} book={b} size={compact ? 14 : 16} />
                ))}
              </span>
            )}
            {status === "working" ? "Pushing…" : status === "done" ? "Pushed ✓" : pushLabel}
          </button>
        ) : (
          <PlatformSelect
            value={null}
            placeholder={status === "working" ? "Pushing…" : status === "done" ? "Pushed ✓" : "Push to…"}
            ariaLabel="Push to…"
            disabled={disabled}
            compact={compact}
            allowedCategories={allowedCategories}
            onChange={(book) => {
              if (book) choosePlatformAndPush(book);
            }}
          />
        )}
        {legs.length > 0 && (
          <button
            type="button"
            onClick={() => setPreviewOpen((o) => !o)}
            className="text-xs text-neutral-500 hover:text-neutral-300 underline underline-offset-2 decoration-neutral-700"
          >
            {previewOpen ? "Hide slip" : "Preview slip"}
          </button>
        )}
      </div>
      {locked.length > 0 && (
        <p className="text-xs text-neutral-500">
          <LockIcon className="mr-1 inline h-3 w-3" />
          {locked.map((b) => SPORTSBOOKS[b].label).join(", ")} needs Pro — skipped on push.{" "}
          <Link href="/upgrade" className="text-blue-400 hover:text-blue-300 underline">
            Upgrade
          </Link>{" "}
          to include {locked.length === 1 ? "it" : "them"}.
        </p>
      )}
      {previewOpen && (
        <pre className="whitespace-pre-wrap rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-neutral-300 max-w-sm">
          {slipText}
        </pre>
      )}
    </div>
  );
}
