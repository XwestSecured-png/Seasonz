"use client";

import { useState } from "react";

/**
 * Redirects to Stripe's hosted Billing Portal, where the signed-in user can
 * cancel, switch plans, or update their payment method themselves — the
 * self-service surface Stripe recommends over a hand-built cancel flow
 * (see app/api/stripe/portal/route.ts). Whatever they do there flows back
 * through the webhook handler like any other Stripe-initiated change.
 */
export function ManageBillingButton() {
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function openPortal() {
    if (status === "loading") return;
    setStatus("loading");
    setError(null);
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setError(data.error ?? "Couldn't open billing portal");
        setStatus("error");
        return;
      }
      window.location.href = data.url;
    } catch {
      setError("Network error — try again");
      setStatus("error");
    }
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={openPortal}
        disabled={status === "loading"}
        className="text-xs text-neutral-400 underline underline-offset-2 hover:text-neutral-200 disabled:opacity-50"
      >
        {status === "loading" ? "Opening…" : "Manage billing / cancel"}
      </button>
      {status === "error" && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
