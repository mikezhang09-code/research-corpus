import { type NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { r2Bucket } from "@/lib/r2";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ fileId: string }> };

// PUT /api/free-forms/{fileId}/file  (multipart/form-data)
// Overwrite a stored file's bytes in place (used by the docx editor).
// Keeps the same r2_key/r2_url and metadata; only bytes + size change.
// The IS NULL guard keeps this handler from ever touching folio files.
export async function PUT(req: NextRequest, { params }: RouteParams) {
  const { fileId } = await params;
  const db = supabase();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
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

  const bytes = await file.arrayBuffer();
  try {
    await r2Bucket().put(row.r2_key, bytes, {
      httpMetadata: { contentType: row.mime_type ?? file.type ?? "application/octet-stream" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `R2 write failed: ${msg}` }, { status: 502 });
  }

  const { data, error } = await db
    .from("library_items")
    .update({ file_size_bytes: bytes.byteLength })
    .eq("id", fileId)
    .is("notebook_id", null)
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "File not found" }, { status: 404 });
  return NextResponse.json(data);
}
