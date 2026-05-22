"use client";

import { useEffect, useState } from "react";
import {
  Layers, FileText, BookOpen, Music, Video, Network, ImageIcon, File, Table,
  ExternalLink, Trash2, Pencil, Loader2, AlertCircle,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  deleteLibraryNotebookFile, getLibraryFileContent, updateLibraryNotebookFile,
  type LibraryFile,
} from "@/lib/api";
import { ExpandButton, EXPANDED_MODAL } from "@/components/corpus/Expandable";
import { PresentationModal } from "@/components/corpus/PresentationModal";
import { CATEGORY_OPTIONS } from "./file-categories";
import { DocxModal } from "./DocxModal";
import { ExcelModal } from "./ExcelModal";
import { ImageModal } from "./ImageModal";
import { AudioModal } from "./AudioModal";
import { VideoModal } from "./VideoModal";
import { MindMapModal } from "./MindMapModal";
import { NoteEditorModal } from "./NoteEditorModal";

// ---- category config ----

type CatKey = "slide" | "note" | "report" | "spreadsheet" | "audio" | "video" | "mindmap" | "image" | "other";

const FILE_CATEGORY_CONFIG: Record<CatKey, { icon: React.ElementType; bg: string; iconColor: string; label: string }> = {
  slide:       { icon: Layers,    bg: "#f5e2d4", iconColor: "var(--color-terracotta)", label: "Slide"       },
  note:        { icon: FileText,  bg: "#ece0c2", iconColor: "var(--color-ochre)",      label: "Note"        },
  report:      { icon: BookOpen,  bg: "#cfd9e3", iconColor: "var(--color-sky)",        label: "Report"      },
  spreadsheet: { icon: Table,     bg: "#dde2cf", iconColor: "var(--color-sage)",       label: "Spreadsheet" },
  audio:       { icon: Music,     bg: "#dcd5e8", iconColor: "var(--color-lavender)",   label: "Audio"       },
  video:       { icon: Video,     bg: "#ecd5d6", iconColor: "var(--color-blush)",      label: "Video"       },
  mindmap:     { icon: Network,   bg: "#dde2cf", iconColor: "var(--color-sage)",       label: "Mind Map"    },
  image:       { icon: ImageIcon, bg: "#dde2cf", iconColor: "var(--color-mint)",       label: "Image"       },
  other:       { icon: File,      bg: "var(--color-paper-deep)", iconColor: "var(--color-ink-fade)", label: "File" },
};

const DEFAULT_CAT = FILE_CATEGORY_CONFIG.other;

function formatBytes(n: number | null): string | null {
  if (n == null) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  if (n >= 1_000) return `${Math.round(n / 1_000)} KB`;
  return `${n} B`;
}

// ---- inline markdown viewer ----
function MarkdownModal({
  notebookId,
  fileId,
  title,
  onClose,
}: {
  notebookId: string;
  fileId: string;
  title: string;
  onClose: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    getLibraryFileContent(notebookId, fileId)
      .then(setContent)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [notebookId, fileId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={`bg-vellum rounded-[2px] border border-ink shadow-[4px_4px_0_rgb(42_36_24_/_0.18)] w-full ${expanded ? EXPANDED_MODAL : "max-w-3xl max-h-[85vh]"} flex flex-col overflow-hidden`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule shrink-0">
          <h2 className="font-serif-display text-[22px] leading-tight tracking-tight text-ink line-clamp-1">{title}</h2>
          <div className="flex items-center gap-1 shrink-0">
            <ExpandButton expanded={expanded} onToggle={() => setExpanded(!expanded)} />
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-ink-fade hover:text-ink" onClick={onClose}>
              ✕
            </Button>
          </div>
        </div>
        <div className="overflow-y-auto flex-1 px-8 py-6">
          {error ? (
            <div className="flex items-center gap-2 text-terracotta font-mono text-[11px] tracking-[0.1em] uppercase">
              <AlertCircle className="h-4 w-4 shrink-0" /> Failed to load: {error}
            </div>
          ) : content === null ? (
            <div className="flex items-center gap-2 text-ink-fade font-mono text-[11px] tracking-[0.1em] uppercase">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <div className="prose prose-sm max-w-none font-serif
              prose-headings:font-serif-display prose-headings:tracking-tight prose-headings:text-ink
              prose-p:leading-relaxed prose-p:text-ink-soft
              prose-strong:text-ink prose-strong:font-semibold
              prose-code:bg-paper-deep prose-code:px-1 prose-code:rounded-[1px] prose-code:text-[13px] prose-code:font-mono prose-code:text-ink
              prose-a:text-terracotta prose-a:underline prose-a:underline-offset-2
              prose-blockquote:border-l-2 prose-blockquote:border-terracotta prose-blockquote:pl-4 prose-blockquote:text-ink-fade prose-blockquote:italic">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- FileCard ----

export function FileCard({
  file,
  onDeleted,
  onUpdated,
}: {
  file: LibraryFile;
  onDeleted: () => void;
  onUpdated?: (file: LibraryFile) => void;
}) {
  const cfg = FILE_CATEGORY_CONFIG[file.file_category as CatKey] ?? DEFAULT_CAT;
  const Icon = cfg.icon;

  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [viewer, setViewer] = useState<"markdown" | "docx" | "excel" | "mindmap" | "image" | "audio" | "video" | "presentation" | null>(null);

  const ext = (file.file_ext ?? "").toLowerCase();
  const isMarkdown = ext === ".md" || ext === ".txt";
  const isDocx = ext === ".docx" || ext === ".doc";
  const isExcel = ext === ".xlsx" || ext === ".xls" || ext === ".xlsm" || ext === ".csv";
  const isPresentation = ext === ".ppt" || ext === ".pptx";
  const isMindMap = file.file_category === "mindmap";
  const isNote = file.file_category === "note";
  const isImage = file.file_category === "image";
  const isAudio = file.file_category === "audio";
  const isVideo = file.file_category === "video";
  // The presentation viewer (Office Online embed) needs a public file URL.
  const hasViewer =
    isMarkdown || isDocx || isExcel || isMindMap || isImage || isAudio || isVideo ||
    (isPresentation && !!file.r2_url);

  const added = new Date(file.added_at).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
  const sizeStr = formatBytes(file.file_size_bytes);

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteLibraryNotebookFile(file.notebook_id, file.id);
      onDeleted();
    } catch {
      setDeleting(false);
    }
  }

  function openViewer() {
    if (isNote) { setNoteOpen(true); return; }
    if (isDocx) setViewer("docx");
    else if (isExcel) setViewer("excel");
    else if (isMarkdown) setViewer("markdown");
    else if (isMindMap) setViewer("mindmap");
    else if (isImage) setViewer("image");
    else if (isAudio) setViewer("audio");
    else if (isVideo) setViewer("video");
    else if (isPresentation) setViewer("presentation");
  }

  return (
    <>
      {viewer === "markdown" && (
        <MarkdownModal notebookId={file.notebook_id} fileId={file.id} title={file.title} onClose={() => setViewer(null)} />
      )}
      {viewer === "docx" && (
        <DocxModal notebookId={file.notebook_id} fileId={file.id} title={file.title} onClose={() => setViewer(null)} />
      )}
      {viewer === "excel" && (
        <ExcelModal notebookId={file.notebook_id} fileId={file.id} title={file.title} onClose={() => setViewer(null)} />
      )}
      {viewer === "mindmap" && (
        <MindMapModal
          title={file.title}
          fetchContent={() => getLibraryFileContent(file.notebook_id, file.id)}
          onClose={() => setViewer(null)}
        />
      )}
      {viewer === "image" && file.r2_url && (
        <ImageModal src={file.r2_url} title={file.title} onClose={() => setViewer(null)} />
      )}
      {viewer === "audio" && file.r2_url && (
        <AudioModal src={file.r2_url} title={file.title} onClose={() => setViewer(null)} />
      )}
      {viewer === "video" && file.r2_url && (
        <VideoModal src={file.r2_url} title={file.title} onClose={() => setViewer(null)} />
      )}
      {viewer === "presentation" && file.r2_url && (
        <PresentationModal src={file.r2_url} title={file.title} onClose={() => setViewer(null)} />
      )}

      <div className="rounded-[2px] overflow-hidden border border-ink bg-vellum shadow-[2px_2px_0_rgb(42_36_24_/_0.08)] hover:shadow-[3px_3px_0_rgb(42_36_24_/_0.14)] hover:-translate-y-px transition-all">
        {/* Category header */}
        <div
          className="flex flex-col items-center justify-center gap-2 py-7 border-b border-ink"
          style={{ background: cfg.bg, color: cfg.iconColor }}
        >
          <Icon className="h-10 w-10" style={{ color: cfg.iconColor }} />
          <span className="font-mono text-[10px] tracking-[0.18em] uppercase text-ink-soft">
            {cfg.label}
          </span>
        </div>

        {/* Content */}
        <div className="px-4 py-3.5 flex flex-col gap-3">
          <div>
            <p className="font-serif-display text-[18px] leading-[1.15] tracking-tight text-ink line-clamp-2">{file.title}</p>
            <p className="font-mono text-[10px] tracking-[0.12em] uppercase text-ink-mute mt-1.5">{added}</p>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {file.file_ext && (
              <Badge variant="outline" className="font-mono text-[9px] tracking-[0.14em] uppercase rounded-[1px] border-rule text-ink-fade">{file.file_ext.replace(".", "")}</Badge>
            )}
            {sizeStr && (
              <span className="font-mono text-[10px] tracking-[0.1em] uppercase text-ink-mute">{sizeStr}</span>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 mt-1">
            {hasViewer ? (
              <Button
                variant="outline"
                size="sm"
                className="flex-1 gap-1.5 h-8 rounded-[1px]"
                onClick={openViewer}
              >
                {isNote ? "Open" : isAudio || isVideo ? "Play" : "View"}
              </Button>
            ) : file.r2_url ? (
              <a href={file.r2_url} target="_blank" rel="noopener noreferrer" className="flex-1">
                <Button variant="outline" size="sm" className="w-full gap-1.5 h-8 rounded-[1px]">
                  <ExternalLink className="h-3 w-3" />
                  Open
                </Button>
              </a>
            ) : null}

            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-ink-fade hover:text-ink"
              onClick={() => setEditing(true)}
              disabled={deleting}
              title="Rename"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-ink-fade hover:text-terracotta"
              onClick={handleDelete}
              disabled={deleting}
              title="Delete"
            >
              {deleting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>
      </div>

      {editing && (
        <EditFileDialog
          file={file}
          onClose={() => setEditing(false)}
          onSaved={(updated) => {
            onUpdated?.(updated);
            setEditing(false);
          }}
        />
      )}

      {noteOpen && (
        <NoteEditorModal
          notebookId={file.notebook_id}
          file={file}
          onClose={() => setNoteOpen(false)}
          onSaved={(updated) => {
            onUpdated?.(updated);
            setNoteOpen(false);
          }}
        />
      )}
    </>
  );
}

function EditFileDialog({
  file,
  onClose,
  onSaved,
}: {
  file: LibraryFile;
  onClose: () => void;
  onSaved: (updated: LibraryFile) => void;
}) {
  const [title, setTitle] = useState(file.title);
  const [category, setCategory] = useState(file.file_category);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedTitle = title.trim();
  const titleChanged = trimmedTitle !== file.title && trimmedTitle.length > 0;
  const categoryChanged = category !== file.file_category;
  const dirty = titleChanged || categoryChanged;

  async function handleSave() {
    if (!dirty) { onClose(); return; }
    setSaving(true);
    setError(null);
    try {
      const updated = await updateLibraryNotebookFile(file.notebook_id, file.id, {
        ...(titleChanged ? { title: trimmedTitle } : {}),
        ...(categoryChanged ? { file_category: category } : {}),
      });
      onSaved(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-serif-display text-[22px] tracking-tight">Edit file</DialogTitle>
        </DialogHeader>

        <div className="space-y-1.5">
          <label className="font-mono text-[10px] tracking-[0.18em] uppercase text-ink-mute">Title</label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSave(); } }}
            autoFocus
            disabled={saving}
            className="h-11"
          />
          <p className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-mute">
            Filename: {file.original_name}
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="font-mono text-[10px] tracking-[0.18em] uppercase text-ink-mute">File type</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            disabled={saving}
            className="w-full rounded-[1px] border border-rule bg-vellum px-3 py-2 font-serif text-[14px] text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink focus-visible:border-ink"
          >
            {CATEGORY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {error && (
          <div className="flex items-start gap-2 font-mono text-[11px] tracking-[0.08em] text-terracotta bg-vellum border border-terracotta/40 rounded-[1px] p-2.5">
            <AlertCircle className="h-4 w-4 shrink-0 mt-px" />
            <span className="break-words">{error}</span>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={!dirty || saving}>
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
