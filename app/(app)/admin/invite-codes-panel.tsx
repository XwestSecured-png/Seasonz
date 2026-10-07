"use client";

import { useCallback, useEffect, useState } from "react";

type Platform = "ios" | "android" | "desktop";

const PLATFORMS: Platform[] = ["ios", "android", "desktop"];
const LABELS: Record<Platform, string> = {
  ios: "iPhone / iPad",
  android: "Android",
  desktop: "Desktop / web",
};

interface CodeRow {
  id: number;
  code: string;
  platform: Platform;
  isActive: boolean;
  uses: number;
}

export interface ShownCode {
  code: string;
  uses: number;
}

async function call(method: string, body?: unknown, query = "") {
  const res = await fetch(`/api/admin/invite-codes${query}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

export function InviteCodesPanel({ shown }: { shown: Record<Platform, ShownCode | null> }) {
  const [rows, setRows] = useState<CodeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState<Record<Platform, string>>({ ios: "", android: "", desktop: "" });
  const [copied, setCopied] = useState<Platform | null>(null);
  const [showList, setShowList] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await call("GET");
      setRows(data.codes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load codes");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    call("GET")
      .then((data) => !cancelled && setRows(data.codes))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Failed to load codes"));
    return () => {
      cancelled = true;
    };
  }, []);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  async function copy(p: Platform, code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(p);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard blocked; the code is on screen anyway */
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        {PLATFORMS.map((p) => {
          const s = shown[p];
          const total = rows?.filter((r) => r.platform === p && r.isActive).length;
          return (
            <div key={p} className="rounded-md border border-neutral-800 bg-neutral-900/40 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-neutral-400">{LABELS[p]}</span>
                {total !== undefined && <span className="text-[10px] text-neutral-600">{total} active in rotation</span>}
              </div>
              {s ? (
                <button
                  type="button"
                  onClick={() => void copy(p, s.code)}
                  className="w-full rounded-md border border-emerald-900 bg-emerald-950/30 px-2 py-2 font-mono text-base tracking-wider text-emerald-300 hover:border-emerald-700"
                  title="Copy"
                >
                  {s.code}
                </button>
              ) : (
                <p className="text-xs text-neutral-500">No active codes yet. Generate some below.</p>
              )}
              <div className="text-[10px] text-neutral-600">
                {s ? (copied === p ? "Copied" : `Tap to copy · used ${s.uses}×`) : null}
              </div>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => call("POST", { platform: p, count: 5 }))}
                  className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:border-neutral-600 disabled:opacity-50"
                >
                  + Generate 5
                </button>
                <input
                  value={custom[p]}
                  onChange={(e) => setCustom({ ...custom, [p]: e.target.value })}
                  placeholder="or add your own"
                  className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs uppercase"
                />
                <button
                  type="button"
                  disabled={busy || !custom[p].trim()}
                  onClick={() =>
                    void run(async () => {
                      await call("POST", { platform: p, code: custom[p] });
                      setCustom({ ...custom, [p]: "" });
                    })
                  }
                  className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:border-neutral-600 disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-neutral-600">
        A different code from each platform&rsquo;s list shows every time this page loads. Any active code
        works at sign-up.
      </p>
      {error && <p className="text-xs text-red-400">{error}</p>}

      <button
        type="button"
        onClick={() => setShowList(!showList)}
        className="text-xs text-neutral-400 underline underline-offset-2 hover:text-neutral-200"
      >
        {showList ? "Hide full code list" : "Manage full code list"}
      </button>

      {showList && (
        <div className="overflow-x-auto rounded-md border border-neutral-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-900/60 text-xs text-neutral-500">
              <tr>
                <th className="px-3 py-2 font-medium">Code</th>
                <th className="px-3 py-2 font-medium">Platform</th>
                <th className="px-3 py-2 font-medium">Uses</th>
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows?.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-3 text-xs text-neutral-500">
                    No codes yet.
                  </td>
                </tr>
              )}
              {rows?.map((r) => (
                <tr key={r.id} className="border-t border-neutral-800/80">
                  <td className={`px-3 py-2 font-mono text-xs ${r.isActive ? "text-neutral-200" : "text-neutral-600 line-through"}`}>
                    {r.code}
                  </td>
                  <td className="px-3 py-2 text-xs text-neutral-400">{LABELS[r.platform] ?? r.platform}</td>
                  <td className="px-3 py-2 text-xs text-neutral-400">{r.uses}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2.5 text-xs">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void run(() => call("PATCH", { id: r.id, isActive: !r.isActive }))}
                        className="text-neutral-400 underline underline-offset-2 hover:text-neutral-200 disabled:opacity-40"
                      >
                        {r.isActive ? "Turn off" : "Turn on"}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm(`Delete ${r.code}?`)) void run(() => call("DELETE", undefined, `?id=${r.id}`));
                        }}
                        className="text-red-400 underline underline-offset-2 hover:text-red-300 disabled:opacity-40"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
