"use client";

import { useRouter } from "next/navigation";
import { TEAMS } from "@/lib/team-colors";

const COOKIE_NAME = "nfl_fav_team";

export function TeamPicker({ current }: { current: string | null }) {
  const router = useRouter();

  return (
    <select
      value={current ?? ""}
      onChange={(e) => {
        const code = e.target.value;
        if (code) {
          document.cookie = `${COOKIE_NAME}=${code}; path=/; max-age=31536000`;
        } else {
          document.cookie = `${COOKIE_NAME}=; path=/; max-age=0`;
        }
        router.refresh();
      }}
      className="bg-neutral-900/80 border border-neutral-700 text-neutral-200 text-sm rounded-md px-2 py-1.5 max-w-[11rem]"
      aria-label="Favorite team"
    >
      <option value="">Pick your team…</option>
      {TEAMS.map((t) => (
        <option key={t.code} value={t.code}>
          {t.name}
        </option>
      ))}
    </select>
  );
}
