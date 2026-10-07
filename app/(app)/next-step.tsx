import Link from "next/link";

// A "what to do next" footer, pointing to the next page in the app's
// intended weekly workflow (same order as the top nav — see nav-links.tsx).
// Each page passes its own next destination and a one-line reason, so the
// hint is specific to what that next page actually offers.
export function NextStep({
  href,
  label,
  reason,
}: {
  href: string;
  label: string;
  reason: string;
}) {
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900/50 px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
      <p className="text-sm text-neutral-400 max-w-xl">
        <span className="text-neutral-200 font-medium">Next: {label}.</span> {reason}
      </p>
      <Link
        href={href}
        className="text-sm text-blue-400 hover:text-blue-300 font-medium whitespace-nowrap shrink-0"
      >
        Go there →
      </Link>
    </div>
  );
}
