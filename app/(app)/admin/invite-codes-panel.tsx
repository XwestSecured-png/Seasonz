"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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
  createdById: number | null;
  createdBy: string | null;
  createdAt: string;
}

export interface ShownCode {
  code: string;
  uses: number;
  fromOwnSheet: boolean;
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

function downloadCsv(rows: CodeRow[]) {
  const lines = [
    "submitted_by,platform,code,active,uses,added",
    ...rows.map((r) =>
      [r.createdBy ?? "", LABELS[r.platform] ?? r.platform, r.code, r.isActive ? "yes" : "no", r.uses, r.createdAt.slice(0, 10)].join(",")
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `seasonz-invite-codes-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function InviteCodesPanel({ shown }: { shown: Record<Platform, ShownCode | null> }) {
  const [rows, setRows] = useState<CodeRow[] | null>(null);
  const [canSeeAll, setCanSeeAll] = useState(false);
  const [me, setMe] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<Platform | null>(null);
  const [bulkPlatform, setBulkPlatform] = useState<Platform>("ios");
  const [bulkText, setBulkText] = useState("");
  const [openSheet, setOpenSheet] = useState<string | null>(null);

  const apply = (data: { codes: CodeRow[]; canSeeAll: boolean; me: number }) => {
    setRows(data.codes);
    setCanSeeAll(data.canSeeAll);
    setMe(data.me);
  };

  const load = useCallback(async () => {
    try {
      apply(await call("GET"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load codes");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    call("GET")
      .then((d) => !cancelled && apply(d))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Failed to load codes"));
    return () => {
      cancelled = true;
    };
  }, []);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = (await action()) as { added?: number; skipped?: number } | undefined;
      if (r && typeof r.added === "number") {
        setNotice(`Added ${r.added} code(s) to your sheet${r.skipped ? `, skipped ${r.skipped} duplicate(s)` : ""}.`);
      }
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

  // One "sheet" per submitting admin, yours first.
  const sheets = useMemo(() => {
    const m = new Map<string, { name: string; ownerId: number | null; codes: CodeRow[] }>();
    for (const r of rows ?? []) {
      const key = String(r.createdById ?? "none");
      if (!m.has(key)) m.set(key, { name: r.createdBy ?? "Unknown", ownerId: r.createdById, codes: [] });
      m.get(key)!.codes.push(r);
    }
    return Array.from(m.entries()).sort(([, a], [, b]) =>
      a.ownerId === me ? -1 : b.ownerId === me ? 1 : a.name.localeCompare(b.name)
    );
  }, [rows, me]);

  const myActive = (p: Platform) =>
    rows?.filter((r) => r.createdById === me && r.platform === p && r.isActive).length ?? 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {PLATFORMS.map((p) => {
          const s = shown[p];
          return (
            <div key={p} className="space-y-2 rounded-md border border-neutral-800 bg-neutral-900/40 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-neutral-400">{LABELS[p]}</span>
                {rows && <span className="text-[10px] text-neutral-600">{myActive(p)} on your sheet</span>}
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
                <p className="text-xs text-neutral-500">No active codes yet. Add some below.</p>
              )}
              <div className="text-[10px] text-neutral-600">
                {s
                  ? copied === p
                    ? "Copied"
                    : `Tap to copy · used ${s.uses}× · ${s.fromOwnSheet ? "from your sheet" : "from the shared list"}`
                  : null}
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => call("POST", { platform: p, count: 5 }))}
                className="rounded-md border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:border-neutral-600 disabled:opacity-50"
              >
                + Generate 5
              </button>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-neutral-600">
        Each admin has their own sheet of codes. Every time you open this page you get the next code from your
        sheet for each platform. Any active code works at sign-up.
      </p>

      <div className="space-y-2 rounded-md border border-neutral-800 bg-neutral-900/40 p-3">
        <div className="text-xs font-medium text-neutral-300">Add codes to your sheet</div>
        <div className="flex flex-wrap gap-1.5">
          {PLATFORMS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setBulkPlatform(p)}
              className={`rounded-md border px-2.5 py-1 text-xs ${
                bulkPlatform === p
                  ? "border-emerald-600 bg-emerald-950/40 text-emerald-300"
                  : "border-neutral-700 text-neutral-300"
              }`}
            >
              {LABELS[p]}
            </button>
          ))}
        </div>
        <textarea
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
          rows={4}
          placeholder={"Paste codes, one per line or separated by commas\nIOS-ABCD-2345\nIOS-EFGH-6789"}
          className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 font-mono text-xs uppercase"
        />
        <button
          type="button"
          disabled={busy || !bulkText.trim()}
          onClick={() =>
            void run(async () => {
              const r = await call("POST", { platform: bulkPlatform, codes: bulkText });
              setBulkText("");
              return r;
            })
          }
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          Add to {LABELS[bulkPlatform]}
        </button>
      </div>

      {notice && <p className="text-xs text-emerald-400">{notice}</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium text-neutral-300">{canSeeAll ? "All admin sheets" : "Your sheet"}</h3>
          {rows && rows.length > 0 && (
            <button
              type="button"
              onClick={() => downloadCsv(rows)}
              className="text-xs text-neutral-400 underline underline-offset-2 hover:text-neutral-200"
            >
              Download CSV
            </button>
          )}
        </div>
        {rows?.length === 0 && <p className="text-xs text-neutral-500">No codes yet.</p>}
        {sheets.map(([key, sheet]) => {
          const open = openSheet === key;
          const active = sheet.codes.filter((c) => c.isActive).length;
          const used = sheet.codes.reduce((n, c) => n + c.uses, 0);
          return (
            <div key={key} className="rounded-md border border-neutral-800">
              <button
                type="button"
                onClick={() => setOpenSheet(open ? null : key)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm"
              >
                <span className="font-medium text-neutral-200">
                  {sheet.name}
                  {sheet.ownerId === me && <span className="ml-1.5 text-[10px] text-neutral-500">(you)</span>}
                </span>
                <span className="text-xs text-neutral-500">
                  {active} active · {sheet.codes.length} total · {used} sign-ups {open ? "▴" : "▾"}
                </span>
              </button>
              {open && (
                <div className="overflow-x-auto border-t border-neutral-800">
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
                      {sheet.codes.map((r) => (
                        <tr key={r.id} className="border-t border-neutral-800/80">
                          <td
                            className={`px-3 py-2 font-mono text-xs ${
                              r.isActive ? "text-neutral-200" : "text-neutral-600 line-through"
                            }`}
                          >
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
                                  if (window.confirm(`Delete ${r.code}?`))
                                    void run(() => call("DELETE", undefined, `?id=${r.id}`));
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
        })}
      </div>
    </div>
  );
}
