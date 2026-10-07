"use client";

import { useRouter } from "next/navigation";
import { serializeSportsbookPrefs, type Sportsbook, type SportsbookCategory } from "@/lib/sportsbooks";
import { PlatformMultiSelect } from "./platform-select";

// Same cookie name as lib/sportsbook-pref.ts's SPORTSBOOK_PREF_COOKIE —
// duplicated as a local literal (same pattern as team-picker.tsx's
// COOKIE_NAME) since that file also pulls in next/headers, which can't go
// into a client bundle.
const COOKIE_NAME = "nfl_sportsbook_pref";

/**
 * "My platforms" — the set of betting platforms PushBetButton pushes every
 * bet slip to at once (sportsbooks, prediction markets, Underdog — see
 * lib/sportsbooks.ts), saved as a comma-separated cookie. Unlike the old
 * single-preference version, this is a checklist: add or remove any number
 * of platforms here and every future push opens all of them. `allowedCategories`
 * (see lib/entitlements.ts's allowedPlatformCategories) tier-gates which
 * categories are actually selectable, same as PushBetButton's own gating.
 */
export function SportsbookPicker({
  current,
  allowedCategories,
}: {
  current: Sportsbook[];
  allowedCategories?: SportsbookCategory[];
}) {
  const router = useRouter();

  return (
    <PlatformMultiSelect
      value={current}
      placeholder="Your platforms…"
      ariaLabel="Your betting platforms"
      allowedCategories={allowedCategories}
      onChange={(books) => {
        if (books.length > 0) {
          document.cookie = `${COOKIE_NAME}=${serializeSportsbookPrefs(books)}; path=/; max-age=31536000`;
        } else {
          document.cookie = `${COOKIE_NAME}=; path=/; max-age=0`;
        }
        router.refresh();
      }}
    />
  );
}
