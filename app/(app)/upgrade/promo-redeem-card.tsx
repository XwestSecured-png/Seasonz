"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PromoRedeemCard({ activePromo }: { activePromo: { label: string; until: string } | null }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/promo/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "That code didn't work.");
      const plan = data.tier === "super_pro" ? "Super Pro" : "Pro";
      setSuccess(`You've got ${data.months} months of ${plan} free, through ${new Date(data.expiresAt).toLocaleDateString()}.`);
      setCode("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code didn't work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-md border border-neutral-800 p-4 space-y-2">
      <h2 className="text-sm font-semibold text-neutral-200">Have a promo code?</h2>
      {activePromo && (
        <p className="text-xs text-emerald-400">
          Free {activePromo.label} through {activePromo.until}.
        </p>
      )}
      <form onSubmit={submit} className="flex gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="e.g. SZN6-ABC234"
          autoCapitalize="characters"
          autoCorrect="off"
          className="w-full max-w-xs rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-sm uppercase"
        />
        <button
          type="submit"
          disabled={busy || !code.trim()}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          Redeem
        </button>
      </form>
      {success && <p className="text-xs text-emerald-400">{success}</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
