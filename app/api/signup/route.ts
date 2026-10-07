import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { COOKIE_NAME, checkInviteCode, createSessionToken, hashPassword } from "@/lib/auth";
import {
  findActiveInviteCode,
  platformFromUserAgent,
  recordInviteUse,
  strictPlatformMatching,
} from "@/lib/invite-codes";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const inviteCode = String(form.get("inviteCode") ?? "");
  const username = String(form.get("username") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const confirmPassword = String(form.get("confirmPassword") ?? "");

  const fail = (error: string) => {
    const url = new URL("/signup", req.url);
    url.searchParams.set("error", error);
    return NextResponse.redirect(url, { status: 303 });
  };

  // A platform invite code from the admin list (lib/invite-codes.ts), or the
  // optional APP_PASSWORD master code if one is set.
  const platform = platformFromUserAgent(req.headers.get("user-agent"));
  const listed = inviteCode.trim() ? await findActiveInviteCode(inviteCode) : null;
  if (listed) {
    if (strictPlatformMatching() && listed.platform !== platform) return fail("platform");
  } else if (!checkInviteCode(inviteCode)) {
    return fail("code");
  }
  if (username.length < 3 || password.length < 3) return fail("short");
  if (password !== confirmPassword) return fail("mismatch");

  const [existing] = await db.select().from(users).where(eq(users.username, username));
  if (existing) return fail("taken");

  const [user] = await db
    .insert(users)
    .values({
      username,
      passwordHash: hashPassword(password),
      signupPlatform: listed?.platform ?? null,
      signupInviteCodeId: listed?.id ?? null,
    })
    .returning();
  if (listed) await recordInviteUse(listed.id);

  const res = NextResponse.redirect(new URL("/", req.url), { status: 303 });
  res.cookies.set(COOKIE_NAME, createSessionToken(user.id), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
  return res;
}
