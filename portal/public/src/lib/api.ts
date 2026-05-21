// Public Research Portal — API client (read-only).
//
// This app is view-only. `/api/*` is served by this app's own route handlers
// (src/app/api/**), which query Supabase directly and stream files from R2.
// There is no backend, no NotebookLM RPC, and no write/chat endpoints.
const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

// ---- Library Notebooks ("My Research" folios) ----

export const getLibraryNotebooks = (opts?: { includeHidden?: boolean; tags?: string[] }) => {
  const params = new URLSearchParams();
  if (opts?.includeHidden) params.set("include_hidden", "true");
  for (const t of opts?.tags ?? []) params.append("tag", t);
  const qs = params.toString();
  return request<LibraryNotebookListResponse>(`/api/library-notebooks${qs ? `?${qs}` : ""}`);
};

export const getLibraryNotebook = (id: string) =>
  request<LibraryNotebook>(`/api/library-notebooks/${id}`);

export const getLibraryNotebookFiles = (id: string, params?: { category?: string }) => {
  const q = params?.category ? `?category=${encodeURIComponent(params.category)}` : "";
  return request<LibraryFile[]>(`/api/library-notebooks/${id}/files${q}`);
};

export async function getLibraryFileContent(notebookId: string, fileId: string): Promise<string> {
  const res = await fetch(`${BASE}/api/library-notebooks/${notebookId}/files/${fileId}/content`);
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.text();
}

/** Raw bytes — for client-side renderers (docx-preview, SheetJS, etc). */
export async function getLibraryFileBlob(notebookId: string, fileId: string): Promise<ArrayBuffer> {
  const res = await fetch(`${BASE}/api/library-notebooks/${notebookId}/files/${fileId}/content`);
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.arrayBuffer();
}

// ---- Artifacts (saved NotebookLM corpus) ----

export const getArtifacts = (params: Record<string, string | number> = {}) => {
  const q = new URLSearchParams(params as Record<string, string>).toString();
  return request<ArtifactListResponse>(`/api/artifacts${q ? `?${q}` : ""}`);
};

export async function getArtifactContent(id: string): Promise<string> {
  const res = await fetch(`${BASE}/api/artifacts/${id}/content`);
  if (!res.ok) throw new Error(`API ${res.status}`);
  const buf = await res.arrayBuffer();
  return new TextDecoder("utf-8").decode(buf);
}

// ---- Types ----

export interface LibraryNotebook {
  id: string;
  title: string;
  description: string;
  cover_emoji: string | null;
  hidden: boolean;
  tags: string[];
  file_count: number;
  created_at: string;
  updated_at: string;
}

export interface LibraryFile {
  id: string;
  title: string;
  description: string;
  original_name: string;
  mime_type: string | null;
  file_ext: string | null;
  file_category: string;
  r2_url: string | null;
  file_size_bytes: number | null;
  notebook_id: string;
  added_at: string;
  last_modified: string | null;
}

export interface LibraryNotebookListResponse {
  items: LibraryNotebook[];
  total: number;
}

export interface NLMArtifact {
  id: string;
  nlm_artifact_id: string;
  notebook_id: string | null;
  notebook_title: string | null;
  artifact_type: string;
  file_format: string;
  title: string;
  summary: string;
  r2_url: string | null;
  file_size_bytes: number | null;
  download_status: "pending" | "downloading" | "done" | "failed";
  downloaded_at: string | null;
  download_error: string | null;
  nlm_created_at: string | null;
  portal_added_at: string;
  tags: string[];
  notes: string;
  library_item_id: string | null;
}

export interface ArtifactListResponse {
  items: NLMArtifact[];
  total: number;
}
