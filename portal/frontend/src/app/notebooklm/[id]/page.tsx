"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowLeft, Music, Video, FileText, Brain, StickyNote,
  Image, Layers, BarChart2, Database, CheckCircle2,
  Loader2, AlertCircle, ExternalLink, RefreshCw, X, Plus, Sparkles, MessageSquare, ChevronRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getLiveArtifacts, getArtifactContent, saveArtifact, type LiveArtifact } from "@/lib/api";
import { GenerateActionSheet } from "@/components/generate/GenerateActionSheet";
import { GenerateModal } from "@/components/generate/GenerateModal";
import { SourcesPanel } from "@/components/notebook/SourcesPanel";
import { ChatPanel, type ChatPanelHandle } from "@/components/notebook/ChatPanel";
import { NotebookDescription } from "@/components/notebook/NotebookDescription";
import { useIsMobile } from "@/hooks/use-mobile";

// ---- Artifact type config ----

type ArtifactConfig = {
  icon: React.ElementType;
  bg: string;
  iconColor: string;
  label: string;
};

const TYPE_CONFIG: Record<string, ArtifactConfig> = {
  audio:      { icon: Music,    bg: "bg-purple-50",  iconColor: "text-purple-500",  label: "Audio Overview"  },
  video:      { icon: Video,    bg: "bg-blue-50",    iconColor: "text-blue-500",    label: "Video Overview"  },
  report:     { icon: FileText, bg: "bg-amber-50",   iconColor: "text-amber-500",   label: "Report"          },
  quiz:       { icon: Brain,    bg: "bg-green-50",   iconColor: "text-green-500",   label: "Quiz"            },
  flashcards: { icon: StickyNote, bg: "bg-teal-50",  iconColor: "text-teal-500",    label: "Flashcards"      },
  infographic:{ icon: Image,    bg: "bg-rose-50",    iconColor: "text-rose-500",    label: "Infographic"     },
  slide_deck: { icon: Layers,   bg: "bg-indigo-50",  iconColor: "text-indigo-500",  label: "Slide Deck"      },
  data_table: { icon: BarChart2,bg: "bg-orange-50",  iconColor: "text-orange-500",  label: "Data Table"      },
  mind_map:   { icon: Database, bg: "bg-cyan-50",    iconColor: "text-cyan-500",    label: "Mind Map"        },
};

const DEFAULT_CONFIG: ArtifactConfig = {
  icon: FileText, bg: "bg-muted", iconColor: "text-muted-foreground", label: "Artifact",
};

// ---- Markdown viewer modal ----

function MarkdownModal({ portalId, title, onClose }: {
  portalId: string;
  title: string;
  onClose: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getArtifactContent(portalId)
      .then(setContent)
      .catch((e) => setError(e.message));
  }, [portalId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-background rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <h2 className="font-semibold text-base line-clamp-1">{title}</h2>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1 px-8 py-6">
          {error ? (
            <div className="flex items-center gap-2 text-destructive text-sm">
              <AlertCircle className="h-4 w-4 shrink-0" />
              Failed to load: {error}
            </div>
          ) : content === null ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <div className="prose prose-sm max-w-none
              prose-headings:font-semibold prose-headings:tracking-tight
              prose-h1:text-xl prose-h2:text-lg prose-h3:text-base
              prose-p:leading-relaxed prose-p:text-foreground
              prose-strong:text-foreground prose-strong:font-semibold
              prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-code:font-mono
              prose-pre:bg-muted prose-pre:rounded-lg prose-pre:p-4
              prose-blockquote:border-l-4 prose-blockquote:border-border prose-blockquote:pl-4 prose-blockquote:text-muted-foreground
              prose-ul:list-disc prose-ol:list-decimal
              prose-li:text-foreground
              prose-table:text-sm prose-th:text-left prose-th:font-semibold
              prose-a:text-primary prose-a:underline">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {content}
              </ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- CSV table viewer modal ----

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cell += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { row.push(cell); cell = ""; }
      else if (ch === '\n') { row.push(cell); cell = ""; if (row.some(Boolean)) rows.push(row); row = []; }
      else if (ch !== '\r') cell += ch;
    }
  }
  if (cell || row.length > 0) { row.push(cell); if (row.some(Boolean)) rows.push(row); }
  return rows;
}

function CsvTableModal({ portalId, title, onClose }: {
  portalId: string;
  title: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<string[][] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getArtifactContent(portalId)
      .then((text) => setRows(parseCsv(text)))
      .catch((e) => setError(e.message));
  }, [portalId]);

  const headers = rows?.[0] ?? [];
  const dataRows = rows?.slice(1) ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-background rounded-2xl shadow-2xl w-full max-w-6xl max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <h2 className="font-semibold text-base line-clamp-1">{title}</h2>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="overflow-auto flex-1">
          {error ? (
            <div className="flex items-center gap-2 text-destructive text-sm p-6">
              <AlertCircle className="h-4 w-4 shrink-0" />
              Failed to load: {error}
            </div>
          ) : rows === null ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm p-6">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 z-10">
                <tr>
                  {headers.map((h, i) => (
                    <th
                      key={i}
                      className="px-4 py-3 text-left font-semibold text-xs uppercase tracking-wide bg-orange-50 text-orange-800 border-b border-orange-200 whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dataRows.map((row, ri) => (
                  <tr key={ri} className={ri % 2 === 0 ? "bg-background" : "bg-muted/40"}>
                    {headers.map((_, ci) => (
                      <td
                        key={ci}
                        className="px-4 py-3 align-top border-b border-border/50 text-sm leading-relaxed max-w-xs"
                      >
                        {row[ci] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-6 py-3 border-t shrink-0 flex items-center justify-between text-xs text-muted-foreground">
          <span>{dataRows.length} row{dataRows.length !== 1 ? "s" : ""} · {headers.length} column{headers.length !== 1 ? "s" : ""}</span>
        </div>
      </div>
    </div>
  );
}

// ---- Mind map viewer ----

const MM_NW = 180;
const MM_NH = 44;
const MM_HG = 40;
const MM_VG = 8;
const MM_PAD = 20;

type MindNode = { name?: string; title?: string; children?: MindNode[] };
type MmNode = { id: string; label: string; x: number; y: number; depth: number; hasChildren: boolean };
type MmEdge = { x1: number; y1: number; x2: number; y2: number };
type MmLayout = { nodes: MmNode[]; edges: MmEdge[]; width: number; height: number };

function buildMindLayout(root: MindNode, collapsed: Set<string>): MmLayout {
  const nodes: MmNode[] = [];
  const edges: MmEdge[] = [];

  function subtreeH(node: MindNode, id: string): number {
    if (!node.children?.length || collapsed.has(id)) return MM_NH;
    let h = (node.children.length - 1) * MM_VG;
    node.children.forEach((c, i) => { h += subtreeH(c, `${id}-${i}`); });
    return h;
  }

  function visit(node: MindNode, id: string, depth: number, yOff: number) {
    const h = subtreeH(node, id);
    const nx = MM_PAD + depth * (MM_NW + MM_HG);
    const ny = MM_PAD + yOff + (h - MM_NH) / 2;
    const hasChildren = !!node.children?.length;
    nodes.push({ id, label: node.name ?? node.title ?? "", x: nx, y: ny, depth, hasChildren });

    if (hasChildren && !collapsed.has(id)) {
      let cy = yOff;
      node.children!.forEach((child, i) => {
        const cid = `${id}-${i}`;
        const ch = subtreeH(child, cid);
        const cnx = MM_PAD + (depth + 1) * (MM_NW + MM_HG);
        const cny = MM_PAD + cy + (ch - MM_NH) / 2;
        edges.push({ x1: nx + MM_NW, y1: ny + MM_NH / 2, x2: cnx, y2: cny + MM_NH / 2 });
        visit(child, cid, depth + 1, cy);
        cy += ch + MM_VG;
      });
    }
  }

  visit(root, "root", 0, 0);
  const w = nodes.reduce((m, n) => Math.max(m, n.x + MM_NW), 0) + MM_PAD;
  const h = nodes.reduce((m, n) => Math.max(m, n.y + MM_NH), 0) + MM_PAD;
  return { nodes, edges, width: w, height: h };
}

const MM_NODE_COLORS = [
  "bg-blue-600 text-white border-blue-500",
  "bg-teal-500 text-white border-teal-400",
  "bg-teal-100 border-teal-300 text-teal-900",
  "bg-green-50 border-green-200 text-green-800",
];

function MindMapModal({ portalId, title, onClose }: {
  portalId: string;
  title: string;
  onClose: () => void;
}) {
  const [root, setRoot] = useState<MindNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    getArtifactContent(portalId)
      .then((text) => {
        try { setRoot(JSON.parse(text) as MindNode); }
        catch { setError("Invalid JSON"); }
      })
      .catch((e) => setError(e.message));
  }, [portalId]);

  const layout = useMemo(() => root ? buildMindLayout(root, collapsed) : null, [root, collapsed]);

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-background rounded-2xl shadow-2xl w-full max-w-7xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <h2 className="font-semibold text-base line-clamp-1">{title}</h2>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="overflow-auto flex-1 bg-slate-50/60">
          {error ? (
            <div className="flex items-center gap-2 text-destructive text-sm p-6">
              <AlertCircle className="h-4 w-4 shrink-0" />
              Failed to load: {error}
            </div>
          ) : !layout ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm p-6">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <div style={{ width: layout.width, height: layout.height, position: "relative" }}>
              <svg
                style={{
                  position: "absolute", top: 0, left: 0,
                  width: layout.width, height: layout.height,
                  pointerEvents: "none", overflow: "visible",
                }}
              >
                {layout.edges.map((e, i) => {
                  const mx = (e.x1 + e.x2) / 2;
                  return (
                    <path
                      key={i}
                      d={`M ${e.x1} ${e.y1} C ${mx} ${e.y1} ${mx} ${e.y2} ${e.x2} ${e.y2}`}
                      fill="none"
                      stroke="#94a3b8"
                      strokeWidth={1.5}
                    />
                  );
                })}
              </svg>

              {layout.nodes.map((n) => {
                const isCollapsed = collapsed.has(n.id);
                const color = MM_NODE_COLORS[Math.min(n.depth, 3)];
                return (
                  <div
                    key={n.id}
                    className={`absolute rounded-lg border px-3 flex items-center gap-1.5 shadow-sm leading-tight text-xs font-medium ${color} ${n.hasChildren ? "cursor-pointer hover:brightness-95 active:brightness-90" : ""}`}
                    style={{ left: n.x, top: n.y, width: MM_NW, height: MM_NH }}
                    onClick={() => n.hasChildren && toggle(n.id)}
                  >
                    <span className="flex-1 line-clamp-2">{n.label}</span>
                    {n.hasChildren && (
                      <ChevronRight
                        className={`h-3 w-3 shrink-0 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Artifact card ----

function ArtifactCard({
  artifact,
  notebookId,
  notebookTitle,
  onSaved,
}: {
  artifact: LiveArtifact;
  notebookId: string;
  notebookTitle: string | null;
  onSaved: (updated: Partial<LiveArtifact>) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [showMarkdown, setShowMarkdown] = useState(false);
  const [showCsv, setShowCsv] = useState(false);
  const [showMindMap, setShowMindMap] = useState(false);
  const cfg = TYPE_CONFIG[artifact.artifact_type] ?? DEFAULT_CONFIG;
  const Icon = cfg.icon;

  const created = artifact.created_at
    ? new Date(artifact.created_at).toLocaleDateString("en-US", {
        month: "short", day: "numeric", year: "numeric",
      })
    : null;

  const isMarkdown = artifact.file_format === "md";
  const isCsv = artifact.file_format === "csv";
  const isMindMap = artifact.artifact_type === "mind_map";

  async function handleSave() {
    setSaving(true);
    try {
      await saveArtifact({
        nlm_artifact_id: artifact.nlm_id,
        notebook_id: notebookId,
        notebook_title: notebookTitle,
        artifact_type: artifact.artifact_type,
        file_format: artifact.file_format,
        title: artifact.title,
        nlm_created_at: artifact.created_at,
      });
      onSaved({ download_status: "pending" });
    } finally {
      setSaving(false);
    }
  }

  const isSaved      = artifact.download_status !== null;
  const isDone       = artifact.download_status === "done";
  const isFailed     = artifact.download_status === "failed";
  const isGenerating = artifact.download_status === "generating";
  const isInProgress = artifact.download_status === "pending" || artifact.download_status === "downloading";

  return (
    <>
      {showMarkdown && artifact.portal_id && (
        <MarkdownModal
          portalId={artifact.portal_id}
          title={artifact.title}
          onClose={() => setShowMarkdown(false)}
        />
      )}
      {showCsv && artifact.portal_id && (
        <CsvTableModal
          portalId={artifact.portal_id}
          title={artifact.title}
          onClose={() => setShowCsv(false)}
        />
      )}
      {showMindMap && artifact.portal_id && (
        <MindMapModal
          portalId={artifact.portal_id}
          title={artifact.title}
          onClose={() => setShowMindMap(false)}
        />
      )}

      <div className="rounded-2xl overflow-hidden border border-border/50 bg-card shadow-sm hover:shadow-md transition-shadow">
        {/* Type header */}
        <div className={`${cfg.bg} flex flex-col items-center justify-center gap-2 py-8`}>
          <Icon className={`h-12 w-12 ${cfg.iconColor}`} />
          <span className={`text-xs font-semibold uppercase tracking-wider ${cfg.iconColor} opacity-80`}>
            {cfg.label}
          </span>
        </div>

        {/* Content */}
        <div className="p-4 flex flex-col gap-3">
          <div>
            <p className="font-semibold text-sm leading-snug line-clamp-2">{artifact.title}</p>
            {created && <p className="text-xs text-muted-foreground mt-1">{created}</p>}
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline" className="text-xs uppercase">{artifact.file_format}</Badge>
            {!artifact.is_completed && !artifact.only_in_portal && (
              <Badge variant="outline" className="text-xs text-amber-600 border-amber-200 bg-amber-50">
                Generating…
              </Badge>
            )}
            {artifact.only_in_portal && (
              <Badge variant="outline" className="text-xs text-slate-600 border-slate-300 bg-slate-50" title="Deleted in NotebookLM — preserved here in your portal">
                Only in portal
              </Badge>
            )}
          </div>

          {/* Action area */}
          <div className="mt-1">
            {!isSaved && artifact.is_completed && (
              <Button onClick={handleSave} disabled={saving} size="sm" className="w-full gap-2">
                {saving
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>
                  : "Save to database"}
              </Button>
            )}

            {isGenerating && (
              <div className="flex items-center justify-center gap-2 py-1.5 text-sm text-muted-foreground">
                <Sparkles className="h-4 w-4 animate-pulse text-primary" />
                <span>Generating in NotebookLM…</span>
              </div>
            )}

            {isInProgress && (
              <div className="flex items-center justify-center gap-2 py-1.5 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span>{artifact.download_status === "downloading" ? "Downloading…" : "Queued…"}</span>
              </div>
            )}

            {isDone && (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 text-emerald-600 text-sm font-medium flex-1">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  Saved
                </div>
                {isMarkdown ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 h-8 text-xs shrink-0"
                    onClick={() => setShowMarkdown(true)}
                  >
                    <FileText className="h-3 w-3" />
                    Read
                  </Button>
                ) : isCsv ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 h-8 text-xs shrink-0"
                    onClick={() => setShowCsv(true)}
                  >
                    <BarChart2 className="h-3 w-3" />
                    View
                  </Button>
                ) : isMindMap ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 h-8 text-xs shrink-0"
                    onClick={() => setShowMindMap(true)}
                  >
                    <Brain className="h-3 w-3" />
                    View
                  </Button>
                ) : artifact.r2_url ? (
                  <a href={artifact.r2_url} target="_blank" rel="noopener noreferrer" className="shrink-0">
                    <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs">
                      <ExternalLink className="h-3 w-3" />
                      View
                    </Button>
                  </a>
                ) : null}
              </div>
            )}

            {isFailed && (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 text-destructive text-xs flex-1 min-w-0">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span className="truncate" title={artifact.download_error ?? undefined}>Failed</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 h-8 text-xs shrink-0"
                  onClick={handleSave}
                  disabled={saving}
                >
                  <RefreshCw className="h-3 w-3" /> Retry
                </Button>
              </div>
            )}

            {!artifact.is_completed && !isSaved && (
              <p className="text-xs text-muted-foreground text-center py-1">
                Waiting for NotebookLM to finish generating
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ---- Page ----

export default function NotebookDetailPage() {
  const params = useParams();
  const router = useRouter();
  const notebookId = params.id as string;

  const [artifacts, setArtifacts] = useState<LiveArtifact[]>([]);
  const [notebookTitle, setNotebookTitle] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [generateType, setGenerateType] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatRef = useRef<ChatPanelHandle | null>(null);

  function handleAskTopic(prompt: string) {
    chatRef.current?.send(prompt);
  }

  useEffect(() => {
    loadArtifacts();
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, []);

  async function loadArtifacts(silent = false) {
    if (!silent) setRefreshing(true);
    try {
      const data = await getLiveArtifacts(notebookId);
      setArtifacts(data.artifacts);
      setNotebookTitle(data.notebook_title);

      const hasPending = data.artifacts.some(
        (a) => a.download_status === "generating"
            || a.download_status === "pending"
            || a.download_status === "downloading"
      );
      if (pollRef.current) clearTimeout(pollRef.current);
      if (hasPending) {
        pollRef.current = setTimeout(() => loadArtifacts(true), 5000);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  function handleSaved(nlmId: string, update: Partial<LiveArtifact>) {
    setArtifacts((prev) =>
      prev.map((a) => (a.nlm_id === nlmId ? { ...a, ...update } : a))
    );
    if (pollRef.current) clearTimeout(pollRef.current);
    pollRef.current = setTimeout(() => loadArtifacts(true), 5000);
  }

  const savedCount = artifacts.filter((a) => a.download_status === "done").length;
  const isMobile = useIsMobile();

  return (
    <div className="flex h-full min-h-0">
      {/* Left column */}
      <div className="flex-1 min-w-0 overflow-auto p-8 space-y-6">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 -ml-2 text-muted-foreground"
            onClick={() => router.push("/notebooklm")}
          >
            <ArrowLeft className="h-4 w-4" />
            Notebooks
          </Button>
        </div>

        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {notebookTitle ?? (loading ? "Loading…" : notebookId)}
          </h1>
          {!loading && (
            <p className="text-sm text-muted-foreground mt-1">
              {artifacts.length} artifact{artifacts.length !== 1 ? "s" : ""}
              {savedCount > 0 && ` · ${savedCount} saved`}
            </p>
          )}
        </div>

        {sheetOpen && (
          <GenerateActionSheet
            onPick={(t) => { setSheetOpen(false); setGenerateType(t); }}
            onClose={() => setSheetOpen(false)}
          />
        )}
        {generateType && (
          <GenerateModal
            artifactType={generateType}
            notebookId={notebookId}
            onClose={() => setGenerateType(null)}
            onGenerated={(artifact) => {
              setGenerateType(null);
              // Optimistic insert + immediate refresh; polling takes over.
              setArtifacts((prev) => [artifact, ...prev.filter((a) => a.nlm_id !== artifact.nlm_id)]);
              if (pollRef.current) clearTimeout(pollRef.current);
              pollRef.current = setTimeout(() => loadArtifacts(true), 3000);
            }}
          />
        )}

        <NotebookDescription notebookId={notebookId} onAskTopic={handleAskTopic} />

        <Tabs defaultValue="artifacts">
          <TabsList>
            <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
            <TabsTrigger value="sources">Sources</TabsTrigger>
            {isMobile && (
              <TabsTrigger value="chat">
                <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
                Chat
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="artifacts" className="mt-4 space-y-4">
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => loadArtifacts()}
                disabled={refreshing}
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                Refresh
              </Button>
              <Button size="sm" className="gap-2" onClick={() => setSheetOpen(true)}>
                <Plus className="h-4 w-4" />
                Generate
              </Button>
            </div>
            {loading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-64 rounded-2xl" />
                ))}
              </div>
            ) : artifacts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-muted-foreground gap-3">
                <FileText className="h-12 w-12 opacity-20" />
                <p className="font-medium">No artifacts yet</p>
                <p className="text-sm text-center max-w-xs">
                  Click <span className="font-medium">+ Generate</span> to create one, or generate one in NotebookLM and refresh.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {artifacts.map((a) => (
                  <ArtifactCard
                    key={a.nlm_id}
                    artifact={a}
                    notebookId={notebookId}
                    notebookTitle={notebookTitle}
                    onSaved={(update) => handleSaved(a.nlm_id, update)}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="sources" className="mt-4">
            <SourcesPanel notebookId={notebookId} />
          </TabsContent>

          {isMobile && (
            <TabsContent value="chat" className="mt-4">
              <div className="h-[calc(100vh-16rem)] rounded-xl overflow-hidden border">
                <ChatPanel ref={chatRef} notebookId={notebookId} />
              </div>
            </TabsContent>
          )}
        </Tabs>
      </div>

      {/* Right column: chat panel (desktop only) */}
      {!isMobile && (
        <div className="w-[400px] shrink-0 h-full sticky top-0">
          <ChatPanel ref={chatRef} notebookId={notebookId} />
        </div>
      )}
    </div>
  );
}
