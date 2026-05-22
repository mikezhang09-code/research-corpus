import { getCloudflareContext } from "@opennextjs/cloudflare";
import { env } from "./supabase";

// Minimal shape of the Workers R2 API we use — avoids depending on
// @cloudflare/workers-types being present in the build.
interface R2ObjectBodyLike {
  body: ReadableStream;
  httpMetadata?: { contentType?: string };
}

interface R2BucketLike {
  get(key: string): Promise<R2ObjectBodyLike | null>;
  put(
    key: string,
    value: ArrayBuffer | ReadableStream | string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
}

// The R2 bucket binding declared in wrangler.jsonc. Reads still go through
// public URLs (see streamR2); this binding is only for writes and deletes.
export function r2Bucket(): R2BucketLike {
  const e = getCloudflareContext().env as Record<string, unknown>;
  const bucket = e.R2_BUCKET;
  if (!bucket) throw new Error("R2_BUCKET binding is not configured");
  return bucket as R2BucketLike;
}

// Mirrors r2_key_for_upload() in portal/backend/storage.py.
export function r2KeyForUpload(itemId: string, filename: string): string {
  return `library/uploads/${itemId}/${filename}`;
}

// Public URL for an R2 object — mirrors public_url() in storage.py.
export function r2PublicUrl(key: string): string {
  const base = env("R2_PUBLIC_URL");
  if (!base) throw new Error("R2_PUBLIC_URL is not configured");
  return `${base.replace(/\/$/, "")}/${key}`;
}
