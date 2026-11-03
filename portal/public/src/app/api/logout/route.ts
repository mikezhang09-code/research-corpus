import { NextResponse } from "next/server";
import { AUTH_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST /api/logout → clears the auth cookie.
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
