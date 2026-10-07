"use client";

import { useState } from "react";

const STATUS_COPY: Record<string, { label: string; tone: string }> = {
  unverified: { label: "Not verified", tone: "text-neutral-500" },
  pending: { label: "Verification in progress", tone: "text-amber-400" },
  verified: { label: "Verified", tone: "text-emerald-400" },
  failed: { label: "Verification needs another attempt", tone: "text-red-400" },
};

/**
 * Starts a Stripe Identity verification session and redirects to Stripe's
 * hosted document-capture flow. The result comes back asynchronously via
 * the identity.verification_session.* webhook (see
 * app/api/stripe/webhook/route.ts) — `initialStatus` is whatever was true
 * as of page load, so a user who just finished verifying may still see
 * "in progress" until the webhook lands and they reload.
 */
export function IdentityVerifyCard({ initialStatus }: { initialStatus: string }) {
  const status = initialStatus;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = STATUS_COPY[status] ?? STATUS_COPY.unverified;

  async function startVerification() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/identity", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setError(data.error ?? "Couldn't start verification");
        setLoading(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setError("Network error — try again");
      setLoading(false);
    }
  }

  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900/40 p-4 space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-300">Identity verification</h2>
        <span className={`text-xs ${copy.tone}`}>{copy.label}</span>
      </div>
      <p className="text-xs text-neutral-500">
        Handled by Stripe Identity — document capture and a selfie match, hosted entirely by
        Stripe. Nothing you submit there passes through this app.
      </p>
      {status !== "verified" && (
        <button
          type="button"
          onClick={startVerification}
          disabled={loading}
          className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-200 hover:border-neutral-600 disabled:opacity-50"
        >
          {loading ? "Redirecting…" : status === "failed" ? "Try again" : "Verify identity"}
        </button>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
