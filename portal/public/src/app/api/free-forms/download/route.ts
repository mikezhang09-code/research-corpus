import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { buildZip, zipResponse } from "@/lib/zip";

export const dynamic = "force-dynamic";

type FileRow = {
  id: string;
  r2_key: string | null;
  original_name: string | null;
  title: string | null;
  file_ext: string | null;
};

// POST /api/free-forms/download  → zip of free-form files (notebook_id IS NULL).
// Body { ids?: string[] }; omit/empty ids = download them all.
export async function POST(req: Request) {
  const db = supabase();

  let body: { ids?: string[] } = {};
  try {
    body = await req.json();
  } catch {
    // empty/no body = download everything
  }
  const ids = [...new Set(body.ids ?? [])];

  let q = db
    .from("library_items")
    .select("id,r2_key,original_name,title,file_ext")
    .is("notebook_id", null);
  if (ids.length) q = q.in("id", ids);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const files = (data ?? []) as FileRow[];
  if (ids.length && files.length !== ids.length) {
    return NextResponse.json({ error: "One or more files were not found" }, { status: 404 });
  }

  const entries = files
    .filter((f) => f.r2_key)
    .map((f) => ({
      name: f.original_name || `${f.title || "file"}${f.file_ext || ""}`,
      key: f.r2_key as string,
    }));
  if (!entries.length) {
    return NextResponse.json({ error: "No downloadable files in this selection" }, { status: 404 });
  }

  return zipResponse(await buildZip(entries), "free-forms.zip");
}
