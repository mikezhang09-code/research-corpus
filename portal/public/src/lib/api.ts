// Public Research Portal — API client.
//
// `/api/*` is served by this app's own route handlers (src/app/api/**),
// which query Supabase directly and read/write files in R2. "My Research"
// folios are fully editable here; the "NotebookLM Corpus" stays read-only,
// and there is no chat — that lives on the private Tailscale portal.
const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: init?.body
      ? { "Content-Type": "application/json", ...init.headers }
      : init?.headers,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  if (res.status === 204) return undefined as T;
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

/** Content URL for a folio file, or a free-form file when notebookId is null. */
function fileContentPath(notebookId: string | null, fileId: string): string {
  return notebookId
    ? `/api/library-notebooks/${notebookId}/files/${fileId}/content`
    : `/api/free-forms/${fileId}/content`;
}

export async function getLibraryFileContent(notebookId: string | null, fileId: string): Promise<string> {
  const res = await fetch(`${BASE}${fileContentPath(notebookId, fileId)}`);
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.text();
}

/** Raw bytes — for client-side renderers (docx-preview, SheetJS, etc). */
export async function getLibraryFileBlob(notebookId: string | null, fileId: string): Promise<ArrayBuffer> {
  const res = await fetch(`${BASE}${fileContentPath(notebookId, fileId)}`);
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.arrayBuffer();
}

// ---- Library Notebooks — write ops ----

export const createLibraryNotebook = (data: {
  title: string;
  cover_emoji?: string | null;
  tags?: string[];
}) =>
  request<LibraryNotebook>("/api/library-notebooks", {
    method: "POST",
    body: JSON.stringify(data),
  });

export const updateLibraryNotebook = (
  id: string,
  data: {
    title?: string;
    description?: string;
    cover_emoji?: string | null;
    tags?: string[];
  },
) =>
  request<LibraryNotebook>(`/api/library-notebooks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });

export const deleteLibraryNotebook = (id: string) =>
  request<void>(`/api/library-notebooks/${id}`, { method: "DELETE" });

export async function uploadLibraryNotebookFile(
  notebookId: string,
  file: File,
  category: string,
  title?: string,
): Promise<LibraryFile> {
  const form = new FormData();
  form.append("file", file);
  form.append("category", category);
  if (title) form.append("title", title);
  const res = await fetch(`${BASE}/api/library-notebooks/${notebookId}/files/upload`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

export const updateLibraryNotebookFile = (
  notebookId: string,
  fileId: string,
  patch: { title?: string; description?: string; file_category?: string },
) =>
  request<LibraryFile>(`/api/library-notebooks/${notebookId}/files/${fileId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

export const deleteLibraryNotebookFiles = (notebookId: string, fileIds: string[]) =>
  request<void>(`/api/library-notebooks/${notebookId}/files/bulk-delete`, {
    method: "POST",
    body: JSON.stringify({ file_ids: fileIds }),
  });

export const createLibraryNotebookFromFiles = (
  notebookId: string,
  data: {
    title: string;
    cover_emoji?: string | null;
    tags?: string[];
    file_ids: string[];
  },
) =>
  request<LibraryNotebook>(`/api/library-notebooks/${notebookId}/files/move-to-new-notebook`, {
    method: "POST",
    body: JSON.stringify(data),
  });

/** Overwrite a stored text file's contents — used by the note editor. */
export const saveLibraryNoteContent = (
  notebookId: string,
  fileId: string,
  content: string,
) =>
  request<LibraryFile>(
    `/api/library-notebooks/${notebookId}/files/${fileId}/content`,
    { method: "PUT", body: JSON.stringify({ content }) },
  );

export const deleteLibraryNotebookFile = (notebookId: string, fileId: string) =>
  request<void>(`/api/library-notebooks/${notebookId}/files/${fileId}`, {
    method: "DELETE",
  });

// ---- Free Forms ----
// Standalone files that belong to no folio (library_items with notebook_id NULL).

export interface FreeFormFile {
  id: string;
  title: string;
  description: string;
  original_name: string;
  mime_type: string | null;
  file_ext: string | null;
  file_category: string;
  r2_url: string | null;
  file_size_bytes: number | null;
  tags: string[];
  added_at: string;
  last_modified: string | null;
}

export const getFreeFormFiles = () => request<FreeFormFile[]>("/api/free-forms");

export async function uploadFreeFormFile(
  file: File,
  category: string,
  title?: string,
  tags?: string[]
): Promise<FreeFormFile> {
  const form = new FormData();
  form.append("file", file);
  form.append("category", category);
  if (title) form.append("title", title);
  if (tags && tags.length > 0) form.append("tags", tags.join(","));
  const res = await fetch(`${BASE}/api/free-forms/upload`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

export const updateFreeFormFile = (
  fileId: string,
  patch: { title?: string; description?: string; file_category?: string; tags?: string[] },
) =>
  request<FreeFormFile>(`/api/free-forms/${fileId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

export const deleteFreeFormFile = (fileId: string) =>
  request<void>(`/api/free-forms/${fileId}`, { method: "DELETE" });

/** Overwrite a stored text file's contents — used by the note editor. */
export const saveFreeFormNoteContent = (fileId: string, content: string) =>
  request<FreeFormFile>(`/api/free-forms/${fileId}/content`, {
    method: "PUT",
    body: JSON.stringify({ content }),
  });

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
