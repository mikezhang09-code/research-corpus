import { type NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET /api/free-forms?category=  → FreeFormFile[]
// Standalone files: library_items with notebook_id IS NULL.
export async function GET(req: NextRequest) {
  const db = supabase();
  const category = new URL(req.url).searchParams.get("category");

  let q = db.from("library_items").select("*").is("notebook_id", null);
  if (category) q = q.eq("file_category", category);
  const { data, error } = await q.order("added_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data ?? []);
}
