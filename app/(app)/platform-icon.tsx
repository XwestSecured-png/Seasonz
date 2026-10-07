"use client";

import { useState } from "react";
import { SPORTSBOOKS, getPlatformIconUrl, type Sportsbook } from "@/lib/sportsbooks";

/**
 * A betting platform's own site icon — fetched live from its domain, never
 * drawn or stored by this app (see getPlatformIconUrl's comment). Falls
 * back to the platform's first initial in a plain badge if the icon fails
 * to load (offline, blocked tracker/ad-blocker rule, etc.) so the picker
 * never shows a broken-image glyph.
 */
export function PlatformIcon({ book, size = 16 }: { book: Sportsbook; size?: number }) {
  const [failed, setFailed] = useState(false);
  const label = SPORTSBOOKS[book].label;

  if (failed) {
    return (
      <span
        aria-hidden
        style={{ width: size, height: size, fontSize: Math.max(8, size * 0.55) }}
        className="inline-flex shrink-0 items-center justify-center rounded-full bg-neutral-800 font-semibold text-neutral-400"
      >
        {label.charAt(0)}
      </span>
    );
  }

  return (
    // A tiny live favicon fetched by URL, not a local/optimizable asset —
    // next/image's optimizer isn't needed (or applicable) for this.
    <img
      src={getPlatformIconUrl(book)}
      alt=""
      aria-hidden
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className="shrink-0 rounded-full bg-white/10"
      style={{ width: size, height: size }}
    />
  );
}
