import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

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

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = supabase();
  let body: { title?: string; cover_emoji?: string | null; tags?: string[]; file_ids?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const title = (body.title ?? "").trim();
  const fileIds = [...new Set(body.file_ids ?? [])];
  if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });
  if (fileIds.length === 0) return NextResponse.json({ error: "file_ids is required" }, { status: 400 });

  const { data: files, error: selectError } = await db
    .from("library_items")
    .select("id")
    .eq("notebook_id", id)
    .in("id", fileIds);
  if (selectError) return NextResponse.json({ error: selectError.message }, { status: 500 });
  if ((files ?? []).length !== fileIds.length) {
    return NextResponse.json({ error: "One or more files were not found" }, { status: 404 });
  }

  const row: Record<string, unknown> = { title };
  if (body.cover_emoji) row.cover_emoji = body.cover_emoji;
  if (body.tags?.length) row.tags = body.tags;

  const { data: notebook, error: createError } = await db
    .from("library_notebooks")
    .insert(row)
    .select()
    .single();
  if (createError) return NextResponse.json({ error: createError.message }, { status: 500 });

  const { error: moveError } = await db
    .from("library_items")
    .update({ notebook_id: notebook.id })
    .eq("notebook_id", id)
    .in("id", fileIds);
  if (moveError) return NextResponse.json({ error: moveError.message }, { status: 500 });

  return NextResponse.json(
    { ...notebook, file_count: await fileCount(db, notebook.id) },
    { status: 201 },
  );
}
