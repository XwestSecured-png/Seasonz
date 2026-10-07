import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth";

// Next.js 16 renamed the "middleware" file convention to "proxy" (same
// behavior, defaults to the Node.js runtime — which lib/auth.ts needs for
// its HMAC signing).
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Let the login page and its API route through unauthenticated. /api/sync
  // also handles its own auth (session cookie OR Vercel Cron's bearer
  // token), since Cron requests carry no cookie at all. /api/stripe/webhook
  // is called directly by Stripe (no session cookie ever) and verifies the
  // request itself via the stripe-signature header (see that route).
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/login") ||
    pathname.startsWith("/signup") ||
    pathname.startsWith("/api/signup") ||
    pathname.startsWith("/api/sync") ||
    pathname.startsWith("/api/stripe/webhook") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon")
  ) {
    return NextResponse.next();
  }

  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (verifySessionToken(token) === null) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Run on everything except static assets.
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|ico)$).*)"],
};
