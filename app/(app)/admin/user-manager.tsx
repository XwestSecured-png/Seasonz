"use client";

import { useEffect, useState, useCallback } from "react";
import { TIER_ORDER, TIER_LABELS, type Tier } from "@/lib/tiers";

interface AdminUserRow {
  id: number;
  username: string;
  tier: string;
  tierUpdatedAt: string | null;
  subscriptionStatus: string | null;
  isAdmin: boolean;
  isLegacyAdmin: boolean;
  isBanned: boolean;
  promoTier: string | null;
  promoExpiresAt: string | null;
  signupPlatform: string | null;
  createdAt: string;
  stripeSubscriptionId: string | null;
  identityStatus: string;
}

async function patchUser(userId: number, patch: Record<string, unknown>) {
  const res = await fetch("/api/admin/users", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, ...patch }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

export function UserManager({
  currentAdminId,
  currentIsLegacy,
}: {
  currentAdminId: number;
  currentIsLegacy: boolean;
}) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<AdminUserRow[] | null>(null);
  const [legacy, setLegacy] = useState<{ count: number; max: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async (q: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/admin/users${q ? `?q=${encodeURIComponent(q)}` : ""}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load users");
      setRows(data.users);
      setLegacy({ count: data.legacyCount, max: data.legacyMax });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/users");
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error ?? "Failed to load users");
        setRows(data.users);
        setLegacy({ count: data.legacyCount, max: data.legacyMax });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load users");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function withRow(id: number, action: () => Promise<unknown>) {
    setBusyId(id);
    setError(null);
    try {
      await action();
      await load(query);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusyId(null);
    }
  }

  function changeTier(row: AdminUserRow, tier: Tier) {
    void withRow(row.id, () => patchUser(row.id, { tier }));
  }

  function toggleAdmin(row: AdminUserRow) {
    void withRow(row.id, () => patchUser(row.id, { isAdmin: !row.isAdmin }));
  }

  function toggleLegacy(row: AdminUserRow) {
    void withRow(row.id, () => patchUser(row.id, { isLegacyAdmin: !row.isLegacyAdmin }));
  }

  function toggleBanned(row: AdminUserRow) {
    void withRow(row.id, () => patchUser(row.id, { isBanned: !row.isBanned }));
  }

  function resetPassword(row: AdminUserRow) {
    const next = window.prompt(`New password for ${row.username} (min 8 characters):`);
    if (!next) return;
    void withRow(row.id, () => patchUser(row.id, { newPassword: next }));
  }

  async function deleteUser(row: AdminUserRow) {
    if (!window.confirm(`Permanently delete ${row.username}? This can't be undone.`)) return;
    setBusyId(row.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users?userId=${row.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Delete failed");
      await load(query);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void load(query);
        }}
        className="flex gap-2"
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by username…"
          className="w-full max-w-xs rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-sm"
        />
        <button
          type="submit"
          className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:border-neutral-600"
        >
          Search
        </button>
      </form>

      {legacy && (
        <p className="text-xs text-neutral-500">
          Legacy admin slots: <span className="text-neutral-300">{legacy.count} of {legacy.max}</span> used.
          Regular admins are unlimited. {currentIsLegacy ? "You're a legacy admin." : "Only legacy admins can appoint legacy admins."}
        </p>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="overflow-x-auto rounded-md border border-neutral-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-neutral-900/60 text-xs text-neutral-500">
            <tr>
              <th className="px-3 py-2 font-medium">User</th>
              <th className="px-3 py-2 font-medium">Tier</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Identity</th>
              <th className="px-3 py-2 font-medium">Admin</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows === null && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-neutral-500">
                  Loading…
                </td>
              </tr>
            )}
            {rows?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-neutral-500">
                  No users found.
                </td>
              </tr>
            )}
            {rows?.map((row) => {
              const busy = busyId === row.id;
              const isSelf = row.id === currentAdminId;
              // A regular admin can't touch a legacy admin's account (enforced server-side too).
              const locked = row.isLegacyAdmin && !currentIsLegacy;
              const promoActive = row.promoTier && row.promoExpiresAt && new Date(row.promoExpiresAt) > new Date();
              return (
                <tr key={row.id} className="border-t border-neutral-800/80">
                  <td className="px-3 py-2">
                    <div className="font-medium text-neutral-200">
                      {row.username}
                      {isSelf && <span className="ml-1.5 text-[10px] text-neutral-500">(you)</span>}
                    </div>
                    {row.isBanned && (
                      <span className="text-[10px] text-red-400">Banned</span>
                    )}
                    {row.signupPlatform && (
                      <span className="block text-[10px] text-neutral-500">Joined via {row.signupPlatform} code</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={row.tier}
                      disabled={busy || locked}
                      onChange={(e) => changeTier(row, e.target.value as Tier)}
                      className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs disabled:opacity-50"
                    >
                      {TIER_ORDER.map((t) => (
                        <option key={t} value={t}>
                          {TIER_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-xs text-neutral-400">
                    {row.subscriptionStatus ?? (row.stripeSubscriptionId ? "—" : "Comped / Free")}
                    {promoActive && (
                      <span className="block text-[10px] text-emerald-400">
                        Promo {TIER_LABELS[row.promoTier as Tier] ?? row.promoTier} until{" "}
                        {new Date(row.promoExpiresAt!).toLocaleDateString()}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-neutral-400">
                    {row.identityStatus === "verified" ? (
                      <span className="text-emerald-400">Verified</span>
                    ) : row.identityStatus === "failed" ? (
                      <span className="text-red-400">Failed</span>
                    ) : row.identityStatus === "pending" ? (
                      <span className="text-amber-400">Pending</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col items-start gap-1">
                      {row.isLegacyAdmin ? (
                        <span className="rounded-full bg-emerald-950 px-2 py-0.5 text-[10px] text-emerald-300">Legacy admin</span>
                      ) : row.isAdmin ? (
                        <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-300">Admin</span>
                      ) : null}
                      <button
                        type="button"
                        disabled={busy || isSelf || locked}
                        onClick={() => toggleAdmin(row)}
                        className="text-xs text-neutral-400 underline underline-offset-2 hover:text-neutral-200 disabled:opacity-40 disabled:no-underline"
                      >
                        {row.isAdmin ? "Remove admin" : "Make admin"}
                      </button>
                      {currentIsLegacy && (
                        <button
                          type="button"
                          disabled={
                            busy ||
                            row.isBanned ||
                            (!row.isLegacyAdmin && !!legacy && legacy.count >= legacy.max)
                          }
                          onClick={() => toggleLegacy(row)}
                          className="text-xs text-emerald-400 underline underline-offset-2 hover:text-emerald-300 disabled:opacity-40 disabled:no-underline"
                        >
                          {row.isLegacyAdmin ? "Remove legacy" : "Make legacy"}
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2.5 text-xs">
                      <button
                        type="button"
                        disabled={busy || locked}
                        onClick={() => resetPassword(row)}
                        className="text-neutral-400 underline underline-offset-2 hover:text-neutral-200 disabled:opacity-40"
                      >
                        Reset password
                      </button>
                      <button
                        type="button"
                        disabled={busy || isSelf || locked}
                        onClick={() => toggleBanned(row)}
                        className="text-amber-400 underline underline-offset-2 hover:text-amber-300 disabled:opacity-40 disabled:no-underline"
                      >
                        {row.isBanned ? "Unban" : "Ban"}
                      </button>
                      <button
                        type="button"
                        disabled={busy || isSelf || locked}
                        onClick={() => void deleteUser(row)}
                        className="text-red-400 underline underline-offset-2 hover:text-red-300 disabled:opacity-40 disabled:no-underline"
                      >
                        Delete
                      </button>
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
