import { type NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, requestRole } from "@/lib/auth";
import { countArchive } from "@/lib/server-data";

export const dynamic = "force-dynamic";

// GET /api/counts  → { corpora, folios }  — the masthead's archive count.
// A viewer gets only the number of shared folios (corpora is 0).
export async function GET(req: NextRequest) {
  const role = await requestRole(req.headers.get("host"), req.cookies.get(AUTH_COOKIE)?.value);
  try {
    return NextResponse.json(await countArchive({ viewer: role === "viewer" }));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
