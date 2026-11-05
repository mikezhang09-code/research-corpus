import { listCorpora } from "@/lib/server-data";
import CorpusView from "./CorpusView";

// Reads live data on every request — never prerender at build time.
export const dynamic = "force-dynamic";

// Saved artifacts are grouped by notebook here, on the server, so the cards
// come with the HTML. loading.tsx streams the skeleton first.
export default async function NotebookLMCorpusPage() {
  const initialCorpora = await listCorpora().catch((e) => {
    console.error("listCorpora failed; the page will fetch on the client", e);
    return null;
  });
  return <CorpusView initialCorpora={initialCorpora} />;
}
