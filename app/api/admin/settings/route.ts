import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { getAppLimits, setAppLimits } from "@/lib/app-settings";
import type { AppLimits } from "@/lib/tiers";

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) return { ok: false, res: NextResponse.json({ error: "Sign in required" }, { status: 401 }) };
  if (!user.isAdmin) return { ok: false, res: NextResponse.json({ error: "Admin only" }, { status: 403 }) };
  return { ok: true, res: null };
}

const NUMERIC_KEYS: (keyof AppLimits)[] = [
  "proPriceUsd",
  "superProPriceUsd",
  "freeTdPicksMaxLegs",
  "freeTopPicksCount",
];

export async function GET() {
  const { res } = await requireAdmin();
  if (res) return res;
  return NextResponse.json({ limits: await getAppLimits() });
}

/** PATCH /api/admin/settings — merges any subset of AppLimits (see lib/tiers.ts) into the single admin-editable row. */
export async function PATCH(req: NextRequest) {
  const { res } = await requireAdmin();
  if (res) return res;

  const body = (await req.json()) as Partial<Record<keyof AppLimits, unknown>>;
  const patch: Partial<AppLimits> = {};

  for (const key of NUMERIC_KEYS) {
    if (body[key] === undefined) continue;
    const n = Number(body[key]);
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json({ error: `${key} must be a non-negative number` }, { status: 400 });
    }
    patch[key] = n;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const limits = await setAppLimits(patch);
  return NextResponse.json({ limits });
}
