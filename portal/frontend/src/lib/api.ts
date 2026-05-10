// Empty string → relative URL → Next.js rewrites proxy to the FastAPI backend.
// Set NEXT_PUBLIC_API_URL only if you need to override (e.g. staging).
const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ---- Notebooks ----
export const getNotebooks = () => request<Notebook[]>("/api/notebooks");
export const syncNotebooks = () => request<Notebook[]>("/api/notebooks/sync", { method: "POST" });
export const createNotebook = (title: string) =>
  request<Notebook>("/api/notebooks", { method: "POST", body: JSON.stringify({ title }) });

// ---- Sources ----
export const listSources = (notebookId: string) =>
  request<SourceRead[]>(`/api/notebooks/${notebookId}/sources`);
export const addSourceUrl = (notebookId: string, url: string) =>
  request<SourceRead>(`/api/notebooks/${notebookId}/sources/url`, {
    method: "POST", body: JSON.stringify({ url }),
  });
export const addSourceText = (notebookId: string, title: string, content: string) =>
  request<SourceRead>(`/api/notebooks/${notebookId}/sources/text`, {
    method: "POST", body: JSON.stringify({ title, content }),
  });
export async function addSourceFile(notebookId: string, file: File): Promise<SourceRead> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE}/api/notebooks/${notebookId}/sources/file`, {
    method: "POST", body: form,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}
export const getLiveArtifacts = (notebookId: string) =>
  request<LiveArtifactsResponse>(`/api/notebooks/${notebookId}/live-artifacts`);
export const generateArtifact = (notebookId: string, data: GenerateRequest) =>
  request<LiveArtifact>(`/api/notebooks/${notebookId}/generate`, {
    method: "POST",
    body: JSON.stringify(data),
  });

// ---- Chat ----
export const askChat = (
  notebookId: string,
  question: string,
  opts?: { conversationId?: string }
) =>
  request<ChatResponse>(`/api/notebooks/${notebookId}/chat`, {
    method: "POST",
    body: JSON.stringify({ question, conversation_id: opts?.conversationId ?? null }),
  });

export const getChatHistory = (notebookId: string, opts?: { conversationId?: string }) => {
  const params = new URLSearchParams();
  if (opts?.conversationId) params.set("conversation_id", opts.conversationId);
  const qs = params.toString();
  return request<ChatHistoryResponse>(
    `/api/notebooks/${notebookId}/chat/history${qs ? `?${qs}` : ""}`
  );
};

export const saveArtifact = (data: {
  nlm_artifact_id: string;
  notebook_id: string;
  notebook_title?: string | null;
  artifact_type: string;
  file_format: string;
  title: string;
  nlm_created_at?: string | null;
}) => request<NLMArtifact>("/api/artifacts", { method: "POST", body: JSON.stringify(data) });

// ---- Artifacts ----
export const getArtifacts = (params: Record<string, string | number> = {}) => {
  const q = new URLSearchParams(params as Record<string, string>).toString();
  return request<ArtifactListResponse>(`/api/artifacts${q ? `?${q}` : ""}`);
};
export const updateArtifact = (id: string, data: Partial<NLMArtifact>) =>
  request<NLMArtifact>(`/api/artifacts/${id}`, { method: "PATCH", body: JSON.stringify(data) });
export const deleteArtifact = (id: string) =>
  request<void>(`/api/artifacts/${id}`, { method: "DELETE" });
export async function getArtifactContent(id: string): Promise<string> {
  const res = await fetch(`${BASE}/api/artifacts/${id}/content`);
  if (!res.ok) throw new Error(`API ${res.status}`);
  const buf = await res.arrayBuffer();
  return new TextDecoder("utf-8").decode(buf);
}

export const retryDownload = (id: string) =>
  request<NLMArtifact>(`/api/artifacts/${id}/retry-download`, { method: "POST" });
export const saveToLibrary = (id: string) =>
  request<{ library_item_id: string }>(`/api/artifacts/${id}/save-to-library`, { method: "POST" });

// ---- Library ----
export const getLibraryItems = (params: Record<string, string | number> = {}) => {
  const q = new URLSearchParams(params as Record<string, string>).toString();
  return request<LibraryListResponse>(`/api/library${q ? `?${q}` : ""}`);
};
export const getCollections = () => request<string[]>("/api/library/collections");
export const updateLibraryItem = (id: string, data: Partial<LibraryItem>) =>
  request<LibraryItem>(`/api/library/${id}`, { method: "PATCH", body: JSON.stringify(data) });
export const deleteLibraryItem = (id: string) =>
  request<void>(`/api/library/${id}`, { method: "DELETE" });
export const addLink = (data: Partial<LibraryItem>) =>
  request<LibraryItem>("/api/library/link", { method: "POST", body: JSON.stringify(data) });

// ---- Types ----

export interface LiveArtifact {
  nlm_id: string;
  title: string;
  artifact_type: string;
  file_format: string;
  created_at: string | null;
  is_completed: boolean;
  portal_id: string | null;
  download_status: "generating" | "pending" | "downloading" | "done" | "failed" | null;
  r2_url: string | null;
  download_error: string | null;
  /** True when the saved artifact is no longer present in NotebookLM
   *  (deleted in Google's UI), but we still have the file in R2. */
  only_in_portal?: boolean;
}

export interface GenerateRequest {
  artifact_type: string;
  description?: string;
  language?: string;
  // type-specific (each ignored if not relevant)
  audio_format?: string;
  audio_length?: string;
  video_format?: string;
  video_style?: string;
  report_format?: string;
  deck_format?: string;
  deck_length?: string;
  quiz_quantity?: string;
  quiz_difficulty?: string;
  info_orientation?: string;
  info_detail?: string;
  info_style?: string;
}

export interface LiveArtifactsResponse {
  notebook_id: string;
  notebook_title: string | null;
  artifacts: LiveArtifact[];
}

export interface Notebook {
  id: string;
  title: string;
  sources_count: number;
  is_owner: boolean;
  nlm_created_at: string | null;
  last_synced_at: string;
}

export interface SourceRead {
  id: string;
  title: string | null;
  url: string | null;
  kind: string;       // "pdf", "youtube", "web_page", etc.
  status: number;     // 1=processing, 2=ready, 3=error
  is_ready: boolean;
  is_processing: boolean;
  is_error: boolean;
  created_at: string | null;
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

export interface LibraryItem {
  id: string;
  title: string;
  description: string;
  source_type: "upload" | "drive" | "youtube_link" | "web_link";
  original_name: string;
  mime_type: string | null;
  file_ext: string | null;
  r2_url: string | null;
  file_size_bytes: number | null;
  is_link_only: boolean;
  external_url: string | null;
  drive_file_id: string | null;
  summary: string;
  tags: string[];
  collection: string | null;
  added_at: string;
  last_modified: string | null;
}

export interface LibraryListResponse {
  items: LibraryItem[];
  total: number;
}

export interface ChatReference {
  source_id: string;
  citation_number: number | null;
  cited_text: string | null;
}

export interface ChatResponse {
  answer: string;
  conversation_id: string;
  turn_number: number;
  is_follow_up: boolean;
  references: ChatReference[];
}

export interface ChatTurn {
  question: string;
  answer: string;
}

export interface ChatHistoryResponse {
  turns: ChatTurn[];
  conversation_id: string | null;
}
