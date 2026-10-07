"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  SPORTSBOOKS,
  SPORTSBOOK_KEYS,
  SPORTSBOOK_CATEGORIES,
  type Sportsbook,
  type SportsbookCategory,
} from "@/lib/sportsbooks";
import { PlatformIcon } from "./platform-icon";
import { LockIcon } from "./icons";

/**
 * A `<select>`-like control for choosing a betting platform — built custom
 * (rather than a native <select>) specifically so each option can show that
 * platform's own icon next to its name, which no browser renders inside a
 * native <option>. Shared by SportsbookPicker (the header/menu preference)
 * and PushBetButton's first-time "Push to…" picker, so the icon list only
 * has to be laid out once.
 *
 * `allowedCategories` (see lib/entitlements.ts's allowedPlatformCategories)
 * tier-gates which categories are actually selectable — Free only gets
 * "Sportsbooks"; everything else still LISTS but shows locked and links to
 * /upgrade instead of selecting, so a Free user can see what they're
 * missing rather than have it silently disappear.
 */
export function PlatformSelect({
  value,
  onChange,
  placeholder,
  ariaLabel,
  disabled = false,
  compact = false,
  allowedCategories,
}: {
  value: Sportsbook | null;
  onChange: (book: Sportsbook | null) => void;
  placeholder: string;
  ariaLabel?: string;
  disabled?: boolean;
  compact?: boolean;
  allowedCategories?: SportsbookCategory[];
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = value ? SPORTSBOOKS[value] : null;
  const isAllowed = (category: SportsbookCategory) =>
    !allowedCategories || allowedCategories.includes(category);
  const anyLocked = SPORTSBOOK_CATEGORIES.some((c) => !isAllowed(c));

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel ?? placeholder}
        className={
          compact
            ? "flex items-center gap-1.5 bg-transparent text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50 disabled:cursor-not-allowed"
            : "flex items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-900/80 px-2 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed"
        }
      >
        {current && <PlatformIcon book={value as Sportsbook} size={compact ? 14 : 16} />}
        <span className="max-w-[8rem] truncate">{current ? current.label : placeholder}</span>
        <span aria-hidden className="text-[10px] text-neutral-500">
          ▾
        </span>
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute left-0 z-50 mt-1 max-h-72 w-56 overflow-y-auto rounded-md border border-neutral-700 bg-neutral-900 py-1 shadow-xl"
        >
          <li>
            <button
              type="button"
              role="option"
              aria-selected={value === null}
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="flex w-full items-center px-3 py-1.5 text-left text-sm text-neutral-400 hover:bg-neutral-800"
            >
              {placeholder}
            </button>
          </li>
          {SPORTSBOOK_CATEGORIES.map((category) => {
            const allowed = isAllowed(category);
            return (
              <li key={category}>
                <div className="flex items-center gap-1 px-3 pb-0.5 pt-1.5 text-[10px] uppercase tracking-wide text-neutral-600">
                  {category}
                  {!allowed && <LockIcon className="h-2.5 w-2.5" />}
                </div>
                <ul>
                  {SPORTSBOOK_KEYS.filter((key) => SPORTSBOOKS[key].category === category).map(
                    (key) =>
                      allowed ? (
                        <li key={key}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={value === key}
                            onClick={() => {
                              onChange(key);
                              setOpen(false);
                            }}
                            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-neutral-800 ${
                              value === key
                                ? "bg-neutral-800/60 text-neutral-100"
                                : "text-neutral-300"
                            }`}
                          >
                            <PlatformIcon book={key} size={16} />
                            <span className="truncate">{SPORTSBOOKS[key].label}</span>
                          </button>
                        </li>
                      ) : (
                        <li key={key}>
                          <span className="flex w-full cursor-not-allowed items-center gap-2 px-3 py-1.5 text-left text-sm text-neutral-600">
                            <PlatformIcon book={key} size={16} />
                            <span className="truncate opacity-60">{SPORTSBOOKS[key].label}</span>
                          </span>
                        </li>
                      )
                  )}
                </ul>
              </li>
            );
          })}
          {anyLocked && (
            <li className="mt-1 border-t border-neutral-800 px-3 pt-1.5">
              <Link
                href="/upgrade"
                onClick={() => setOpen(false)}
                className="block py-1 text-xs text-blue-400 hover:text-blue-300"
              >
                Upgrade to unlock every platform →
              </Link>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * Same shell as PlatformSelect, but a checklist instead of a single picker —
 * for choosing "my platforms" (plural), the set PushBetButton pushes every
 * bet slip to at once. Unlike PlatformSelect, picking an option never closes
 * the dropdown (so several can be toggled in one visit); it closes only on
 * outside-click/Escape, same as PlatformSelect.
 */
export function PlatformMultiSelect({
  value,
  onChange,
  placeholder,
  ariaLabel,
  compact = false,
  allowedCategories,
}: {
  value: Sportsbook[];
  onChange: (books: Sportsbook[]) => void;
  placeholder: string;
  ariaLabel?: string;
  compact?: boolean;
  allowedCategories?: SportsbookCategory[];
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const isAllowed = (category: SportsbookCategory) =>
    !allowedCategories || allowedCategories.includes(category);
  const anyLocked = SPORTSBOOK_CATEGORIES.some((c) => !isAllowed(c));

  function toggle(key: Sportsbook) {
    onChange(value.includes(key) ? value.filter((k) => k !== key) : [...value, key]);
  }

  const label =
    value.length === 0
      ? placeholder
      : value.length === 1
        ? SPORTSBOOKS[value[0]].label
        : `${SPORTSBOOKS[value[0]].label} +${value.length - 1}`;

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel ?? placeholder}
        className={
          compact
            ? "flex items-center gap-1.5 bg-transparent text-xs text-blue-400 hover:text-blue-300"
            : "flex items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-900/80 px-2 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800"
        }
      >
        {value.length > 0 && <PlatformIcon book={value[0]} size={compact ? 14 : 16} />}
        <span className="max-w-[9rem] truncate">{label}</span>
        <span aria-hidden className="text-[10px] text-neutral-500">
          ▾
        </span>
      </button>
      {open && (
        <ul
          role="listbox"
          aria-multiselectable="true"
          className="absolute left-0 z-50 mt-1 max-h-72 w-60 overflow-y-auto rounded-md border border-neutral-700 bg-neutral-900 py-1 shadow-xl"
        >
          {SPORTSBOOK_CATEGORIES.map((category) => {
            const allowed = isAllowed(category);
            return (
              <li key={category}>
                <div className="flex items-center gap-1 px-3 pb-0.5 pt-1.5 text-[10px] uppercase tracking-wide text-neutral-600">
                  {category}
                  {!allowed && <LockIcon className="h-2.5 w-2.5" />}
                </div>
                <ul>
                  {SPORTSBOOK_KEYS.filter((key) => SPORTSBOOKS[key].category === category).map(
                    (key) => {
                      const checked = value.includes(key);
                      return allowed ? (
                        <li key={key}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={checked}
                            onClick={() => toggle(key)}
                            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-neutral-800 ${
                              checked ? "bg-neutral-800/60 text-neutral-100" : "text-neutral-300"
                            }`}
                          >
                            <span
                              aria-hidden
                              className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border ${
                                checked
                                  ? "border-blue-500 bg-blue-500 text-white"
                                  : "border-neutral-600"
                              }`}
                            >
                              {checked && (
                                <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none">
                                  <path
                                    d="M2 6l2.5 2.5L10 3"
                                    stroke="currentColor"
                                    strokeWidth="1.6"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              )}
                            </span>
                            <PlatformIcon book={key} size={16} />
                            <span className="truncate">{SPORTSBOOKS[key].label}</span>
                          </button>
                        </li>
                      ) : (
                        <li key={key}>
                          <span className="flex w-full cursor-not-allowed items-center gap-2 px-3 py-1.5 text-left text-sm text-neutral-600">
                            <PlatformIcon book={key} size={16} />
                            <span className="truncate opacity-60">{SPORTSBOOKS[key].label}</span>
                          </span>
                        </li>
                      );
                    }
                  )}
                </ul>
              </li>
            );
          })}
          <li className="mt-1 flex items-center justify-between gap-2 border-t border-neutral-800 px-3 pt-1.5">
            {anyLocked ? (
              <Link
                href="/upgrade"
                onClick={() => setOpen(false)}
                className="block py-1 text-xs text-blue-400 hover:text-blue-300"
              >
                Upgrade to unlock every platform →
              </Link>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="py-1 text-xs text-neutral-400 hover:text-neutral-200"
            >
              Done
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
