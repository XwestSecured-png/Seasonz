"use client";

import { useState } from "react";

/**
 * Starts a Stripe Checkout Session for `tier` and redirects the whole page
 * to its hosted URL — no Stripe.js needed for this flow (that's only
 * required for an embedded/custom payment form, see the stripe-best-
 * practices skill). The actual tier change happens later, asynchronously,
 * via app/api/stripe/webhook/route.ts once Stripe confirms the
 * subscription — this button only kicks off checkout.
 */
export function StripeCheckoutButton({ tier, label }: { tier: "pro" | "super_pro"; label: string }) {
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function startCheckout() {
    if (status === "loading") return;
    setStatus("loading");
    setError(null);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setError(data.error ?? "Couldn't start checkout");
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
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={startCheckout}
        disabled={status === "loading"}
        className="w-full rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
      >
        {status === "loading" ? "Redirecting…" : `Subscribe to ${label}`}
      </button>
      {status === "error" && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
