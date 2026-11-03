import { getCloudflareContext } from "@opennextjs/cloudflare";
import { SHARED_TAG } from "./shared-tag";

export { SHARED_TAG };

export const AUTH_COOKIE = "rc_public_auth";

export type Role = "admin" | "viewer";

// corpus.companyresearch.org sits behind Cloudflare Access (Zero Trust email
// allowlist) at the edge, so requests on that hostname authenticated before
// reaching this Worker — they are treated as admin with no password gate.
const ACCESS_PROTECTED_HOSTS = new Set(["corpus.companyresearch.org"]);

export function isAccessProtectedHost(host: string | null | undefined): boolean {
  return ACCESS_PROTECTED_HOSTS.has((host ?? "").toLowerCase().split(":")[0]);
}

// Worker secrets (`wrangler secret put`) in production, `.dev.vars` /
// process.env under `next dev`. Kept separate from lib/supabase so the
// middleware bundle doesn't pull in supabase-js.
function envVar(name: string): string | undefined {
  try {
    const e = getCloudflareContext().env as Record<string, string | undefined>;
    return e[name] ?? process.env[name];
  } catch {
    return process.env[name];
  }
}

export const adminPassword = () => envVar("ADMIN_PASSWORD");
export const viewerPassword = () => envVar("VIEWER_PASSWORD") || undefined;

// Stateless session tokens: HMAC-SHA256 of a fixed label keyed by the
// password. Nothing is stored server-side — rotating a password invalidates
// every cookie issued for that role at once. The admin label is unchanged
// from the single-password era so existing admin cookies stay valid; the
// viewer label differs so a viewer token can never equal an admin one.
const ADMIN_LABEL = "research-public-viewer";
const VIEWER_LABEL = "research-public-viewer:viewer-role";
const VIEWER_PREFIX = "viewer.";

export async function authToken(password: string, label: string = ADMIN_LABEL): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(label));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The cookie value to issue for a role (caller has already checked the password). */
export async function cookieForRole(role: Role): Promise<string | null> {
  if (role === "admin") {
    const pw = adminPassword();
    return pw ? authToken(pw) : null;
  }
  const pw = viewerPassword();
  return pw ? VIEWER_PREFIX + (await authToken(pw, VIEWER_LABEL)) : null;
}

/** Which role, if any, a password unlocks. Constant-time comparisons. */
export async function roleForPassword(password: string): Promise<Role | null> {
  const got = await authToken(password);
  const admin = adminPassword();
  if (admin && timingSafeEqual(got, await authToken(admin))) return "admin";
  const viewer = viewerPassword();
  if (viewer && timingSafeEqual(got, await authToken(viewer))) return "viewer";
  return null;
}

/** Resolve the role a session cookie grants, or null if it is invalid. */
export async function roleFromCookie(value: string | undefined): Promise<Role | null> {
  if (!value) return null;
  if (value.startsWith(VIEWER_PREFIX)) {
    const pw = viewerPassword();
    if (!pw) return null;
    const expected = VIEWER_PREFIX + (await authToken(pw, VIEWER_LABEL));
    return timingSafeEqual(value, expected) ? "viewer" : null;
  }
  const pw = adminPassword();
  if (!pw) return null;
  return timingSafeEqual(value, await authToken(pw)) ? "admin" : null;
}

/** Role for a request from its host + cookie (Access-protected host → admin). */
export async function requestRole(
  host: string | null | undefined,
  cookie: string | undefined,
): Promise<Role | null> {
  if (isAccessProtectedHost(host)) return "admin";
  return roleFromCookie(cookie);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when the folio exists and carries SHARED_TAG. Uses Supabase REST directly. */
export async function isSharedFolio(id: string): Promise<boolean> {
  if (!UUID_RE.test(id)) return false;
  const url = envVar("SUPABASE_URL");
  const key = envVar("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return false;
  const res = await fetch(
    `${url}/rest/v1/library_notebooks?id=eq.${id}&tags=cs.%7B${SHARED_TAG}%7D&select=id`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  if (!res.ok) return false;
  const rows = (await res.json()) as unknown[];
  return rows.length === 1;
}
