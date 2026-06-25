"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ExternalLink, Loader2, AlertCircle, FileText, Download, CheckSquare, Square } from "lucide-react";
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
  QuizModal,
} from "@/components/notebook/artifact-viewers";
import { getArtifacts, downloadNotebookArtifacts, type NLMArtifact } from "@/lib/api";

type ViewerKind = "markdown" | "csv" | "mindmap" | "flashcards" | "quiz" | "presentation";

// Pick the inline viewer for a saved artifact, or null if it can only be
// downloaded. Mirrors the routing in portal/frontend's artifact cards.
function viewerFor(a: NLMArtifact): ViewerKind | null {
  if (a.artifact_type === "mind_map") return "mindmap";
  if (a.artifact_type === "flashcards") return "flashcards";
  if (a.artifact_type === "quiz") return "quiz";
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

function ArtifactCard({
  artifact,
  selected = false,
  onSelectedChange,
}: {
  artifact: NLMArtifact;
  selected?: boolean;
  onSelectedChange?: (selected: boolean) => void;
}) {
  const cfg = TYPE_CONFIG[artifact.artifact_type] ?? DEFAULT_CONFIG;
  const Icon = cfg.icon;
  const [viewer, setViewer] = useState<ViewerKind | null>(null);

  const kind = viewerFor(artifact);
  const isDone = artifact.download_status === "done";
  const isFailed = artifact.download_status === "failed";
  const dateStr = formatDate(artifact.nlm_created_at ?? artifact.portal_added_at);

  const canPresent = kind === "presentation" && !!artifact.r2_url;
  const hasModalViewer =
    kind === "markdown" || kind === "csv" || kind === "mindmap" || kind === "flashcards" || kind === "quiz" || canPresent;
  const actionLabel =
    kind === "markdown" ? "Read" : kind === "flashcards" ? "Study" : kind === "quiz" ? "Take quiz" : "View";

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
      {viewer === "quiz" && (
        <QuizModal portalId={artifact.id} title={artifact.title} onClose={() => setViewer(null)} />
      )}
      {viewer === "presentation" && artifact.r2_url && (
        <PresentationModal src={artifact.r2_url} title={artifact.title} onClose={() => setViewer(null)} />
      )}

      <div className={`relative rounded-[2px] overflow-hidden border bg-vellum shadow-[2px_2px_0_rgb(42_36_24_/_0.08)] hover:shadow-[3px_3px_0_rgb(42_36_24_/_0.14)] hover:-translate-y-px transition-all ${
        selected ? "border-terracotta ring-2 ring-terracotta/25" : "border-ink"
      }`}>
        {/* Selection checkbox (selection mode only) */}
        {onSelectedChange && (
          <button
            type="button"
            aria-label={selected ? "Deselect artifact" : "Select artifact"}
            onClick={(e) => { e.stopPropagation(); onSelectedChange(!selected); }}
            className={`absolute top-2 left-2 z-10 h-7 w-7 rounded-[1px] border flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink ${
              selected
                ? "bg-terracotta text-paper border-terracotta"
                : "bg-paper/90 hover:bg-paper border-ink/40 text-ink-fade hover:text-ink"
            }`}
          >
            {selected ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
          </button>
        )}
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
            {isDone ? (
              <div className="flex items-center gap-2">
                {hasModalViewer ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 gap-1.5 h-8 rounded-[1px]"
                    onClick={() => setViewer(kind)}
                  >
                    {actionLabel}
                  </Button>
                ) : artifact.r2_url ? (
                  <a href={artifact.r2_url} target="_blank" rel="noopener noreferrer" className="flex-1">
                    <Button variant="outline" size="sm" className="w-full gap-1.5 h-8 rounded-[1px]">
                      <ExternalLink className="h-3 w-3" />
                      Open
                    </Button>
                  </a>
                ) : null}
                <a
                  href={`/api/artifacts/${artifact.id}/content`}
                  download={`${artifact.title}.${artifact.file_format}`}
                  className="shrink-0"
                  title="Download"
                >
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-ink-fade hover:text-ink">
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                </a>
              </div>
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
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [downloadMsg, setDownloadMsg] = useState<string | null>(null);

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

  // Only saved (done) artifacts have an R2 file, so selection/download is
  // limited to those.
  const savedArtifacts = (artifacts ?? []).filter((a) => a.download_status === "done");
  const savedCount = savedArtifacts.length;
  const selectedIdList = [...selectedIds];
  const selectedCount = selectedIdList.length;
  const allSavedSelected = savedCount > 0 && savedArtifacts.every((a) => selectedIds.has(a.id));

  function toggleSelectionMode() {
    setSelectionMode((prev) => {
      const next = !prev;
      if (!next) setSelectedIds(new Set());
      setDownloadMsg(null);
      return next;
    });
  }

  function setArtifactSelected(id: string, sel: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (sel) next.add(id); else next.delete(id);
      return next;
    });
  }

  async function runDownload(ids?: string[]) {
    setDownloading(true);
    setDownloadMsg(null);
    try {
      const { skipped } = await downloadNotebookArtifacts(notebookId, ids);
      if (skipped > 0) {
        setDownloadMsg(`${skipped} unsaved artifact${skipped !== 1 ? "s" : ""} skipped.`);
      }
    } catch (e) {
      setDownloadMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setDownloading(false);
    }
  }

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

      <div className="pb-4 border-b border-rule flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="font-serif-display text-[32px] leading-[1.05] tracking-tight text-ink">
            {title ?? (loading ? "Loading…" : "Untitled notebook")}
          </h1>
          {!loading && (
            <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-ink-mute mt-2">
              {artifacts.length} saved artifact{artifacts.length !== 1 ? "s" : ""} · view-only
            </p>
          )}
        </div>
        {savedCount > 0 && (
          <div className="flex items-center gap-2">
            <Button
              variant={selectionMode ? "secondary" : "outline"}
              size="sm"
              className="gap-2"
              onClick={toggleSelectionMode}
            >
              {selectionMode ? "Done" : "Select"}
            </Button>
            {!selectionMode && (
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => runDownload()}
                disabled={downloading}
                title="Download all saved artifacts"
              >
                {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Download all
              </Button>
            )}
          </div>
        )}
      </div>

      {selectionMode && (
        <div className="flex items-center gap-2 flex-wrap rounded-[2px] border border-rule bg-paper-light px-3 py-2">
          <span className="font-mono text-[10px] tracking-[0.16em] uppercase text-ink-fade mr-auto">
            {selectedCount} selected
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 rounded-[1px]"
            onClick={() =>
              setSelectedIds(allSavedSelected ? new Set() : new Set(savedArtifacts.map((a) => a.id)))
            }
          >
            {allSavedSelected ? "Clear" : "Select all"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 h-7 rounded-[1px]"
            onClick={() => runDownload(selectedIdList)}
            disabled={selectedCount === 0 || downloading}
          >
            {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Download
          </Button>
        </div>
      )}

      {downloadMsg && (
        <div className="flex items-start gap-2 font-mono text-[11px] tracking-[0.08em] text-ink-fade bg-vellum border border-rule rounded-[1px] p-2.5">
          <AlertCircle className="h-4 w-4 shrink-0 mt-px" />
          <span className="break-words">{downloadMsg}</span>
        </div>
      )}

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
          {artifacts.map((a) => {
            const canSelect = selectionMode && a.download_status === "done";
            return (
              <ArtifactCard
                key={a.id}
                artifact={a}
                selected={selectedIds.has(a.id)}
                onSelectedChange={canSelect ? (sel) => setArtifactSelected(a.id, sel) : undefined}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
