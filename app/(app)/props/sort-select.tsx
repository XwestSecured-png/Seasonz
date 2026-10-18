"use client";

import { PROP_SORTS, type PropSort } from "@/lib/prop-sort";

/** "Sort by" dropdown shared by the prop lists. */
export function SortSelect({ value, onChange }: { value: PropSort; onChange: (v: PropSort) => void }) {
  return (
    <label className="text-xs text-neutral-500 flex items-center gap-1.5">
      Sort by
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as PropSort)}
        className="rounded-md bg-neutral-900 border border-neutral-800 px-2 py-1 text-sm text-neutral-200 focus:outline-none focus:ring-2 focus:ring-blue-600"
      >
        {PROP_SORTS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
    </label>
  );
}
