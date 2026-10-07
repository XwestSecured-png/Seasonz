import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { feedback } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/current-user";

const VALID_CATEGORIES = new Set(["Bug", "Idea", "Question", "Other"]);

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const category = VALID_CATEGORIES.has(body?.category) ? body.category : "Other";
  const message = String(body?.message ?? "").trim();
  const page = body?.page ? String(body.page) : null;

  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  await db.insert(feedback).values({
    userId: user.id,
    username: user.username,
    page,
    category,
    message,
  });

  return NextResponse.json({ ok: true });
}

/** Mark a feedback item reviewed/new — any logged-in person can triage (small private group, no admin role). */
export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const id = Number(body?.id);
  const status = body?.status === "new" ? "new" : "reviewed";
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  await db.update(feedback).set({ status }).where(eq(feedback.id, id));
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rows = await db.select().from(feedback).orderBy(desc(feedback.createdAt));
  return NextResponse.json({ rows });
}
