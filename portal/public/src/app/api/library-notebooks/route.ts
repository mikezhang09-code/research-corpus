import { type NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET /api/library-notebooks?include_hidden=&tag=  → { items, total }
export async function GET(req: NextRequest) {
  const db = supabase();
  const url = new URL(req.url);
  const includeHidden = url.searchParams.get("include_hidden") === "true";
  const tags = url.searchParams.getAll("tag");

  let q = db.from("library_notebooks").select("*");
  if (!includeHidden) q = q.eq("hidden", false);
  if (tags.length) q = q.contains("tags", tags);
  const { data, error } = await q.order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // file_count per notebook (one cheap scan of library_items.notebook_id).
  const { data: fileRows } = await db
    .from("library_items")
    .select("notebook_id")
    .not("notebook_id", "is", null);
  const counts = new Map<string, number>();
  for (const r of (fileRows ?? []) as { notebook_id: string }[]) {
    counts.set(r.notebook_id, (counts.get(r.notebook_id) ?? 0) + 1);
  }

  const items = ((data ?? []) as { id: string }[]).map((n) => ({
    ...n,
    file_count: counts.get(n.id) ?? 0,
  }));
  return NextResponse.json({ items, total: items.length });
}
