import { getCloudflareContext } from "@opennextjs/cloudflare";

export const AUTH_COOKIE = "rc_public_auth";

// The admin password is a Worker secret (`wrangler secret put ADMIN_PASSWORD`)
// in production, or `.dev.vars` / process.env under `next dev`. Kept separate
// from lib/supabase so the middleware bundle doesn't pull in supabase-js.
export function adminPassword(): string | undefined {
  try {
    const e = getCloudflareContext().env as Record<string, string | undefined>;
    return e.ADMIN_PASSWORD ?? process.env.ADMIN_PASSWORD;
  } catch {
    return process.env.ADMIN_PASSWORD;
  }
}

// Stateless session token: HMAC-SHA256 of a fixed label keyed by the admin
// password. Nothing is stored server-side — rotating ADMIN_PASSWORD
// invalidates every issued cookie at once.
export async function authToken(password: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("research-public-viewer"));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
