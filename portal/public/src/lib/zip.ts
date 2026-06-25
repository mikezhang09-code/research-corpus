import JSZip from "jszip";
import { r2Bucket, r2PublicUrl } from "./r2";

// Read one R2 object's bytes. Prefer the bucket binding (uncached); fall back
// to the public URL for legacy rows whose binding read misses. Mirrors the
// read strategy used by the file-content route handlers.
async function readKey(key: string): Promise<Uint8Array> {
  try {
    const obj = await r2Bucket().get(key);
    if (obj) return new Uint8Array(await new Response(obj.body).arrayBuffer());
  } catch {
    // binding unavailable in this environment — fall through to public URL
  }
  const res = await fetch(r2PublicUrl(key));
  if (!res.ok) throw new Error(`R2 read failed for ${key} (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

// Collision-free archive name: a second "report.md" becomes "report (2).md".
// Mirrors `_dedupe_name` in portal/backend/storage.py.
function dedupeName(name: string, seen: Map<string, number>): string {
  const base = name || "file";
  const n = (seen.get(base) ?? 0) + 1;
  seen.set(base, n);
  if (n === 1) return base;
  const dot = base.lastIndexOf(".");
  return dot > 0
    ? `${base.slice(0, dot)} (${n})${base.slice(dot)}`
    : `${base} (${n})`;
}

/** Build a zip (as bytes) from `(name, key)` entries, fetching each from R2. */
export async function buildZip(entries: { name: string; key: string }[]): Promise<Uint8Array> {
  const zip = new JSZip();
  const seen = new Map<string, number>();
  for (const { name, key } of entries) {
    zip.file(dedupeName(name, seen), await readKey(key));
  }
  return zip.generateAsync({ type: "uint8array" });
}

/** Wrap zip bytes in an attachment Response with an RFC 5987 filename so
 *  non-ASCII names (e.g. Chinese folio titles) survive the latin-1 header. */
export function zipResponse(data: Uint8Array, filename: string): Response {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "") || "download.zip";
  return new Response(data as unknown as BodyInit, {
    status: 200,
    headers: {
      "content-type": "application/zip",
      "content-disposition":
        `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "cache-control": "no-store",
    },
  });
}
