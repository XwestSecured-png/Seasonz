"use client";

import { useCallback, useEffect, useState } from "react";

const MONTHS = [3, 6, 9, 12] as const;

interface PromoRow {
  id: number;
  code: string;
  months: number;
  tier: string;
  maxRedemptions: number;
  redemptions: number;
  status: string;
  note: string | null;
  createdById: number;
  adminApprovedById: number | null;
  createdBy: string | null;
  adminApprovedBy: string | null;
  legacyApprovedBy: string | null;
  closedBy: string | null;
  createdAt: string;
}

const STATUS: Record<string, { label: string; cls: string }> = {
  pending_admin: { label: "Needs admin approval", cls: "bg-amber-950 text-amber-300" },
  pending_legacy: { label: "Needs legacy approval", cls: "bg-sky-950 text-sky-300" },
  active: { label: "Active", cls: "bg-emerald-950 text-emerald-300" },
  rejected: { label: "Rejected", cls: "bg-neutral-800 text-neutral-400" },
  revoked: { label: "Revoked", cls: "bg-red-950 text-red-300" },
};

async function call(method: string, body?: unknown) {
  const res = await fetch("/api/admin/promo-codes", {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

export function PromoCodesPanel({ currentAdminId, currentIsLegacy }: { currentAdminId: number; currentIsLegacy: boolean }) {
  const [rows, setRows] = useState<PromoRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [months, setMonths] = useState<number>(3);
  const [tier, setTier] = useState("pro");
  const [maxRedemptions, setMaxRedemptions] = useState(1);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    const data = await call("GET");
    setRows(data.codes);
  }, []);

  useEffect(() => {
    let cancelled = false;
    call("GET")
      .then((data) => !cancelled && setRows(data.codes))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Failed to load promo codes"));
    return () => {
      cancelled = true;
    };
  }, []);

  async function run(action: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await load();
      if (done) setNotice(done);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  // What this admin can do on a given row (the server enforces the same rules).
  function canApprove(r: PromoRow) {
    if (r.status === "pending_admin") return r.createdById !== currentAdminId;
    if (r.status === "pending_legacy") return currentIsLegacy && r.adminApprovedById !== currentAdminId;
    return false;
  }

  return (
    <div className="space-y-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            async () => {
              const data = await call("POST", { months, tier, maxRedemptions, note });
              setNote("");
              return data;
            },
            "Code created. It needs an admin approval, then a legacy admin approval, before anyone can use it."
          );
        }}
        className="flex flex-wrap items-end gap-2 rounded-md border border-neutral-800 bg-neutral-900/40 p-3"
      >
        <label className="text-xs text-neutral-400">
          Free time
          <div className="mt-1 flex gap-1">
            {MONTHS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMonths(m)}
                className={`rounded-md border px-2.5 py-1 text-xs ${
                  months === m ? "border-emerald-600 bg-emerald-950/40 text-emerald-300" : "border-neutral-700 text-neutral-300"
                }`}
              >
                {m} mo
              </button>
            ))}
          </div>
        </label>
        <label className="text-xs text-neutral-400">
          Plan
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value)}
            className="mt-1 block rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs"
          >
            <option value="pro">Pro</option>
            <option value="super_pro">Super Pro</option>
          </select>
        </label>
        <label className="text-xs text-neutral-400">
          Uses
          <input
            type="number"
            min={1}
            max={10000}
            value={maxRedemptions}
            onChange={(e) => setMaxRedemptions(Number(e.target.value) || 1)}
            className="mt-1 block w-20 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs"
          />
        </label>
        <label className="min-w-40 flex-1 text-xs text-neutral-400">
          Note (optional)
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Who it's for"
            className="mt-1 block w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          Create code
        </button>
      </form>

      <p className="text-xs text-neutral-600">
        Every code needs two approvals: first an admin who didn&rsquo;t create it, then a legacy admin who
        didn&rsquo;t give the first approval.
      </p>
      {notice && <p className="text-xs text-emerald-400">{notice}</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="overflow-x-auto rounded-md border border-neutral-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-neutral-900/60 text-xs text-neutral-500">
            <tr>
              <th className="px-3 py-2 font-medium">Code</th>
              <th className="px-3 py-2 font-medium">Grants</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Approvals</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows === null && (
              <tr>
                <td colSpan={5} className="px-3 py-3 text-xs text-neutral-500">
                  Loading…
                </td>
              </tr>
            )}
            {rows?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-3 text-xs text-neutral-500">
                  No promo codes yet.
                </td>
              </tr>
            )}
            {rows?.map((r) => {
              const st = STATUS[r.status] ?? { label: r.status, cls: "bg-neutral-800 text-neutral-400" };
              const pending = r.status === "pending_admin" || r.status === "pending_legacy";
              return (
                <tr key={r.id} className="border-t border-neutral-800/80 align-top">
                  <td className="px-3 py-2">
                    <div className="font-mono text-xs text-neutral-200">{r.code}</div>
                    {r.note && <div className="text-[10px] text-neutral-500">{r.note}</div>}
                  </td>
                  <td className="px-3 py-2 text-xs text-neutral-400">
                    {r.months} months {r.tier === "super_pro" ? "Super Pro" : "Pro"}
                    <div className="text-[10px] text-neutral-600">
                      {r.redemptions}/{r.maxRedemptions} used
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] ${st.cls}`}>{st.label}</span>
                  </td>
                  <td className="px-3 py-2 text-[11px] leading-5 text-neutral-500">
                    <div>Created: {r.createdBy}</div>
                    <div>Admin: {r.adminApprovedBy ?? "—"}</div>
                    <div>Legacy: {r.legacyApprovedBy ?? "—"}</div>
                    {r.closedBy && <div>Closed: {r.closedBy}</div>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col items-start gap-1 text-xs">
                      {pending && (
                        <button
                          type="button"
                          disabled={busy || !canApprove(r)}
                          title={canApprove(r) ? "" : "Waiting on someone else"}
                          onClick={() => void run(() => call("PATCH", { id: r.id, action: "approve" }))}
                          className="text-emerald-400 underline underline-offset-2 hover:text-emerald-300 disabled:opacity-40 disabled:no-underline"
                        >
                          {r.status === "pending_legacy" ? "Final approve" : "Approve"}
                        </button>
                      )}
                      {pending && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void run(() => call("PATCH", { id: r.id, action: "reject" }))}
                          className="text-neutral-400 underline underline-offset-2 hover:text-neutral-200 disabled:opacity-40"
                        >
                          Reject
                        </button>
                      )}
                      {r.status === "active" && currentIsLegacy && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            if (window.confirm(`Revoke ${r.code}? Nobody else will be able to use it.`)) {
                              void run(() => call("PATCH", { id: r.id, action: "revoke" }));
                            }
                          }}
                          className="text-red-400 underline underline-offset-2 hover:text-red-300 disabled:opacity-40"
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
