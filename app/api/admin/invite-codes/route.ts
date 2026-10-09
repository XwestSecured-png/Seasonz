import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { inviteCodes, users } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/admin-roles";
import { generateCode, isPlatform, normalizeCode, parseCodeList } from "@/lib/invite-codes";

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/**
 * GET — invite code sheets. Legacy admins see every admin's sheet (the
 * complete list); regular admins see their own sheet only.
 */
export async function GET() {
  const { user, res } = await requireAdmin();
  if (res) return res;
  const rows = await db
    .select({
      id: inviteCodes.id,
      code: inviteCodes.code,
      platform: inviteCodes.platform,
      isActive: inviteCodes.isActive,
      uses: inviteCodes.uses,
      lastShownAt: inviteCodes.lastShownAt,
      createdById: inviteCodes.createdById,
      createdAt: inviteCodes.createdAt,
      createdBy: users.username,
    })
    .from(inviteCodes)
    .leftJoin(users, eq(users.id, inviteCodes.createdById))
    .orderBy(asc(inviteCodes.createdById), asc(inviteCodes.platform), asc(inviteCodes.id));
  const visible = user.isLegacyAdmin ? rows : rows.filter((r) => r.createdById === user.id);
  return NextResponse.json({ codes: visible, canSeeAll: user.isLegacyAdmin, me: user.id });
}

/**
 * POST — add codes to YOUR sheet.
 *   { platform, codes: "pasted text" }  bulk add (one per line / comma separated)
 *   { platform, code }                   one code
 *   { platform, count }                  generate 1-20 random codes
 */
export async function POST(req: NextRequest) {
  const { user, res } = await requireAdmin();
  if (res) return res;
  const body = (await req.json()) as { platform?: string; code?: string; codes?: string; count?: number };
  if (!body.platform || !isPlatform(body.platform)) return bad("platform must be ios, android, or desktop");
  const platform = body.platform;

  let codes: string[];
  if (typeof body.codes === "string") {
    codes = parseCodeList(body.codes);
    if (codes.length === 0) return bad("No valid codes found. Codes are 6-32 letters, numbers, or dashes.");
    if (codes.length > 500) return bad("Add at most 500 codes at a time.");
  } else if (body.code) {
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
    .returning({ id: inviteCodes.id });
  const skipped = codes.length - inserted.length;
  if (inserted.length === 0) return bad("All of those codes already exist.");
  return NextResponse.json({ added: inserted.length, skipped });
}

async function canEdit(userId: number, isLegacy: boolean, codeId: number) {
  if (isLegacy) return true;
  const [row] = await db.select({ by: inviteCodes.createdById }).from(inviteCodes).where(eq(inviteCodes.id, codeId));
  return row?.by === userId;
}

/** PATCH { id, isActive } — turn a code on or off (your own; legacy admins: any). */
export async function PATCH(req: NextRequest) {
  const { user, res } = await requireAdmin();
  if (res) return res;
  const body = (await req.json()) as { id?: number; isActive?: boolean };
  if (typeof body.id !== "number" || typeof body.isActive !== "boolean") return bad("id and isActive are required");
  if (!(await canEdit(user.id, user.isLegacyAdmin, body.id))) return bad("You can only change codes on your own sheet.", 403);
  await db.update(inviteCodes).set({ isActive: body.isActive }).where(eq(inviteCodes.id, body.id));
  return NextResponse.json({ ok: true });
}

/** DELETE ?id= — remove a code (your own; legacy admins: any). */
export async function DELETE(req: NextRequest) {
  const { user, res } = await requireAdmin();
  if (res) return res;
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isFinite(id)) return bad("id is required");
  if (!(await canEdit(user.id, user.isLegacyAdmin, id))) return bad("You can only delete codes on your own sheet.", 403);
  await db.delete(inviteCodes).where(eq(inviteCodes.id, id));
  return NextResponse.json({ ok: true });
}
