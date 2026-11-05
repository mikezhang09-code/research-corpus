import { type NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { AUTH_COOKIE, requestRole } from "@/lib/auth";
import { listFolios } from "@/lib/server-data";

export const dynamic = "force-dynamic";

// GET /api/library-notebooks?include_hidden=&tag=  → { items, total }
// A viewer only ever gets non-hidden folios tagged SHARED_TAG.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const role = await requestRole(req.headers.get("host"), req.cookies.get(AUTH_COOKIE)?.value);
  try {
    const items = await listFolios({
      viewer: role === "viewer",
      includeHidden: url.searchParams.get("include_hidden") === "true",
      tags: url.searchParams.getAll("tag"),
    });
    return NextResponse.json({ items, total: items.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

// POST /api/library-notebooks  → create a folio
export async function POST(req: NextRequest) {
  const db = supabase();
  let body: { title?: string; cover_emoji?: string | null; tags?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const title = (body.title ?? "").trim();
  if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });

  const row: Record<string, unknown> = { title };
  if (body.cover_emoji) row.cover_emoji = body.cover_emoji;
  if (body.tags?.length) row.tags = body.tags;

  const { data, error } = await db
    .from("library_notebooks")
    .insert(row)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ...data, file_count: 0 }, { status: 201 });
}
