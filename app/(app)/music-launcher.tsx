"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MusicIcon } from "./icons";
import type { MusicService } from "@/lib/music-pref";

// Same cookie name as lib/music-pref.ts's MUSIC_PREF_COOKIE — duplicated as
// a local literal (same pattern as team-picker.tsx's COOKIE_NAME) instead of
// importing it, since lib/music-pref.ts also pulls in next/headers, which
// can't go into a client bundle.
const MUSIC_PREF_COOKIE = "nfl_music_pref";

const SERVICES: Record<MusicService, { label: string; appUri: string; webUrl: string }> = {
  // These custom-scheme URIs are what a native app registers with the OS to
  // claim deep links — "spotify:" / "music://" hand off to the installed
  // app if there is one. There's no cross-platform way to ask "what's this
  // device's default music player" from a website, so the user picks the
  // service once here instead.
  spotify: { label: "Spotify", appUri: "spotify:", webUrl: "https://open.spotify.com" },
  apple: { label: "Apple Music", appUri: "music://", webUrl: "https://music.apple.com" },
};

/**
 * A one-tap "open my music" control: the user picks Spotify or Apple Music
 * once (saved in a cookie, same pattern as TeamPicker), then a single tap
 * hands off to that app via its deep link — falling back to the web player
 * if nothing claims the link (app not installed, or on desktop).
 *
 * This can't run automatically when the app opens: browsers only allow an
 * app-launching redirect like this from a real click, the same restriction
 * that blocks silent audio autoplay. A tap is the closest thing to it.
 */
export function MusicLauncher({ current }: { current: MusicService | null }) {
  const router = useRouter();
  const [pref, setPref] = useState<MusicService | null>(current);
  const [opening, setOpening] = useState(false);

  function choose(value: string) {
    const next = value === "spotify" || value === "apple" ? (value as MusicService) : null;
    setPref(next);
    if (next) {
      document.cookie = `${MUSIC_PREF_COOKIE}=${next}; path=/; max-age=31536000`;
    } else {
      document.cookie = `${MUSIC_PREF_COOKIE}=; path=/; max-age=0`;
    }
    router.refresh();
  }

  function open() {
    if (!pref || opening) return;
    setOpening(true);
    const { appUri, webUrl } = SERVICES[pref];

    // Deep-link-with-fallback: fire the app URI; if the tab is still here
    // and visible ~1.2s later, nothing claimed it (app not installed), so
    // fall back to the web player instead.
    let handedOff = false;
    const onVisibility = () => {
      if (document.hidden) handedOff = true;
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.location.href = appUri;
    window.setTimeout(() => {
      document.removeEventListener("visibilitychange", onVisibility);
      setOpening(false);
      if (!handedOff) window.open(webUrl, "_blank", "noopener,noreferrer");
    }, 1200);
  }

  return (
    <div className="flex items-center gap-1.5">
      <select
        value={pref ?? ""}
        onChange={(e) => choose(e.target.value)}
        className="bg-neutral-900/80 border border-neutral-700 text-neutral-200 text-sm rounded-md px-2 py-1.5"
        aria-label="Preferred music app"
      >
        <option value="">Music…</option>
        <option value="spotify">Spotify</option>
        <option value="apple">Apple Music</option>
      </select>
      {pref && (
        <button
          type="button"
          onClick={open}
          disabled={opening}
          className="flex items-center justify-center rounded-md border border-neutral-700 bg-neutral-900/80 p-1.5 text-neutral-200 hover:bg-neutral-800 disabled:opacity-50"
          aria-label={`Open ${SERVICES[pref].label}`}
          title={`Open ${SERVICES[pref].label}`}
        >
          <MusicIcon className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
