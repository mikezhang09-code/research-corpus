import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { r2Bucket } from "@/lib/r2";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = supabase();
  let body: { file_ids?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const fileIds = [...new Set(body.file_ids ?? [])];
  if (fileIds.length === 0) return new NextResponse(null, { status: 204 });

  const { data: files, error: selectError } = await db
    .from("library_items")
    .select("id,r2_key")
    .eq("notebook_id", id)
    .in("id", fileIds);
  if (selectError) return NextResponse.json({ error: selectError.message }, { status: 500 });
  if ((files ?? []).length !== fileIds.length) {
    return NextResponse.json({ error: "One or more files were not found" }, { status: 404 });
  }

  const keys = ((files ?? []) as { r2_key: string | null }[])
    .map((f) => f.r2_key)
    .filter((k): k is string => !!k);
  if (keys.length) {
    try {
      await r2Bucket().delete(keys);
    } catch {
      void 0;
    }
  }

  const { error } = await db
    .from("library_items")
    .delete()
    .eq("notebook_id", id)
    .in("id", fileIds);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
