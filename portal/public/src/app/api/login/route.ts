import { type NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, adminPassword, authToken, timingSafeEqual } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST /api/login {password} → sets the stateless auth cookie on success.
export async function POST(req: NextRequest) {
  const expected = adminPassword();
  if (!expected) {
    return NextResponse.json({ error: "ADMIN_PASSWORD is not configured" }, { status: 503 });
  }
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };

  // Compare HMACs rather than raw strings so the check stays constant-time
  // even for wrong-length guesses.
  const expectedToken = await authToken(expected);
  const gotToken = await authToken(typeof password === "string" ? password : "");
  if (!timingSafeEqual(gotToken, expectedToken)) {
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, expectedToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}
