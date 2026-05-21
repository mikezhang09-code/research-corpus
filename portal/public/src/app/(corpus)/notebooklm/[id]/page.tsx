"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ExternalLink, Loader2, AlertCircle, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PresentationModal } from "@/components/corpus/PresentationModal";
import {
  TYPE_CONFIG,
  DEFAULT_CONFIG,
  MarkdownModal,
  CsvTableModal,
  MindMapModal,
  FlashcardsModal,
} from "@/components/notebook/artifact-viewers";
import { getArtifacts, type NLMArtifact } from "@/lib/api";

type ViewerKind = "markdown" | "csv" | "mindmap" | "flashcards" | "presentation";

// Pick the inline viewer for a saved artifact, or null if it can only be
// downloaded. Mirrors the routing in portal/frontend's artifact cards.
function viewerFor(a: NLMArtifact): ViewerKind | null {
  if (a.artifact_type === "mind_map") return "mindmap";
  if (a.artifact_type === "flashcards") return "flashcards";
  if (a.file_format === "md") return "markdown";
  if (a.file_format === "csv") return "csv";
  if (a.file_format === "pptx" || a.file_format === "ppt") return "presentation";
  return null;
}

function formatDate(s: string | null): string | null {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ---- View-only artifact card ----

function ArtifactCard({ artifact }: { artifact: NLMArtifact }) {
  const cfg = TYPE_CONFIG[artifact.artifact_type] ?? DEFAULT_CONFIG;
  const Icon = cfg.icon;
  const [viewer, setViewer] = useState<ViewerKind | null>(null);

  const kind = viewerFor(artifact);
  const isDone = artifact.download_status === "done";
  const isFailed = artifact.download_status === "failed";
  const dateStr = formatDate(artifact.nlm_created_at ?? artifact.portal_added_at);

  const canPresent = kind === "presentation" && !!artifact.r2_url;
  const hasModalViewer =
    kind === "markdown" || kind === "csv" || kind === "mindmap" || kind === "flashcards" || canPresent;
  const actionLabel =
    kind === "markdown" ? "Read" : kind === "flashcards" ? "Study" : "View";

  return (
    <>
      {viewer === "markdown" && (
        <MarkdownModal portalId={artifact.id} title={artifact.title} onClose={() => setViewer(null)} />
      )}
      {viewer === "csv" && (
        <CsvTableModal portalId={artifact.id} title={artifact.title} onClose={() => setViewer(null)} />
      )}
      {viewer === "mindmap" && (
        <MindMapModal portalId={artifact.id} title={artifact.title} onClose={() => setViewer(null)} />
      )}
      {viewer === "flashcards" && (
        <FlashcardsModal portalId={artifact.id} title={artifact.title} onClose={() => setViewer(null)} />
      )}
      {viewer === "presentation" && artifact.r2_url && (
        <PresentationModal src={artifact.r2_url} title={artifact.title} onClose={() => setViewer(null)} />
      )}

      <div className="rounded-[2px] overflow-hidden border border-ink bg-vellum shadow-[2px_2px_0_rgb(42_36_24_/_0.08)] hover:shadow-[3px_3px_0_rgb(42_36_24_/_0.14)] hover:-translate-y-px transition-all">
        {/* Type header */}
        <div
          className="flex flex-col items-center justify-center gap-2 py-8 border-b border-ink"
          style={{ background: cfg.bg, color: cfg.iconColor }}
        >
          <Icon className="h-12 w-12" style={{ color: cfg.iconColor }} />
          <span className="font-mono text-[10px] tracking-[0.18em] uppercase text-ink-soft">
            {cfg.label}
          </span>
        </div>

        {/* Content */}
        <div className="px-4 py-3.5 flex flex-col gap-3">
          <div>
            <p className="font-serif-display text-[18px] leading-[1.15] tracking-tight text-ink line-clamp-2">
              {artifact.title}
            </p>
            {dateStr && (
              <p className="font-mono text-[10px] tracking-[0.12em] uppercase text-ink-mute mt-1.5">{dateStr}</p>
            )}
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline" className="font-mono text-[9px] tracking-[0.14em] uppercase rounded-[1px] border-rule text-ink-fade">
              {artifact.file_format}
            </Badge>
          </div>

          {/* Action area */}
          <div className="mt-1">
            {isDone && hasModalViewer ? (
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-1.5 h-8 rounded-[1px]"
                onClick={() => setViewer(kind)}
              >
                {actionLabel}
              </Button>
            ) : isDone && artifact.r2_url ? (
              <a href={artifact.r2_url} target="_blank" rel="noopener noreferrer" className="block">
                <Button variant="outline" size="sm" className="w-full gap-1.5 h-8 rounded-[1px]">
                  <ExternalLink className="h-3 w-3" />
                  Open
                </Button>
              </a>
            ) : isFailed ? (
              <div className="flex items-center justify-center gap-1.5 py-1.5 font-mono text-[10px] tracking-[0.14em] uppercase text-terracotta">
                <AlertCircle className="h-4 w-4" /> Unavailable
              </div>
            ) : (
              <div className="flex items-center justify-center gap-1.5 py-1.5 font-mono text-[10px] tracking-[0.14em] uppercase text-ink-fade">
                <Loader2 className="h-4 w-4 animate-spin" /> Processing…
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ---- Page ----

export default function NotebookCorpusDetailPage() {
  const params = useParams();
  const router = useRouter();
  const notebookId = params.id as string;

  const [artifacts, setArtifacts] = useState<NLMArtifact[] | null>(null);
  const [title, setTitle] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getArtifacts({ notebook_id: notebookId, limit: 200 })
      .then((res) => {
        if (cancelled) return;
        setArtifacts(res.items);
        setTitle(res.items.find((a) => a.notebook_title?.trim())?.notebook_title ?? null);
      })
      .catch(() => { if (!cancelled) setArtifacts([]); });
    return () => { cancelled = true; };
  }, [notebookId]);

  const loading = artifacts === null;

  return (
    <div className="px-14 py-8 space-y-6 pb-16">
      <Button
        variant="ghost"
        size="sm"
        className="gap-2 -ml-2 font-mono text-[10px] tracking-[0.18em] uppercase text-ink-fade hover:text-ink"
        onClick={() => router.push("/notebooklm")}
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        NotebookLM Corpus
      </Button>

      <div className="pb-4 border-b border-rule">
        <h1 className="font-serif-display text-[32px] leading-[1.05] tracking-tight text-ink">
          {title ?? (loading ? "Loading…" : "Untitled notebook")}
        </h1>
        {!loading && (
          <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-ink-mute mt-2">
            {artifacts.length} saved artifact{artifacts.length !== 1 ? "s" : ""} · view-only
          </p>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-64 rounded-[2px]" />
          ))}
        </div>
      ) : artifacts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-ink-mute gap-3">
          <FileText className="h-12 w-12 opacity-30" />
          <p className="font-serif-display text-[20px] tracking-tight text-ink">No saved artifacts</p>
          <p className="font-serif text-[14px] text-center max-w-xs text-ink-soft">
            This notebook has no artifacts saved to the portal.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {artifacts.map((a) => (
            <ArtifactCard key={a.id} artifact={a} />
          ))}
        </div>
      )}
    </div>
  );
}
