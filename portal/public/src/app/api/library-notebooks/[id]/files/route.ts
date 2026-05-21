import { type NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET /api/library-notebooks/{id}/files?category=  → LibraryFile[]
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = supabase();
  const category = new URL(req.url).searchParams.get("category");

  let q = db.from("library_items").select("*").eq("notebook_id", id);
  if (category) q = q.eq("file_category", category);
  const { data, error } = await q.order("added_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data ?? []);
}
