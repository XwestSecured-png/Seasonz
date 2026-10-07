import { redirect } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import { gte, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/current-user";
import { getAppLimits } from "@/lib/app-settings";
import { TIER_ORDER, TIER_LABELS, type Tier } from "@/lib/tiers";
import { PageInfo } from "../page-info";
import { ShieldStarIcon } from "../icons";
import { UserManager } from "./user-manager";
import { SettingsEditor } from "./settings-editor";
import { InviteCodesPanel, type ShownCode } from "./invite-codes-panel";
import { PromoCodesPanel } from "./promo-codes-panel";
import { nextCodeForPlatform, PLATFORMS, type Platform } from "@/lib/invite-codes";
import { getOddsKeyReport, PROVIDER_LABELS } from "@/lib/odds-provider";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user?.isAdmin) redirect("/");

  const limits = await getAppLimits();

  // A fresh invite code per platform on every load (lib/invite-codes.ts).
  const shown = Object.fromEntries(
    await Promise.all(
      PLATFORMS.map(async (p) => {
        const c = await nextCodeForPlatform(p);
        return [p, c ? { code: c.code, uses: c.uses } : null] as const;
      })
    )
  ) as Record<Platform, ShownCode | null>;

  const oddsKeys = await getOddsKeyReport();

  const tierCountRows = await db
    .select({ tier: users.tier, count: sql<number>`count(*)::int` })
    .from(users)
    .groupBy(users.tier);
  const tierCounts: Record<Tier, number> = { free: 0, pro: 0, super_pro: 0 };
  for (const row of tierCountRows) {
    if (row.tier in tierCounts) tierCounts[row.tier as Tier] += row.count;
  }
  const totalUsers = TIER_ORDER.reduce((sum, t) => sum + tierCounts[t], 0);

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const [{ count: newThisWeek }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(gte(users.createdAt, sevenDaysAgo));

  const mrr = tierCounts.pro * limits.proPriceUsd + tierCounts.super_pro * limits.superProPriceUsd;

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <ShieldStarIcon className="h-5 w-5 text-neutral-400" />
            Admin
          </h1>
          <p className="max-w-2xl text-sm text-neutral-400">
            Invite codes, promo codes, admins, odds keys, and business metrics.
            {user.isLegacyAdmin ? " You're a legacy admin." : ""}
          </p>
        </div>
        <PageInfo>
          <p>
            Only accounts with the admin flag can see this page (enforced server-side on
            every request, not just hidden from the nav). Changing a tier here comps the
            account directly — it doesn&rsquo;t touch Stripe, so it&rsquo;s the right
            way to grant or revoke access without a real subscription.
          </p>
        </PageInfo>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-neutral-300">Business metrics</h2>
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <MetricCard label="Total users" value={totalUsers.toLocaleString()} />
          <MetricCard label="New this week" value={newThisWeek.toLocaleString()} />
          <MetricCard label="Pro + Super Pro" value={(tierCounts.pro + tierCounts.super_pro).toLocaleString()} />
          <MetricCard label="Est. MRR" value={`$${mrr.toLocaleString()}`} />
        </div>
        <div className="grid gap-3 grid-cols-3">
          {TIER_ORDER.map((t) => (
            <MetricCard key={t} label={TIER_LABELS[t]} value={tierCounts[t].toLocaleString()} compact />
          ))}
        </div>
        <p className="text-xs text-neutral-600">
          Est. MRR is paid-tier headcount × the displayed price below — a directional estimate,
          not a Stripe revenue report (it doesn&rsquo;t account for proration, failed
          payments, or admin-comped accounts).
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-neutral-300">Invite codes</h2>
        <InviteCodesPanel shown={shown} />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-neutral-300">Promo codes (free months)</h2>
        <PromoCodesPanel currentAdminId={user.id} currentIsLegacy={user.isLegacyAdmin} />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-neutral-300">Odds keys</h2>
        {oddsKeys.length === 0 ? (
          <p className="text-xs text-neutral-500">
            No odds keys set. Add ODDS_API_KEYS_FREE and PROPLINE_API_KEY in Vercel&rsquo;s environment variables.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-neutral-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-neutral-900/60 text-xs text-neutral-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Order</th>
                  <th className="px-3 py-2 font-medium">Key</th>
                  <th className="px-3 py-2 font-medium">Requests left</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Last used</th>
                </tr>
              </thead>
              <tbody>
                {oddsKeys.map((k, i) => (
                  <tr key={k.label} className="border-t border-neutral-800/80">
                    <td className="px-3 py-2 text-xs text-neutral-500">{i + 1}</td>
                    <td className="px-3 py-2 text-xs">
                      <div className="text-neutral-200">{k.label}</div>
                      <div className="font-mono text-[10px] text-neutral-600">
                        {PROVIDER_LABELS[k.provider]} · …{k.last4}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-neutral-300">
                      {k.remaining === null ? "Not used yet" : k.remaining.toLocaleString()}
                      {k.used !== null && <span className="text-neutral-600"> ({k.used.toLocaleString()} used)</span>}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {k.resting ? (
                        <span className="text-amber-400">
                          Out — skipped{k.resetAt ? ` until ${k.resetAt.toLocaleString("en-US", { timeZone: "America/New_York" })} ET` : " for 24h"}
                        </span>
                      ) : k.lastStatus && k.lastStatus >= 400 ? (
                        <span className="text-red-400">Error {k.lastStatus}</span>
                      ) : (
                        <span className="text-emerald-400">In rotation</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-neutral-500">
                      {k.updatedAt ? k.updatedAt.toLocaleString("en-US", { timeZone: "America/New_York" }) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-neutral-600">
          Free keys are used first, top to bottom; the paid key is only used once every free key is out.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-neutral-300">App settings</h2>
        <SettingsEditor initialLimits={limits} />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-neutral-300">Users</h2>
        <UserManager currentAdminId={user.id} currentIsLegacy={user.isLegacyAdmin} />
      </section>
    </div>
  );
}

function MetricCard({
  label,
  value,
  compact = false,
}: {
  label: string;
  value: string;
  compact?: boolean;
}) {
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900/40 px-3 py-2.5">
      <div className={compact ? "text-lg font-semibold" : "text-xl font-semibold"}>{value}</div>
      <div className="text-xs text-neutral-500">{label}</div>
    </div>
  );
}
