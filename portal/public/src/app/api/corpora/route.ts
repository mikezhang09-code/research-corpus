import { NextResponse } from "next/server";
import { listCorpora } from "@/lib/server-data";

export const dynamic = "force-dynamic";

// GET /api/corpora  → { items: Corpus[] }  — saved artifacts grouped by notebook.
export async function GET() {
  try {
    return NextResponse.json({ items: await listCorpora() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
