import { type NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { r2Bucket, r2KeyForUpload, r2PublicUrl } from "@/lib/r2";
import { detectCategory } from "@/components/library/file-categories";

export const dynamic = "force-dynamic";

// POST /api/library-notebooks/{id}/files/upload  (multipart/form-data)
// Mirrors upload_notebook_file() in portal/backend/routers/library_notebooks.py.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
  const category = ((form.get("category") as string | null) ?? "").trim();
  const titleField = ((form.get("title") as string | null) ?? "").trim();

  const filename = file.name || "upload";
  const itemId = crypto.randomUUID();
  const dot = filename.lastIndexOf(".");
  const ext = dot > 0 ? filename.slice(dot).toLowerCase() : "";
  const mime = file.type || "application/octet-stream";
  const r2Key = r2KeyForUpload(itemId, filename);

  const bytes = await file.arrayBuffer();
  try {
    await r2Bucket().put(r2Key, bytes, { httpMetadata: { contentType: mime } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `R2 upload failed: ${msg}` }, { status: 502 });
  }

  const row = {
    id: itemId,
    title: titleField || filename,
    description: "",
    source_type: "upload",
    original_name: filename,
    mime_type: mime,
    file_ext: ext || null,
    file_category: category || detectCategory(filename),
    r2_key: r2Key,
    r2_url: r2PublicUrl(r2Key),
    file_size_bytes: bytes.byteLength,
    is_link_only: false,
    tags: [] as string[],
    notebook_id: id,
  };
  const { data, error } = await db.from("library_items").insert(row).select().single();
  if (error) {
    // Roll back the orphaned R2 object so a failed insert leaves no litter.
    try {
      await r2Bucket().delete(r2Key);
    } catch {
      /* best-effort */
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}
