import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/current-user";
import { LATEST_RELEASE } from "@/lib/changelog";

/** POST — marks the newest release as seen for the signed-in user, which hides the "What's new" banner until the next release. */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  await db.update(users).set({ lastSeenUpdate: LATEST_RELEASE.version }).where(eq(users.id, user.id));
  return NextResponse.json({ ok: true, version: LATEST_RELEASE.version });
}
