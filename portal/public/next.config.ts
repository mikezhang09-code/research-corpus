import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// `/api/*` is served by this app's own route handlers (src/app/api/**),
// which read Supabase directly and stream files from R2 — no rewrites, no
// external backend.
const nextConfig: NextConfig = {
  // `next dev` blocks its /_next/* resources from non-localhost origins. This
  // allows reaching the dev server by the VM's Tailscale IP. Dev-only —
  // production builds ignore this entirely.
  allowedDevOrigins: ["100.113.14.97"],
};

export default nextConfig;

// Makes Cloudflare bindings + `.dev.vars` available during `next dev`.
initOpenNextCloudflareForDev();
