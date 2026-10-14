"use client";

import { useEffect, useState } from "react";

type Prefs = { locks: boolean; edges: boolean; moves: boolean };
const LABELS: Record<keyof Prefs, string> = {
  locks: "Picks about to lock",
  edges: "Today's best edges",
  moves: "Big line moves on my picks and bets",
};

function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Turn push alerts on or off for this device, and pick which ones. */
export function AlertsToggle() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [sub, setSub] = useState<PushSubscription | null>(null);
  const [prefs, setPrefs] = useState<Prefs>({ locks: true, edges: true, moves: true });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      await Promise.resolve();
      const ok = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      setSupported(ok);
      if (!ok) return;
      const reg = await navigator.serviceWorker.register("/sw.js");
      const s = await reg.pushManager.getSubscription();
      if (!s) return;
      const r = await fetch(`/api/push?endpoint=${encodeURIComponent(s.endpoint)}`);
      const body = await r.json().catch(() => null);
      if (body?.subscribed) {
        setSub(s);
        setPrefs(body.prefs);
      }
    })().catch(() => {});
  }, []);

  const save = async (s: PushSubscription, p: Prefs) => {
    const r = await fetch("/api/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: s.toJSON(), prefs: p }),
    });
    if (!r.ok) throw new Error("Couldn't save");
  };

  const turnOn = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setMsg("Notifications are blocked for this site. Allow them in your browser settings, then try again.");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const { publicKey } = await (await fetch("/api/push")).json();
      const s = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
      await save(s, prefs);
      setSub(s);
      setMsg("Alerts are on for this device.");
    } catch {
      setMsg("Couldn't turn alerts on. On iPhone, add Seasonz to your Home Screen first.");
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    if (!sub) return;
    setBusy(true);
    try {
      await fetch("/api/push", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
      await sub.unsubscribe().catch(() => {});
      setSub(null);
      setMsg("Alerts are off for this device.");
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (k: keyof Prefs) => {
    const next = { ...prefs, [k]: !prefs[k] };
    setPrefs(next);
    if (sub) await save(sub, next).catch(() => setMsg("Couldn't save that change."));
  };

  if (supported === null) return null;
  return (
    <details className="rounded-md border border-neutral-800 px-3 py-2 text-xs">
      <summary className="cursor-pointer select-none text-neutral-300">
        🔔 Alerts {sub ? <span className="text-emerald-400">on</span> : <span className="text-neutral-500">off</span>}
      </summary>
      <div className="mt-2 space-y-2">
        {!supported ? (
          <p className="text-neutral-500">This browser can&rsquo;t receive alerts. On iPhone, add Seasonz to your Home Screen and open it from there.</p>
        ) : (
          <>
            <div className="space-y-1">
              {(Object.keys(LABELS) as (keyof Prefs)[]).map((k) => (
                <label key={k} className="flex items-center gap-2 text-neutral-300">
                  <input type="checkbox" checked={prefs[k]} onChange={() => toggle(k)} className="accent-sky-500" />
                  {LABELS[k]}
                </label>
              ))}
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={sub ? turnOff : turnOn}
              className={`rounded-md px-2.5 py-1 font-medium disabled:opacity-50 ${sub ? "border border-neutral-700 text-neutral-300 hover:bg-neutral-800" : "bg-sky-600 text-white hover:bg-sky-500"}`}
            >
              {busy ? "…" : sub ? "Turn off on this device" : "Turn on alerts"}
            </button>
          </>
        )}
        {msg && <p className="text-neutral-400">{msg}</p>}
      </div>
    </details>
  );
}
