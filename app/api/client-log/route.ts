import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clientLogs } from "@/db/schema";

// Receives the browser diagnostics sent by the inline reporter in
// app/layout.tsx (page loaded? styles applied? errors?). Public and
// write-only; payloads are capped.
export async function POST(req: NextRequest) {
  try {
    const text = (await req.text()).slice(0, 6000);
    const body = JSON.parse(text) as { kind?: string };
    await db.insert(clientLogs).values({
      kind: String(body.kind ?? "report").slice(0, 40),
      ua: (req.headers.get("user-agent") ?? "").slice(0, 300),
      detail: body,
    });
  } catch {
    // ignore malformed reports
  }
  return new NextResponse(null, { status: 204 });
}
