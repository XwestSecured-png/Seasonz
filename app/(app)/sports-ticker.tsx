import { buildTickerItems } from "@/lib/sports/ticker";

/**
 * A continuously scrolling strip of recent scores (with each winner's
 * current record) and injury updates, across NFL and every synced sport.
 * Fixed to the bottom of the screen — above the mobile tab bar (BottomNav,
 * which is ~3.5rem tall plus the home-indicator safe area) so it never
 * covers those tabs, and flush with the bottom edge on desktop/tablet where
 * there's no tab bar. Text drops a size on phones (text-[10px]) so a long
 * line of items doesn't force the strip taller than its single-line height.
 * Pure CSS animation (see the .ticker-track keyframes in app/globals.css)
 * so it keeps scrolling with no client-side JS; the track's content is
 * rendered twice back to back so the loop has no visible seam.
 */
export async function SportsTicker() {
  const items = await buildTickerItems();
  if (items.length === 0) return null;

  return (
    <div
      className="fixed inset-x-0 z-40 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] sm:bottom-0 border-t border-neutral-800/80 bg-neutral-950/90 backdrop-blur supports-[backdrop-filter]:bg-neutral-950/70 overflow-hidden"
      aria-label="Scores and injury ticker"
    >
      <div
        // Speed scales with how much text there is (~5s per item, never under
        // 120s for a full loop) so a long ticker doesn't race past.
        style={{ animationDuration: `${Math.max(120, items.length * 5)}s` }}
        className="ticker-track flex items-center gap-6 sm:gap-10 whitespace-nowrap py-1 sm:py-1.5 text-[10px] sm:text-xs text-neutral-300">
        {[0, 1].map((rep) => (
          <div key={rep} className="flex items-center gap-6 sm:gap-10 shrink-0" aria-hidden={rep === 1}>
            {items.map((item) => (
              <span
                key={`${rep}-${item.id}`}
                className={item.kind === "injury" ? "text-amber-400/90" : undefined}
              >
                {item.text}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
