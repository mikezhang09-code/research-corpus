import { NextResponse } from "next/server";
import { supabase, streamR2 } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET /api/library-notebooks/{id}/files/{fileId}/content  → raw file bytes
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const { id, fileId } = await params;
  const db = supabase();

  const { data, error } = await db
    .from("library_items")
    .select("r2_url")
    .eq("id", fileId)
    .eq("notebook_id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "File not found" }, { status: 404 });

  return streamR2((data as { r2_url: string | null }).r2_url);
}
