import { NextResponse } from "next/server";
import { supabase, streamR2 } from "@/lib/supabase";
import { r2Bucket } from "@/lib/r2";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ fileId: string }> };

// GET /api/free-forms/{fileId}/content  → raw file bytes
//
// Reads through the R2 bucket binding (uncached); legacy rows without an
// `r2_key` fall back to the public URL.
export async function GET(_req: Request, { params }: RouteParams) {
  const { fileId } = await params;
  const db = supabase();

  const { data, error } = await db
    .from("library_items")
    .select("r2_key, r2_url, mime_type")
    .eq("id", fileId)
    .is("notebook_id", null)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "File not found" }, { status: 404 });
  const row = data as { r2_key: string | null; r2_url: string | null; mime_type: string | null };

  if (row.r2_key) {
    const obj = await r2Bucket().get(row.r2_key);
    if (obj) {
      return new Response(obj.body, {
        status: 200,
        headers: {
          "content-type":
            obj.httpMetadata?.contentType ?? row.mime_type ?? "application/octet-stream",
          "cache-control": "no-store",
        },
      });
    }
  }
  return streamR2(row.r2_url);
}

// PUT /api/free-forms/{fileId}/content  → overwrite text
// Used by the note editor. Keeps the same r2_key/r2_url; only bytes + size change.
export async function PUT(req: Request, { params }: RouteParams) {
  const { fileId } = await params;
  const db = supabase();

  let body: { content?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.content !== "string") {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }

  const { data: f } = await db
    .from("library_items")
    .select("r2_key, mime_type")
    .eq("id", fileId)
    .is("notebook_id", null)
    .maybeSingle();
  if (!f) return NextResponse.json({ error: "File not found" }, { status: 404 });
  const row = f as { r2_key: string | null; mime_type: string | null };
  if (!row.r2_key) {
    return NextResponse.json(
      { error: "This item has no stored file to update" },
      { status: 400 },
    );
  }

  try {
    await r2Bucket().put(row.r2_key, body.content, {
      httpMetadata: { contentType: row.mime_type ?? "text/markdown" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `R2 write failed: ${msg}` }, { status: 502 });
  }

  const size = new TextEncoder().encode(body.content).length;
  const { data, error } = await db
    .from("library_items")
    .update({ file_size_bytes: size })
    .eq("id", fileId)
    .is("notebook_id", null)
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "File not found" }, { status: 404 });
  return NextResponse.json(data);
}
