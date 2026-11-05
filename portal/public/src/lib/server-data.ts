// Server-side reads shared by the API routes and the server-rendered pages.
//
// Server-only: it uses the service-role Supabase client. Import it from route
// handlers and server components, never from a "use client" module.
//
// Each function is written to cost as few Supabase round trips as possible —
// on Cloudflare every query is a network hop from the Worker to the Supabase
// region, so round trips, not rows, are what make pages slow.

import { supabase } from "./supabase";
import { SHARED_TAG } from "./shared-tag";
import type { LibraryNotebook } from "./api";

type Db = ReturnType<typeof supabase>;

// ---- folios ----

/** `library_items(count)` comes back as `[{ count: n }]`; flatten it. */
function withFileCount(row: Record<string, unknown>): LibraryNotebook {
  const { library_items, ...rest } = row as Record<string, unknown> & {
    library_items?: { count: number }[];
  };
  return { ...(rest as unknown as Omit<LibraryNotebook, "file_count">), file_count: library_items?.[0]?.count ?? 0 };
}

/**
 * Folios, newest first, each with its file count — one query. The count is an
 * embedded aggregate over the library_items → library_notebooks foreign key.
 * (It used to be a second query fetching every file row to count in JS, which
 * also undercounted once all folios together held more than PostgREST's
 * 1,000-row cap.)
 */
export async function listFolios(opts: {
  viewer: boolean;
  includeHidden?: boolean;
  tags?: string[];
  db?: Db;
}): Promise<LibraryNotebook[]> {
  const db = opts.db ?? supabase();
  const includeHidden = !opts.viewer && !!opts.includeHidden;
  const tags = opts.viewer ? [SHARED_TAG] : (opts.tags ?? []);
  let q = db.from("library_notebooks").select("*, library_items(count)");
  if (!includeHidden) q = q.eq("hidden", false);
  if (tags.length) q = q.contains("tags", tags);
  const { data, error } = await q.order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(withFileCount);
}

/** One folio with its file count — one query. Null when it doesn't exist. */
export async function getFolio(id: string, db: Db = supabase()): Promise<LibraryNotebook | null> {
  const { data, error } = await db
    .from("library_notebooks")
    .select("*, library_items(count)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? withFileCount(data) : null;
}

// ---- NotebookLM corpora ----

/** One NotebookLM notebook, as summarised from its saved artifacts. */
export interface Corpus {
  notebookId: string;
  title: string;
  count: number;
  /** ISO date of the most recent artifact. */
  latest: string;
}

const CORPUS_PAGE = 1000; // PostgREST's default max-rows on Supabase

/**
 * Saved artifacts grouped by notebook, done here instead of in the browser.
 * Only the four columns the cards need are read, a page at a time, so every
 * artifact counts — the page used to fetch the newest 200 full rows (~1 KB
 * each, summaries included) and silently lost notebooks beyond them.
 */
export async function listCorpora(db: Db = supabase()): Promise<Corpus[]> {
  const map = new Map<string, Corpus>();
  for (let from = 0; ; from += CORPUS_PAGE) {
    const { data, error } = await db
      .from("nlm_artifacts")
      .select("notebook_id, notebook_title, nlm_created_at, portal_added_at")
      .not("notebook_id", "is", null)
      // Newest first, so a notebook's title comes from its latest artifact.
      .order("portal_added_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + CORPUS_PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as {
      notebook_id: string;
      notebook_title: string | null;
      nlm_created_at: string | null;
      portal_added_at: string | null;
    }[];
    for (const a of rows) {
      const date = a.nlm_created_at ?? a.portal_added_at ?? "";
      const hit = map.get(a.notebook_id);
      if (hit) {
        hit.count += 1;
        if (date > hit.latest) hit.latest = date;
      } else {
        map.set(a.notebook_id, {
          notebookId: a.notebook_id,
          title: a.notebook_title?.trim() || "Untitled notebook",
          count: 1,
          latest: date,
        });
      }
    }
    if (rows.length < CORPUS_PAGE) break;
  }
  return [...map.values()];
}

// ---- masthead counts ----

export interface ArchiveCounts {
  /** NotebookLM notebooks with at least one saved artifact (admin only). */
  corpora: number;
  /** Folios the caller can see. */
  folios: number;
}

/**
 * The masthead's "N corpora · M folios", as two row-less count queries run in
 * parallel. It used to download both full lists on every navigation.
 */
export async function countArchive(opts: { viewer: boolean; db?: Db }): Promise<ArchiveCounts> {
  const db = opts.db ?? supabase();
  let folioQ = db.from("library_notebooks").select("id", { count: "exact", head: true }).eq("hidden", false);
  if (opts.viewer) folioQ = folioQ.contains("tags", [SHARED_TAG]);
  const [corpora, folios] = await Promise.all([
    opts.viewer
      ? Promise.resolve({ count: 0, error: null })
      : // Notebooks that have ≥1 artifact: an inner join, counted, no rows returned.
        db.from("notebooks").select("id, nlm_artifacts!inner(id)", { count: "exact", head: true }),
    folioQ,
  ]);
  if (corpora.error) throw new Error(corpora.error.message);
  if (folios.error) throw new Error(folios.error.message);
  return { corpora: corpora.count ?? 0, folios: folios.count ?? 0 };
}
