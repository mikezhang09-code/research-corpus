import { type NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, adminPassword, authToken, timingSafeEqual } from "@/lib/auth";

// corpus.companyresearch.org sits behind Cloudflare Access (Zero Trust email
// allowlist) at the edge, so requests on that hostname authenticated before
// reaching this Worker — skip the password gate there. Every other hostname
// (public.research.us.kg, *.workers.dev production and previews) is gated.
const ACCESS_PROTECTED_HOSTS = new Set(["corpus.companyresearch.org"]);

export async function middleware(req: NextRequest) {
  const host = (req.headers.get("host") ?? "").toLowerCase().split(":")[0];
  if (ACCESS_PROTECTED_HOSTS.has(host)) return NextResponse.next();

  const password = adminPassword();
  if (!password) {
    // Fail closed in production; stay open under `next dev` without .dev.vars.
    if (process.env.NODE_ENV === "production") {
      return new NextResponse("ADMIN_PASSWORD secret is not configured", { status: 503 });
    }
    return NextResponse.next();
  }

  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  if (cookie && timingSafeEqual(cookie, await authToken(password))) {
    return NextResponse.next();
  }

  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  const dest = req.nextUrl.pathname + req.nextUrl.search;
  url.search = dest === "/" ? "" : `?next=${encodeURIComponent(dest)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except the login surface and Next's static assets.
  matcher: ["/((?!login|api/login|_next/static|_next/image|favicon\\.ico).*)"],
};
