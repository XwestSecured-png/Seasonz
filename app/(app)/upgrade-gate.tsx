import Link from "next/link";
import { LockIcon } from "./icons";

/** Shown in place of a Pro-gated page/section for a Free-tier user — see lib/entitlements.ts for what's actually gated. */
export function UpgradeGate({ feature }: { feature: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-neutral-800 bg-neutral-900/40 px-6 py-10 text-center">
      <LockIcon className="h-7 w-7 text-neutral-600" />
      <p className="max-w-sm text-sm text-neutral-400">
        <span className="font-medium text-neutral-200">{feature}</span> is a Pro feature. Upgrade
        to unlock it, plus the full TD Picks builder and every push platform.
      </p>
      <Link
        href="/upgrade"
        className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
      >
        See plans
      </Link>
    </div>
  );
}
