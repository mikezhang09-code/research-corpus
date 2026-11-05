import { cookies, headers } from "next/headers";
import { AUTH_COOKIE, requestRole } from "@/lib/auth";
import { listFolios } from "@/lib/server-data";
import LibraryView from "./LibraryView";

// Reads live data on every request — never prerender at build time.
export const dynamic = "force-dynamic";

// The folio list is read here, on the server, so the cards come with the HTML.
// loading.tsx streams the skeleton first while this query runs.
export default async function LibraryPage() {
  const host = (await headers()).get("host");
  const cookie = (await cookies()).get(AUTH_COOKIE)?.value;
  // Same rule as the (corpus) layout: no role only under `next dev`, as admin.
  const role = (await requestRole(host, cookie)) ?? "admin";
  const initialFolios = await listFolios({ viewer: role === "viewer" }).catch((e) => {
    console.error("listFolios failed; the page will fetch on the client", e);
    return null;
  });
  return <LibraryView initialFolios={initialFolios} />;
}
