import { redirectTo } from "@/lib/redirect";
import { NextRequest } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { COOKIE_NAME, createSessionToken, verifyPasswordHash } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const username = String(form.get("username") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "/");

  const fail = (code = "1") => {
    return redirectTo(`/login?error=${encodeURIComponent(code)}&next=${encodeURIComponent(next)}`);
  };

  if (!username || !password) return fail();

  // If the database can't be reached, say so on the login page instead of a blank error page.
  let user: typeof users.$inferSelect | undefined;
  try {
    [user] = await db.select().from(users).where(eq(users.username, username));
  } catch (e) {
    console.error("login: database unavailable", e instanceof Error ? e.message : e);
    return fail("server");
  }
  if (!user || !verifyPasswordHash(password, user.passwordHash) || user.isBanned) {
    return fail();
  }

  const res = redirectTo(next || "/");
  res.cookies.set(COOKIE_NAME, createSessionToken(user.id), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
  return res;
}
