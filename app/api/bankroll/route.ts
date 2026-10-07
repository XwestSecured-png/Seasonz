import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth";

/** Sets the signed-in user's own bankroll (users.bankrollUsd) — used only to turn the Kelly-based suggested stake PERCENTAGE into a dollar amount (lib/stake-sizing.ts). Purely a display convenience; never affects grading. */
export async function POST(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const userId = verifySessionToken(token);
  if (userId === null) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const bankrollUsd =
    body?.bankrollUsd === null || body?.bankrollUsd === "" ? null : Number(body?.bankrollUsd);
  if (bankrollUsd !== null && (!Number.isFinite(bankrollUsd) || bankrollUsd < 0)) {
    return NextResponse.json({ error: "bankrollUsd must be a non-negative number" }, { status: 400 });
  }

  await db.update(users).set({ bankrollUsd }).where(eq(users.id, userId));
  return NextResponse.json({ ok: true });
}
