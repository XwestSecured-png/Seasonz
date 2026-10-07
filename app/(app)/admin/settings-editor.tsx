"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AppLimits } from "@/lib/tiers";

const FIELDS: { key: keyof AppLimits; label: string; hint: string }[] = [
  { key: "proPriceUsd", label: "Pro price ($/mo)", hint: "Shown on the Upgrade page" },
  { key: "superProPriceUsd", label: "Super Pro price ($/mo)", hint: "Shown on the Upgrade page" },
  { key: "freeTdPicksMaxLegs", label: "Free TD Picks max legs", hint: "Pro/Super Pro always get 5" },
  { key: "freeTopPicksCount", label: "Free Model's Top N count", hint: "Pro/Super Pro always see 5" },
];

export function SettingsEditor({ initialLimits }: { initialLimits: AppLimits }) {
  const router = useRouter();
  const [values, setValues] = useState<AppLimits>(initialLimits);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const dirty = FIELDS.some((f) => values[f.key] !== initialLimits[f.key]);

  async function save() {
    setStatus("saving");
    setError(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Save failed");
        setStatus("error");
        return;
      }
      setStatus("saved");
      router.refresh();
    } catch {
      setError("Network error — try again");
      setStatus("error");
    }
  }

  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900/40 p-4 space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <label key={f.key} className="block space-y-1">
            <span className="text-xs text-neutral-400">{f.label}</span>
            <input
              type="number"
              min={0}
              value={values[f.key]}
              onChange={(e) =>
                setValues((v) => ({ ...v, [f.key]: e.target.value === "" ? 0 : Number(e.target.value) }))
              }
              className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-1.5 text-sm"
            />
            <span className="block text-[11px] text-neutral-600">{f.hint}</span>
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || status === "saving"}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {status === "saving" ? "Saving…" : "Save settings"}
        </button>
        {status === "saved" && !dirty && (
          <span className="text-xs text-emerald-400">Saved.</span>
        )}
        {status === "error" && <span className="text-xs text-red-400">{error}</span>}
      </div>
    </div>
  );
}
