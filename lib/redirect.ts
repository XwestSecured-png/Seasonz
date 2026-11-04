import { NextResponse } from "next/server";

/**
 * A redirect to a path on this site. The Location header is relative, so
 * the browser stays on whatever address it used: behind a host's proxy
 * (Render) the request's own URL is the internal one, e.g.
 * http://localhost:10000, and an absolute redirect built from it sends the
 * visitor to "localhost". Only same-site paths are allowed ("/x", never
 * "//other.site" or "https://...").
 */
export function redirectTo(path: string, status: 302 | 303 | 307 = 303): NextResponse {
  const safe = path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\") ? path : "/";
  return new NextResponse(null, { status, headers: { Location: safe } });
}

/**
 * The address visitors use for this site (https://seasonz.onrender.com),
 * from the proxy's forwarded headers; for links that must be absolute,
 * such as Stripe's return pages.
 */
export function siteOrigin(req: { headers: Headers; nextUrl: { origin: string } }): string {
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0].trim();
  const proto = (req.headers.get("x-forwarded-proto") ?? "https").split(",")[0].trim();
  if (host && !/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(host)) return `${proto}://${host}`;
  return req.nextUrl.origin;
}
