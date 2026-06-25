import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { buildZip, zipResponse } from "@/lib/zip";

export const dynamic = "force-dynamic";

type ArtifactRow = {
  id: string;
  title: string | null;
  notebook_title: string | null;
  artifact_type: string;
  file_format: string | null;
  download_status: string | null;
  r2_key: string | null;
};

// POST /api/artifacts/download  → zip of a notebook's SAVED artifacts (those
// downloaded to R2). Body { notebook_id, ids? }; omit/empty ids = all saved.
// Unsaved artifacts have no R2 file and are skipped; the count is returned in
// the `X-Skipped-Count` header so the UI can tell the user.
export async function POST(req: Request) {
  const db = supabase();

  let body: { notebook_id?: string; ids?: string[] } = {};
  try {
    body = await req.json();
  } catch {
    // empty/no body = all saved across the (required) notebook below
  }
  if (!body.notebook_id) {
    return NextResponse.json({ error: "notebook_id is required" }, { status: 400 });
  }
  const ids = [...new Set(body.ids ?? [])];

  let q = db.from("nlm_artifacts").select("*").eq("notebook_id", body.notebook_id);
  if (ids.length) q = q.in("id", ids);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as ArtifactRow[];
  if (ids.length && rows.length !== ids.length) {
    return NextResponse.json({ error: "One or more artifacts were not found" }, { status: 404 });
  }

  const saved = rows.filter((r) => r.download_status === "done" && r.r2_key);
  if (!saved.length) {
    return NextResponse.json(
      { error: "No saved artifacts to download — save them first" },
      { status: 404 },
    );
  }

  const entries = saved.map((r) => ({
    name: `${r.title || r.artifact_type}.${r.file_format || "bin"}`,
    key: r.r2_key as string,
  }));

  const title =
    rows.find((r) => r.notebook_title?.trim())?.notebook_title || "notebook";

  const resp = zipResponse(await buildZip(entries), `${title}.zip`);
  resp.headers.set("X-Skipped-Count", String(rows.length - saved.length));
  return resp;
}
