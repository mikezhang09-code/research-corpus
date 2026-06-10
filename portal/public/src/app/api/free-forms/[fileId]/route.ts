import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { r2Bucket } from "@/lib/r2";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ fileId: string }> };

// PATCH /api/free-forms/{fileId}  → rename / recategorise / retag
// The IS NULL guard keeps these handlers from ever touching folio files.
export async function PATCH(req: Request, { params }: RouteParams) {
  const { fileId } = await params;
  const db = supabase();
  let body: { title?: string; description?: string; file_category?: string; tags?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (body.title !== undefined) {
    const t = body.title.trim();
    if (!t) return NextResponse.json({ error: "title cannot be empty" }, { status: 400 });
    patch.title = t;
  }
  if (body.description !== undefined) patch.description = body.description;
  if (body.file_category !== undefined) {
    patch.file_category = body.file_category.trim() || "other";
  }
  if (body.tags !== undefined) {
    patch.tags = body.tags.map((t) => t.trim()).filter(Boolean);
  }

  const q = db.from("library_items");
  const { data, error } =
    Object.keys(patch).length === 0
      ? await q.select("*").eq("id", fileId).is("notebook_id", null).maybeSingle()
      : await q.update(patch).eq("id", fileId).is("notebook_id", null).select().maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "File not found" }, { status: 404 });
  return NextResponse.json(data);
}

// DELETE /api/free-forms/{fileId}
export async function DELETE(_req: Request, { params }: RouteParams) {
  const { fileId } = await params;
  const db = supabase();

  const { data: f } = await db
    .from("library_items")
    .select("r2_key")
    .eq("id", fileId)
    .is("notebook_id", null)
    .maybeSingle();
  if (!f) return NextResponse.json({ error: "File not found" }, { status: 404 });

  const key = (f as { r2_key: string | null }).r2_key;
  if (key) {
    try {
      await r2Bucket().delete(key);
    } catch {
      // Best-effort — a stale object must not block the row delete.
    }
  }

  const { error } = await db
    .from("library_items")
    .delete()
    .eq("id", fileId)
    .is("notebook_id", null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
