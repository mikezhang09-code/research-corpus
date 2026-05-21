import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

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

  const { count } = await db
    .from("library_items")
    .select("id", { count: "exact", head: true })
    .eq("notebook_id", id);

  return NextResponse.json({ ...data, file_count: count ?? 0 });
}
