import { NextRequest, NextResponse } from "next/server";
import { runFullSync } from "@/lib/sync";
import { runSportSync, runAllSportsSync } from "@/lib/sports/sync";
import type { SportKey } from "@/lib/sports/types";
import { getCurrentUser } from "@/lib/current-user";

const ALL_SPORTS: SportKey[] = ["nba", "wnba", "nhl", "mlb", "ncaaf", "ncaab"];

// NFL + all 6 other sports now run sequentially in one request when the
// Dashboard's "Sync now" button is clicked (sports=all) — comfortably
// longer than any single sport takes, but the combined run needs real
// headroom. 300s is both the default AND the hard ceiling on Vercel's
// Hobby plan (with Fluid compute, which is on by default) — set explicitly
// so it's never silently lower if that default ever changes.
export const maxDuration = 300;

function currentNflSeason(): number {
  const now = new Date();
  // NFL seasons are named for the year they start (a Jan/Feb game still
  // belongs to the prior year's season).
  return now.getMonth() >= 1 ? now.getFullYear() : now.getFullYear() - 1;
}

/**
 * This route handles its own auth rather than middleware's cookie check,
 * because two very different callers hit it: Vercel Cron (bearer token,
 * no cookie) and a logged-in user clicking "Sync now" on the dashboard
 * (session cookie, no bearer token, must be a legacy admin).
 */
async function isAuthorized(req: NextRequest): Promise<boolean> {
  const authHeader = req.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`) {
    return true;
  }
  // Manual syncs are legacy-admin only.
  const user = await getCurrentUser();
  return !!user?.isLegacyAdmin;
}

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const seasonParam = req.nextUrl.searchParams.get("season");
  const season = seasonParam ? Number(seasonParam) : currentNflSeason();

  // `sports` lets Vercel Cron (or a manual call) target the new
  // multi-sport pipeline — e.g. ?sports=nba or ?sports=nba,nhl, or
  // ?sports=all for every sport live so far — separately from NFL, so each
  // sport's own cron schedule/timeout budget can be tuned independently as
  // more of them come online. `nfl=false` skips the NFL run for a call
  // that's only meant to sync other sports. Omitting both params keeps the
  // original NFL-only behavior exactly as it was before this feature
  // existed.
  const sportsParam = req.nextUrl.searchParams.get("sports");
  const runNfl = req.nextUrl.searchParams.get("nfl") !== "false";
  const results: { stage: string; status: "ok" | "error" | "skipped"; detail: string }[] = [];

  if (runNfl) {
    results.push(...(await runFullSync(season)));
  }

  if (sportsParam === "all") {
    results.push(...(await runAllSportsSync(ALL_SPORTS)));
  } else if (sportsParam) {
    const requested = sportsParam
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s): s is SportKey => (ALL_SPORTS as string[]).includes(s));
    for (const sport of requested) {
      results.push(...(await runSportSync(sport)));
    }
  }

  const hadError = results.some((r) => r.status === "error");

  return NextResponse.json({ season, results }, { status: hadError ? 207 : 200 });
}

export const POST = GET;
