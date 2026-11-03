import { type NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, adminPassword, cookieForRole, roleForPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST /api/login {password} → sets the stateless auth cookie on success.
// The admin password grants full access; VIEWER_PASSWORD (optional) grants
// read-only access to shared folios.
export async function POST(req: NextRequest) {
  if (!adminPassword()) {
    return NextResponse.json({ error: "ADMIN_PASSWORD is not configured" }, { status: 503 });
  }
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };

  const role = await roleForPassword(typeof password === "string" ? password : "");
  const token = role ? await cookieForRole(role) : null;
  if (!role || !token) {
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true, role });
  res.cookies.set(AUTH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}
