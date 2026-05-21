import { NextResponse } from "next/server";
import { supabase, streamR2 } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// GET /api/artifacts/{id}/content  → raw artifact bytes
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = supabase();

  const { data, error } = await db
    .from("nlm_artifacts")
    .select("r2_url")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Artifact not found" }, { status: 404 });

  return streamR2((data as { r2_url: string | null }).r2_url);
}
