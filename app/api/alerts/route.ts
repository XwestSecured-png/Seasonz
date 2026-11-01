import { NextRequest, NextResponse } from "next/server";
import { runMaintenance } from "@/lib/maintenance";

export const maxDuration = 120;

/** Alerts, health checks and the daily refit (lib/maintenance.ts). Cron secret only. */
export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await runMaintenance(new Date(), req.nextUrl.searchParams.get("force") === "1"));
}
