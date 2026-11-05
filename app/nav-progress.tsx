"use client";

// Loading bar (1.39.0): shows the instant a link, tab or form is tapped, so
// a slow page never looks frozen. A thin fire-colored bar creeps along the
// top while the next page loads; after a moment a "Loading…" pill appears
// too. It finishes when the new page arrives (the address changes).
//
// It also reports how long each page took (sent to /api/client-log as
// "nav") so the slowest pages can be found and sped up.
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const PILL_AFTER_MS = 700;
/** Only ever called from event handlers and effects, never while rendering. */
const nowMs = () => performance.now();
const GIVE_UP_MS = 45_000;

function report(path: string, ms: number) {
  try {
    const body = JSON.stringify({ kind: "nav", path, ms: Math.round(ms) });
    if (navigator.sendBeacon) navigator.sendBeacon("/api/client-log", new Blob([body], { type: "text/plain" }));
  } catch {
    // diagnostics only
  }
}

export function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [progress, setProgress] = useState(0); // 0 = hidden, 0-100 while loading
  const [pill, setPill] = useState(false);
  const started = useRef<{ at: number; to: string } | null>(null);
  const timers = useRef<number[]>([]);

  const clear = () => {
    for (const t of timers.current) {
      window.clearTimeout(t);
      window.clearInterval(t);
    }
    timers.current = [];
  };

  const start = (to: string) => {
    clear();
    started.current = { at: nowMs(), to };
    setProgress(8);
    setPill(false);
    // Creep toward 90%: fast at first, slower as it goes.
    const tick = window.setInterval(() => setProgress((p) => (p >= 90 ? p : p + (90 - p) * 0.08)), 200);
    const pillT = window.setTimeout(() => setPill(true), PILL_AFTER_MS);
    const giveUp = window.setTimeout(() => finish(false), GIVE_UP_MS);
    timers.current.push(tick, pillT, giveUp);
  };

  const finish = (arrived: boolean) => {
    clear();
    if (arrived && started.current) report(started.current.to, nowMs() - started.current.at);
    started.current = null;
    setPill(false);
    setProgress((p) => (p > 0 ? 100 : 0));
    timers.current.push(window.setTimeout(() => setProgress(0), 300));
  };

  // A new page arrived: complete the bar.
  useEffect(() => {
    if (started.current) finish(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, search]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      let url: URL;
      try {
        url = new URL(href, location.href);
      } catch {
        return;
      }
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      start(url.pathname);
    };
    const onSubmit = (e: SubmitEvent) => {
      const f = e.target as HTMLFormElement | null;
      if (!f || e.defaultPrevented) return;
      start(new URL(f.action || location.href, location.href).pathname);
    };
    const onPop = () => start(location.pathname);
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit);
    window.addEventListener("popstate", onPop);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit);
      window.removeEventListener("popstate", onPop);
      clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (progress === 0) return null;
  return (
    <>
      <div
        role="progressbar"
        aria-label="Loading page"
        aria-valuenow={Math.round(progress)}
        className="fixed left-0 top-0 z-[100] h-[3px] bg-gradient-to-r from-red-600 via-orange-500 to-amber-300 shadow-[0_0_8px_rgba(255,120,0,0.8)] transition-[width,opacity] duration-200 ease-out"
        style={{ width: `${progress}%`, opacity: progress >= 100 ? 0 : 1 }}
      />
      {pill && (
        <div
          aria-live="polite"
          className="fixed left-1/2 top-3 z-[100] -translate-x-1/2 rounded-full border border-orange-500/40 bg-neutral-950/90 px-3 py-1 text-xs text-orange-200 shadow-lg backdrop-blur-sm flex items-center gap-2"
        >
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-orange-400 border-t-transparent" />
          Loading…
        </div>
      )}
    </>
  );
}
