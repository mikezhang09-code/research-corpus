import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getCloudflareContext } from "@opennextjs/cloudflare";

// Read a var/secret. Under @opennextjs/cloudflare these live on the Cloudflare
// context (wrangler `vars` + secrets in prod, `.dev.vars` in `next dev`);
// fall back to process.env for plain Node runs.
export function env(name: string): string | undefined {
  try {
    const e = getCloudflareContext().env as Record<string, string | undefined>;
    return e[name] ?? process.env[name];
  } catch {
    return process.env[name];
  }
}

// Service-role Supabase client, used only inside server-side route handlers —
// the key never reaches the browser. RLS is disabled on these tables
// (single-user portal); this public app issues read queries only.
export function supabase(): SupabaseClient {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

// Proxy a public R2 object through this origin (keeps client-side `fetch`
// of file bytes same-origin, so docx-preview / SheetJS need no R2 CORS).
export async function streamR2(r2Url: string | null): Promise<Response> {
  if (!r2Url) return new Response("File not available", { status: 404 });
  const upstream = await fetch(r2Url);
  if (!upstream.ok || !upstream.body) {
    return new Response("Upstream file fetch failed", { status: 502 });
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": "private, max-age=300",
    },
  });
}
