import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { r2Bucket } from "@/lib/r2";

export const dynamic = "force-dynamic";

async function fileCount(
  db: ReturnType<typeof supabase>,
  id: string,
): Promise<number> {
  const { count } = await db
    .from("library_items")
    .select("id", { count: "exact", head: true })
    .eq("notebook_id", id);
  return count ?? 0;
}

// GET /api/library-notebooks/{id}  → LibraryNotebook
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = supabase();

  const { data, error } = await db
    .from("library_notebooks")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ ...data, file_count: await fileCount(db, id) });
}

// PATCH /api/library-notebooks/{id}  → rename / edit description / tags
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = supabase();
  let body: { title?: string; description?: string; cover_emoji?: string | null; tags?: string[] };
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
  if (body.cover_emoji !== undefined) patch.cover_emoji = body.cover_emoji;
  if (body.tags !== undefined) patch.tags = body.tags;

  if (Object.keys(patch).length === 0) {
    return GET(req, { params });
  }

  patch.updated_at = new Date().toISOString();
  const { data, error } = await db
    .from("library_notebooks")
    .update(patch)
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ ...data, file_count: await fileCount(db, id) });
}

// DELETE /api/library-notebooks/{id}  → delete folio + all its R2 objects
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = supabase();

  // Remove R2 objects for every file before the DB cascade drops the rows.
  const { data: files } = await db
    .from("library_items")
    .select("r2_key")
    .eq("notebook_id", id);
  const keys = ((files ?? []) as { r2_key: string | null }[])
    .map((f) => f.r2_key)
    .filter((k): k is string => !!k);
  if (keys.length) {
    try {
      await r2Bucket().delete(keys);
    } catch {
      // Best-effort, matching the backend — a stale object must not block
      // the folio delete.
    }
  }

  const { error } = await db.from("library_notebooks").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
