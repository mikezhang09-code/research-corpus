"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowLeft, Music, Video, FileText, Brain, StickyNote,
  Image, Layers, BarChart2, Database, CheckCircle2,
  Loader2, AlertCircle, ExternalLink, RefreshCw, X, Plus, Sparkles, MessageSquare,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getLiveArtifacts, getArtifactContent, saveArtifact, type LiveArtifact } from "@/lib/api";
import { GenerateActionSheet } from "@/components/generate/GenerateActionSheet";
import { GenerateModal } from "@/components/generate/GenerateModal";
import { SourcesPanel } from "@/components/notebook/SourcesPanel";
import { ChatPanel } from "@/components/notebook/ChatPanel";
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
  const cfg = TYPE_CONFIG[artifact.artifact_type] ?? DEFAULT_CONFIG;
  const Icon = cfg.icon;

  const created = artifact.created_at
    ? new Date(artifact.created_at).toLocaleDateString("en-US", {
        month: "short", day: "numeric", year: "numeric",
      })
    : null;

  const isMarkdown = artifact.file_format === "md";

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
                <ChatPanel notebookId={notebookId} />
              </div>
            </TabsContent>
          )}
        </Tabs>
      </div>

      {/* Right column: chat panel (desktop only) */}
      {!isMobile && (
        <div className="w-[400px] shrink-0 h-full sticky top-0">
          <ChatPanel notebookId={notebookId} />
        </div>
      )}
    </div>
  );
}
