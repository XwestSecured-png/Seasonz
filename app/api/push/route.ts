import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { pushSubscriptions } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { DEFAULT_PREFS, getVapidPublicKey, type PushPrefs } from "@/lib/push";

function cleanPrefs(v: unknown): PushPrefs {
  const p = (v ?? {}) as Partial<PushPrefs>;
  return { locks: p.locks !== false, edges: p.edges !== false, moves: p.moves !== false };
}

/** Public key for the browser's subscribe call, plus this device's state. */
export async function GET(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(COOKIE_NAME)?.value);
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const endpoint = req.nextUrl.searchParams.get("endpoint");
  let prefs: PushPrefs | null = null;
  if (endpoint) {
    const [row] = await db
      .select()
      .from(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
    prefs = row ? cleanPrefs(row.prefs) : null;
  }
  return NextResponse.json({ publicKey: await getVapidPublicKey(), subscribed: prefs !== null, prefs: prefs ?? DEFAULT_PREFS });
}

/** Saves (or updates) this device's subscription and alert choices. */
export async function POST(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(COOKIE_NAME)?.value);
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const sub = body?.subscription;
  const endpoint = typeof sub?.endpoint === "string" ? sub.endpoint : "";
  const p256dh = typeof sub?.keys?.p256dh === "string" ? sub.keys.p256dh : "";
  const auth = typeof sub?.keys?.auth === "string" ? sub.keys.auth : "";
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !p256dh || !auth || p256dh.length > 200 || auth.length > 100) {
    return NextResponse.json({ error: "invalid subscription" }, { status: 400 });
  }
  const prefs = cleanPrefs(body?.prefs);
  await db
    .insert(pushSubscriptions)
    .values({ userId, endpoint, p256dh, auth, prefs })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId, p256dh, auth, prefs } });
  return NextResponse.json({ ok: true, prefs });
}

/** Turns alerts off on this device. */
export async function DELETE(req: NextRequest) {
  const userId = verifySessionToken(req.cookies.get(COOKIE_NAME)?.value);
  if (userId === null) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : "";
  if (!endpoint) return NextResponse.json({ error: "endpoint is required" }, { status: 400 });
  await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
  return NextResponse.json({ ok: true });
}
