import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { inviteCodes } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin-roles";
import { generateCode, isPlatform, normalizeCode } from "@/lib/invite-codes";

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** GET — every invite code, grouped by the client. */
export async function GET() {
  const { res } = await requireAdmin();
  if (res) return res;
  const rows = await db.select().from(inviteCodes).orderBy(asc(inviteCodes.platform), asc(inviteCodes.id));
  return NextResponse.json({ codes: rows });
}

/**
 * POST { platform, code? , count? } — add codes to a platform's list.
 * With `code`, adds that exact code; otherwise generates `count` (1-20, default 5).
 */
export async function POST(req: NextRequest) {
  const { user, res } = await requireAdmin();
  if (res) return res;
  const body = (await req.json()) as { platform?: string; code?: string; count?: number };
  if (!body.platform || !isPlatform(body.platform)) return bad("platform must be ios, android, or desktop");
  const platform = body.platform;

  let codes: string[];
  if (body.code) {
    const code = normalizeCode(body.code);
    if (!/^[A-Z0-9-]{6,32}$/.test(code)) return bad("Codes are 6-32 letters, numbers, or dashes");
    codes = [code];
  } else {
    const count = Math.min(Math.max(Math.floor(body.count ?? 5), 1), 20);
    codes = Array.from({ length: count }, () => generateCode(platform));
  }

  const inserted = await db
    .insert(inviteCodes)
    .values(codes.map((code) => ({ code, platform, createdById: user.id })))
    .onConflictDoNothing()
    .returning();
  if (inserted.length === 0) return bad("That code already exists");
  return NextResponse.json({ added: inserted.length });
}

/** PATCH { id, isActive } — turn a code on or off. */
export async function PATCH(req: NextRequest) {
  const { res } = await requireAdmin();
  if (res) return res;
  const body = (await req.json()) as { id?: number; isActive?: boolean };
  if (typeof body.id !== "number" || typeof body.isActive !== "boolean") return bad("id and isActive are required");
  await db.update(inviteCodes).set({ isActive: body.isActive }).where(eq(inviteCodes.id, body.id));
  return NextResponse.json({ ok: true });
}

/** DELETE ?id= — remove a code from the list. */
export async function DELETE(req: NextRequest) {
  const { res } = await requireAdmin();
  if (res) return res;
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isFinite(id)) return bad("id is required");
  await db.delete(inviteCodes).where(eq(inviteCodes.id, id));
  return NextResponse.json({ ok: true });
}
