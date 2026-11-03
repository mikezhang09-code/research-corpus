import { type NextRequest, NextResponse } from "next/server";
import {
  AUTH_COOKIE,
  adminPassword,
  isAccessProtectedHost,
  isSharedFolio,
  roleFromCookie,
} from "@/lib/auth";

// Two roles:
//  - admin  — full access. Granted by ADMIN_PASSWORD, or by arriving on an
//             Access-protected hostname (corpus.companyresearch.org).
//  - viewer — read-only access to folios tagged SHARED_TAG, nothing else.
//             Granted by VIEWER_PASSWORD. Every viewer request is checked
//             here against an allowlist, so hiding UI is only cosmetic.

export async function middleware(req: NextRequest) {
  if (isAccessProtectedHost(req.headers.get("host"))) return NextResponse.next();

  if (!adminPassword()) {
    // Fail closed in production; stay open under `next dev` without .dev.vars.
    if (process.env.NODE_ENV === "production") {
      return new NextResponse("ADMIN_PASSWORD secret is not configured", { status: 503 });
    }
    return NextResponse.next();
  }

  const role = await roleFromCookie(req.cookies.get(AUTH_COOKIE)?.value);
  if (role === "admin") return NextResponse.next();
  if (role === "viewer") return viewerGate(req);

  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  const dest = req.nextUrl.pathname + req.nextUrl.search;
  url.search = dest === "/" ? "" : `?next=${encodeURIComponent(dest)}`;
  return NextResponse.redirect(url);
}

// Viewer-reachable routes. Capture group 1, when present, is a folio id that must be shared.
const VIEWER_PAGES: RegExp[] = [/^\/$/, /^\/library\/?$/, /^\/library\/([^/]+)\/?$/];
const VIEWER_API: { method: string; re: RegExp }[] = [
  { method: "GET", re: /^\/api\/library-notebooks\/?$/ },
  { method: "GET", re: /^\/api\/library-notebooks\/([^/]+)\/?$/ },
  { method: "GET", re: /^\/api\/library-notebooks\/([^/]+)\/files\/?$/ },
  { method: "GET", re: /^\/api\/library-notebooks\/([^/]+)\/files\/[^/]+\/content\/?$/ },
  // Zip download of selected files is a POST but read-only.
  { method: "POST", re: /^\/api\/library-notebooks\/([^/]+)\/files\/download\/?$/ },
];

async function viewerGate(req: NextRequest): Promise<NextResponse> {
  const path = req.nextUrl.pathname;
  const method = req.method === "HEAD" ? "GET" : req.method;
  const isApi = path.startsWith("/api/");

  const deny = () =>
    isApi
      ? NextResponse.json({ error: "Not available for viewer accounts" }, { status: 403 })
      : NextResponse.redirect(new URL("/library", req.url));

  let match: RegExpMatchArray | null = null;
  if (isApi) {
    for (const r of VIEWER_API) {
      if (r.method === method && (match = path.match(r.re))) break;
    }
  } else if (method === "GET") {
    for (const re of VIEWER_PAGES) if ((match = path.match(re))) break;
  }
  if (!match) return deny();

  const id = match[1];
  if (id && !(await isSharedFolio(id))) {
    return isApi ? NextResponse.json({ error: "Not found" }, { status: 404 }) : deny();
  }

  // The folio list route itself restricts viewers to shared folios.
  return NextResponse.next();
}

export const config = {
  // Everything except the login/logout surface and static assets. `pdfjs/`
  // holds the pdf.js runtime data (CMaps, fonts, wasm decoders) copied from
  // node_modules — public library files that Cloudflare's asset layer already
  // serves ahead of the Worker in production; excluding them keeps `next start`
  // and `next dev` behaving the same.
  matcher: ["/((?!login|api/login|api/logout|_next/static|_next/image|pdfjs/|favicon\\.ico).*)"],
};
