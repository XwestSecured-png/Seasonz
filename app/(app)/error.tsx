"use client";

import { useEffect } from "react";

/**
 * Catches any uncaught error thrown while rendering a page (or its data
 * fetching) under app/(app). Without this, Next.js falls back to a bare,
 * mostly-blank production error page with no indication of what broke —
 * which is exactly what made earlier crashes ("app didn't load") hard to
 * diagnose from a screenshot. This shows the actual error message on
 * screen instead, so a failure is reportable rather than just blank.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Also goes to Vercel's runtime logs (Project -> Deployments -> latest
    // -> Runtime Logs), which is the most reliable place to see this.
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg space-y-4 py-16 text-center">
      <h1 className="text-lg font-semibold text-neutral-200">Something broke on this page</h1>
      <p className="text-sm text-neutral-400">
        This is the actual error, so it can be fixed instead of guessed at. Screenshot this and
        send it over.
      </p>
      <pre className="whitespace-pre-wrap rounded-md border border-red-900 bg-red-950/30 px-4 py-3 text-left text-xs text-red-300">
        {error.message || "Unknown error"}
        {error.digest ? `\n\nDigest: ${error.digest}` : ""}
      </pre>
      <button
        type="button"
        onClick={() => reset()}
        className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:border-neutral-600"
      >
        Try again
      </button>
    </div>
  );
}
