import { backendJson } from "@/lib/server-api";
import type { Notebook } from "@/lib/api";
import NotebooksView from "./NotebooksView";

// Reads live data on every request — never prerender at build time.
export const dynamic = "force-dynamic";

// The notebook list is read here, on the server, so the cards come with the
// HTML. loading.tsx streams the skeleton first while this request runs.
export default async function NotebookLMPage() {
  const all = await backendJson<Notebook[]>("/api/notebooks");
  // Untitled notebooks are NotebookLM placeholders; the view hides them too.
  return <NotebooksView initialNotebooks={all ? all.filter((n) => n.title?.trim()) : null} />;
}
