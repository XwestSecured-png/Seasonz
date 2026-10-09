import { cookies } from "next/headers";
import type { CSSProperties } from "react";
import Link from "next/link";
import { NavLinks } from "./nav-links";
import { TeamPicker } from "./team-picker";
import { MusicLauncher } from "./music-launcher";
import { SportsbookPicker } from "./sportsbook-picker";
import { BottomNav } from "./bottom-nav";
import { getTeam } from "@/lib/team-colors";
import { getCurrentUser } from "@/lib/current-user";
import type { MusicService } from "@/lib/music-pref";
import { parseSportsbookPrefs } from "@/lib/sportsbooks";
import { allowedPlatformCategories } from "@/lib/entitlements";
import { TIER_LABELS } from "@/lib/tiers";
import { FeedbackWidget } from "./feedback-widget";
import { ShieldStarIcon } from "./icons";
import { SportsTicker } from "./sports-ticker";
import { UpdateBanner } from "./update-banner";
import { SeasonzLogo } from "../seasonz-logo";
import { LATEST_RELEASE, hasUnseenUpdate } from "@/lib/changelog";

const FAV_TEAM_COOKIE = "nfl_fav_team";
// Same cookie name as lib/music-pref.ts's MUSIC_PREF_COOKIE — not imported
// because this layout only needs the raw cookie value, read the same way
// FAV_TEAM_COOKIE already is just above.
const MUSIC_PREF_COOKIE = "nfl_music_pref";
// Same cookie name as lib/sportsbook-pref.ts's SPORTSBOOK_PREF_COOKIE, same
// reason as MUSIC_PREF_COOKIE above.
const SPORTSBOOK_PREF_COOKIE = "nfl_sportsbook_pref";
const DEFAULT_ACCENT = "#2563eb";
const VALID_MUSIC_SERVICES: readonly MusicService[] = ["spotify", "apple"];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const favTeamCode = cookieStore.get(FAV_TEAM_COOKIE)?.value ?? null;
  const team = getTeam(favTeamCode);
  const accent = team?.primary ?? DEFAULT_ACCENT;
  const user = await getCurrentUser();
  const musicPrefRaw = cookieStore.get(MUSIC_PREF_COOKIE)?.value ?? "";
  const musicPref = (VALID_MUSIC_SERVICES as readonly string[]).includes(musicPrefRaw)
    ? (musicPrefRaw as MusicService)
    : null;
  const sportsbookPrefs = parseSportsbookPrefs(cookieStore.get(SPORTSBOOK_PREF_COOKIE)?.value ?? "");
  const tier = user?.tier ?? "free";
  const platformCategories = allowedPlatformCategories(tier);

  // Translucent, not opaque — the shared BackgroundField (app/layout.tsx)
  // sits behind this, so its stadium texture reads clearly through the app
  // shell while the dark base still keeps dense tables and text readable.
  const wrapperStyle: CSSProperties = {
    backgroundColor: "#09090b73",
    backgroundImage: team
      ? `radial-gradient(circle at 10% -10%, ${team.primary}3d, transparent 55%), ` +
        `radial-gradient(circle at 100% 0%, ${team.secondary}2e, transparent 50%), ` +
        `radial-gradient(circle at 50% 120%, ${team.primary}1f, transparent 60%)`
      : undefined,
    backgroundAttachment: "fixed",
    ["--team-accent" as string]: accent,
  };

  return (
    <div className="min-h-screen text-neutral-100" style={wrapperStyle}>
      <header className="sticky top-0 z-30 border-b border-neutral-800/80 bg-neutral-950/70 px-4 sm:px-6 py-3 flex items-center justify-between gap-4 flex-wrap backdrop-blur supports-[backdrop-filter]:bg-neutral-950/50">
        <div className="flex items-center gap-6 flex-wrap">
          <Link prefetch={false} href="/" aria-label="Seasonz home" className="whitespace-nowrap">
            <SeasonzLogo />
          </Link>
          {/* On mobile this nav is replaced by the fixed bottom tab bar
              below, which is the primary way around the app there. */}
          <div className="hidden sm:block">
            <NavLinks accent={accent} />
          </div>
        </div>
        {/* Team/account controls move into the bottom nav's "More" sheet on
            mobile so the header stays to just the title there. */}
        <div className="hidden sm:flex items-center gap-4">
          {user && (
            <span className="text-sm text-neutral-500">
              {user.username}
              <Link prefetch={false}
                href="/upgrade"
                className="ml-1.5 rounded-full border border-neutral-700 px-1.5 py-0.5 text-[10px] font-medium text-neutral-400 hover:border-neutral-600 hover:text-neutral-200"
              >
                {TIER_LABELS[tier]}
              </Link>
            </span>
          )}
          {user?.isAdmin && (
            <Link prefetch={false}
              href="/admin"
              className="flex items-center gap-1 text-sm text-neutral-400 hover:text-neutral-200"
            >
              <ShieldStarIcon className="h-4 w-4" />
              Admin
            </Link>
          )}
          <TeamPicker current={favTeamCode} />
          <MusicLauncher current={musicPref} />
          <SportsbookPicker current={sportsbookPrefs} allowedCategories={platformCategories} />
          <form action="/api/logout" method="POST">
            <button
              type="submit"
              className="text-sm text-neutral-400 hover:text-neutral-200"
            >
              Log out
            </button>
          </form>
        </div>
      </header>
      <main className="p-4 sm:p-6 pb-32 sm:pb-12 max-w-5xl mx-auto">
        {user && hasUnseenUpdate(user.lastSeenUpdate) && (
          <UpdateBanner version={LATEST_RELEASE.version} title={LATEST_RELEASE.title} />
        )}
        {children}
      </main>
      {user && <FeedbackWidget username={user.username} />}
      <SportsTicker />
      <BottomNav
        accent={accent}
        username={user?.username ?? null}
        favTeamCode={favTeamCode}
        musicPref={musicPref}
        sportsbookPrefs={sportsbookPrefs}
        tier={tier}
        isAdmin={user?.isAdmin ?? false}
      />
    </div>
  );
}
