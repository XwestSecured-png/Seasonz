"use client";

import { useEffect } from "react";

/** Same as app/(app)/error.tsx but covers routes outside that group (/login, /signup) — see that file's comment for why this exists. */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#09090b] px-4">
      <div className="w-full max-w-lg space-y-4 text-center">
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
    </div>
  );
}
