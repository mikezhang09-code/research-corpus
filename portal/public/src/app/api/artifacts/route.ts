import { type NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET /api/artifacts?notebook_id=&artifact_type=&tag=&search=&limit=&offset=
//   → { items, total }
export async function GET(req: NextRequest) {
  const db = supabase();
  const sp = new URL(req.url).searchParams;
  const limit = Math.min(Number(sp.get("limit") ?? 50) || 50, 500);
  const offset = Number(sp.get("offset") ?? 0) || 0;

  let q = db.from("nlm_artifacts").select("*", { count: "exact" });
  const notebookId = sp.get("notebook_id");
  const artifactType = sp.get("artifact_type");
  const tag = sp.get("tag");
  const search = sp.get("search");
  if (notebookId) q = q.eq("notebook_id", notebookId);
  if (artifactType) q = q.eq("artifact_type", artifactType);
  if (tag) q = q.contains("tags", [tag]);
  if (search) q = q.ilike("title", `%${search}%`);

  const { data, error, count } = await q
    .order("portal_added_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ items: data ?? [], total: count ?? 0 });
}
