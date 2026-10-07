import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/current-user";
import { redeemPromoCode } from "@/lib/promo";

/** POST { code } — redeem a fully approved promo code for the signed-in user. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { code?: string };
  const result = await redeemPromoCode(user.id, String(body.code ?? ""));
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({
    ok: true,
    tier: result.tier,
    months: result.months,
    expiresAt: result.expiresAt.toISOString(),
  });
}
