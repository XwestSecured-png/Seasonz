import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { parlayPicks } from "@/db/schema";
import { americanToImpliedProb } from "@/lib/props-model";
import { getCurrentUser } from "@/lib/current-user";

function currentNflSeason(): number {
  const now = new Date();
  return now.getMonth() >= 1 ? now.getFullYear() : now.getFullYear() - 1;
}

interface IncomingLeg {
  label: string;
  priceAmerican: number;
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const title = body?.title ? String(body.title).slice(0, 200) : null;
  const rawLegs: IncomingLeg[] = Array.isArray(body?.legs) ? body.legs : [];

  const legs = rawLegs
    .map((l) => ({
      label: String(l?.label ?? "").trim(),
      priceAmerican: Number(l?.priceAmerican),
    }))
    .filter((l) => l.label && Number.isFinite(l.priceAmerican) && l.priceAmerican !== 0);

  if (legs.length < 2) {
    return NextResponse.json(
      { error: "A parlay needs at least 2 legs" },
      { status: 400 }
    );
  }

  const legsWithGrading = legs.map((l) => ({
    ...l,
    winPct: americanToImpliedProb(l.priceAmerican),
    result: "pending" as const,
  }));
  const combinedWinPct = legsWithGrading.reduce((acc, l) => acc * l.winPct, 1);
  const weakestLegWinPct = Math.min(...legsWithGrading.map((l) => l.winPct));

  const [row] = await db
    .insert(parlayPicks)
    .values({
      kind: "user",
      userId: user.id,
      username: user.username,
      title,
      season: currentNflSeason(),
      week: body?.week && Number.isFinite(Number(body.week)) ? Number(body.week) : 0,
      size: legsWithGrading.length,
      legs: legsWithGrading,
      combinedWinPct,
      weakestLegWinPct,
      confidence:
        combinedWinPct >= 0.35 ? "High" : combinedWinPct >= 0.2 ? "Moderate" : "Low",
      status: "pending",
    })
    .returning();

  return NextResponse.json({ parlay: row });
}

interface StoredLeg {
  label: string;
  priceAmerican: number;
  winPct: number;
  result: "pending" | "won" | "lost" | "push";
}

/** Sets one leg's result (Pending/Won/Lost/Push) on a user's own parlay, and recomputes the parlay's overall status from all its legs. */
export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const id = Number(body?.id);
  const legIndex = Number(body?.legIndex);
  const result = body?.result;
  const validResults = new Set(["pending", "won", "lost", "push"]);
  if (
    !Number.isFinite(id) ||
    !Number.isFinite(legIndex) ||
    !validResults.has(result)
  ) {
    return NextResponse.json({ error: "id, legIndex, and a valid result are required" }, { status: 400 });
  }

  const { and, eq } = await import("drizzle-orm");
  const [row] = await db
    .select()
    .from(parlayPicks)
    .where(and(eq(parlayPicks.id, id), eq(parlayPicks.userId, user.id)));
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  const legs = (row.legs as StoredLeg[]).slice();
  if (!legs[legIndex]) return NextResponse.json({ error: "bad legIndex" }, { status: 400 });
  legs[legIndex] = { ...legs[legIndex], result };

  // A parlay loses the moment any leg loses, win only once every leg has
  // resolved won/push with none lost, and otherwise stays pending.
  const anyLost = legs.some((l) => l.result === "lost");
  const anyPending = legs.some((l) => l.result === "pending");
  const status = anyLost ? "lost" : anyPending ? "pending" : "won";

  await db.update(parlayPicks).set({ legs, status }).where(eq(parlayPicks.id, id));

  return NextResponse.json({ ok: true, status });
}

export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const id = Number(body?.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const { and, eq } = await import("drizzle-orm");
  await db
    .delete(parlayPicks)
    .where(and(eq(parlayPicks.id, id), eq(parlayPicks.userId, user.id)));

  return NextResponse.json({ ok: true });
}
