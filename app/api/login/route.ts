import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { COOKIE_NAME, createSessionToken, verifyPasswordHash } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const username = String(form.get("username") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "/");

  const fail = () => {
    const url = new URL("/login", req.url);
    url.searchParams.set("error", "1");
    url.searchParams.set("next", next);
    return NextResponse.redirect(url, { status: 303 });
  };

  if (!username || !password) return fail();

  const [user] = await db.select().from(users).where(eq(users.username, username));
  if (!user || !verifyPasswordHash(password, user.passwordHash) || user.isBanned) {
    return fail();
  }

  const res = NextResponse.redirect(new URL(next || "/", req.url), {
    status: 303,
  });
  res.cookies.set(COOKIE_NAME, createSessionToken(user.id), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
  return res;
}
