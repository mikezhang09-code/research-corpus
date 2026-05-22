import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { r2Bucket } from "@/lib/r2";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string; fileId: string }> };

// PATCH /api/library-notebooks/{id}/files/{fileId}  → rename / recategorise
export async function PATCH(req: Request, { params }: RouteParams) {
  const { id, fileId } = await params;
  const db = supabase();
  let body: { title?: string; description?: string; file_category?: string };
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

  const q = db.from("library_items");
  const { data, error } =
    Object.keys(patch).length === 0
      ? await q.select("*").eq("id", fileId).eq("notebook_id", id).maybeSingle()
      : await q.update(patch).eq("id", fileId).eq("notebook_id", id).select().maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "File not found" }, { status: 404 });
  return NextResponse.json(data);
}

// DELETE /api/library-notebooks/{id}/files/{fileId}
export async function DELETE(_req: Request, { params }: RouteParams) {
  const { id, fileId } = await params;
  const db = supabase();

  const { data: f } = await db
    .from("library_items")
    .select("r2_key")
    .eq("id", fileId)
    .eq("notebook_id", id)
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
    .eq("notebook_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
