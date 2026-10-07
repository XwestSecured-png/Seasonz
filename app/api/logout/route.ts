import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/login", req.url), {
    status: 303,
  });
  res.cookies.delete(COOKIE_NAME);
  return res;
}
