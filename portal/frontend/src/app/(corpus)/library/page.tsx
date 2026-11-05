import { backendJson } from "@/lib/server-api";
import type { LibraryNotebookListResponse } from "@/lib/api";
import LibraryView from "./LibraryView";

// Reads live data on every request — never prerender at build time.
export const dynamic = "force-dynamic";

// The folio list is read here, on the server, so the cards come with the HTML.
// loading.tsx streams the skeleton first while this request runs.
export default async function LibraryPage() {
  const res = await backendJson<LibraryNotebookListResponse>("/api/library-notebooks");
  return <LibraryView initialFolios={res?.items ?? null} />;
}
