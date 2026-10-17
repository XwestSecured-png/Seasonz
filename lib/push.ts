// Web push: VAPID keys, subscriptions, and deduped sends.
//
// The VAPID key pair is generated on the server the first time it's needed
// and kept in app_settings ("vapid"); only the public half ever leaves the
// server. alert_log (user, kind, ref) makes every alert send at most once.
import webpush from "web-push";
import { db } from "@/db";
import { alertLog, appSettings, pushSubscriptions } from "@/db/schema";
import { eq, inArray, sql } from "drizzle-orm";

export type AlertKind = "locks" | "edges" | "moves" | "returns" | "admin";
export interface PushPrefs {
  locks: boolean;
  edges: boolean;
  moves: boolean;
  /** Key players back from injury in sports you follow. */
  returns: boolean;
}
export const DEFAULT_PREFS: PushPrefs = { locks: true, edges: true, moves: true, returns: true };

interface Vapid {
  publicKey: string;
  privateKey: string;
}
let vapid: Vapid | null = null;

export async function getVapid(): Promise<Vapid> {
  if (vapid) return vapid;
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, "vapid"));
  if (row) {
    vapid = row.value as Vapid;
    return vapid;
  }
  const keys = webpush.generateVAPIDKeys();
  // Two first calls racing: keep whichever row landed first.
  await db.insert(appSettings).values({ key: "vapid", value: keys }).onConflictDoNothing();
  const [saved] = await db.select().from(appSettings).where(eq(appSettings.key, "vapid"));
  vapid = saved.value as Vapid;
  return vapid;
}

export async function getVapidPublicKey(): Promise<string> {
  return (await getVapid()).publicKey;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

/**
 * Sends one alert to every device a user has subscribed, once per
 * (user, kind, ref). Returns true if it was new (and sent).
 */
export async function sendAlert(userId: number, kind: AlertKind, ref: string, payload: PushPayload): Promise<boolean> {
  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  const wanted = subs.filter((s) => kind === "admin" || ((s.prefs ?? DEFAULT_PREFS) as PushPrefs)[kind] !== false);
  if (wanted.length === 0) return false;
  const inserted = await db
    .insert(alertLog)
    .values({ userId, kind, ref })
    .onConflictDoNothing()
    .returning({ id: alertLog.id });
  if (inserted.length === 0) return false;
  const v = await getVapid();
  const dead: number[] = [];
  let ok = 0;
  await Promise.all(
    wanted.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          { vapidDetails: { subject: "https://seasonz-silk.vercel.app", publicKey: v.publicKey, privateKey: v.privateKey }, TTL: 3600 }
        );
        ok++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) dead.push(s.id);
      }
    })
  );
  if (dead.length) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, dead));
  // Nothing delivered: free the dedupe slot so the next run can retry.
  if (ok === 0) await db.delete(alertLog).where(sql`${alertLog.userId} = ${userId} and ${alertLog.kind} = ${kind} and ${alertLog.ref} = ${ref}`);
  return ok > 0;
}
