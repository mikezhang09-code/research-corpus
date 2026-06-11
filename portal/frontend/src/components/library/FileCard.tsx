"use client";

import { type HTMLAttributes, type ReactNode, useEffect, useMemo, useState } from "react";
import {
  Layers, FileText, BookOpen, Music, Video, Network, ImageIcon, File, Table,
  ExternalLink, Trash2, Pencil, Loader2, AlertCircle, CheckSquare, Square,
  ChevronLeft, ChevronRight, Search, Code2, Brain,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { markdownRemarkPlugins, markdownRehypePlugins, markdownCodeComponents } from "@/components/markdown/markdown-extras";
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
import { MindMapEditorModal } from "./MindMapEditorModal";
import { QuizModal } from "./QuizModal";
import { NoteEditorModal } from "./NoteEditorModal";
import { JsxModal } from "./JsxModal";

// ---- category config ----

export type CatKey = "slide" | "note" | "report" | "spreadsheet" | "audio" | "video" | "mindmap" | "quiz" | "image" | "component" | "other";

export const FILE_CATEGORY_CONFIG: Record<CatKey, { icon: React.ElementType; bg: string; iconColor: string; label: string }> = {
  slide:       { icon: Layers,    bg: "#f5e2d4", iconColor: "var(--color-terracotta)", label: "Slide"       },
  note:        { icon: FileText,  bg: "#ece0c2", iconColor: "var(--color-ochre)",      label: "Note"        },
  report:      { icon: BookOpen,  bg: "#cfd9e3", iconColor: "var(--color-sky)",        label: "Report"      },
  spreadsheet: { icon: Table,     bg: "#dde2cf", iconColor: "var(--color-sage)",       label: "Spreadsheet" },
  audio:       { icon: Music,     bg: "#dcd5e8", iconColor: "var(--color-lavender)",   label: "Audio"       },
  video:       { icon: Video,     bg: "#ecd5d6", iconColor: "var(--color-blush)",      label: "Video"       },
  mindmap:     { icon: Network,   bg: "#dde2cf", iconColor: "var(--color-sage)",       label: "Mind Map"    },
  quiz:        { icon: Brain,     bg: "#dde2cf", iconColor: "var(--color-sage)",       label: "Quiz"        },
  image:       { icon: ImageIcon, bg: "#dde2cf", iconColor: "var(--color-mint)",       label: "Image"       },
  component:   { icon: Code2,     bg: "#d6e0e0", iconColor: "var(--color-sky)",        label: "Component"   },
  other:       { icon: File,      bg: "var(--color-paper-deep)", iconColor: "var(--color-ink-fade)", label: "File" },
};

const DEFAULT_CAT = FILE_CATEGORY_CONFIG.other;

export function formatBytes(n: number | null): string | null {
  if (n == null) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  if (n >= 1_000) return `${Math.round(n / 1_000)} KB`;
  return `${n} B`;
}

// ---- inline markdown viewer ----

type TocItem = { id: string; text: string; depth: number };

type HeadingProps = HTMLAttributes<HTMLHeadingElement> & { children?: ReactNode };

function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "section";
}

function uniqueSlug(text: string, seen: Map<string, number>, prefix: string): string {
  const base = slugifyHeading(text);
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return `${prefix}${count === 0 ? base : `${base}-${count + 1}`}`;
}

function textFromChildren(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(textFromChildren).join("");
  if (children && typeof children === "object" && "props" in children) {
    return textFromChildren((children as { props?: { children?: ReactNode } }).props?.children);
  }
  return "";
}

function parseMarkdownToc(markdown: string, prefix: string): TocItem[] {
  const seen = new Map<string, number>();
  return markdown
    .split(/\r?\n/)
    .map((line) => /^(#{1,4})\s+(.+?)\s*#*$/.exec(line.trim()))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map((match) => {
      const text = match[2].trim();
      return { id: uniqueSlug(text, seen, prefix), text, depth: match[1].length };
    });
}

function MarkdownDirectory({
  items,
  onToggleSidebar,
}: {
  items: TocItem[];
  onToggleSidebar?: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase();
    return items.filter((item) => item.text.toLowerCase().includes(q));
  }, [items, searchQuery]);

  if (items.length === 0) return null;

  return (
    <nav className="shrink-0 border-b lg:border-b-0 lg:border-r border-rule bg-paper-deep/40 px-5 py-5 lg:w-64 lg:max-h-full flex flex-col gap-3">
      <div className="flex items-center justify-between shrink-0 mb-1">
        <p className="font-mono text-[10px] tracking-[0.18em] uppercase text-ink-mute">Directory</p>
        {onToggleSidebar && (
          <button
            type="button"
            onClick={onToggleSidebar}
            className="hidden lg:flex h-6 w-6 rounded-[1px] border border-rule hover:border-ink bg-paper-light hover:bg-paper-deep text-ink-fade hover:text-ink items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
            title="Collapse directory"
            aria-label="Collapse directory"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="relative shrink-0 mb-2">
        <Search className="absolute left-2.5 top-2.5 h-3 w-3 text-ink-mute/50" />
        <input
          type="text"
          placeholder="Filter headings..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full text-[12px] pl-8 pr-6 py-1.5 bg-vellum border border-rule rounded-[1px] text-ink focus:outline-none focus:border-ink placeholder-ink-mute/40 focus:ring-1 focus:ring-ink"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            className="absolute right-2 top-2 h-4 w-4 text-ink-mute hover:text-ink flex items-center justify-center text-[10px]"
            title="Clear filter"
          >
            ✕
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="flex gap-2 overflow-x-auto lg:block lg:space-y-1">
          {filteredItems.length === 0 ? (
            <p className="font-serif text-[12px] text-ink-mute italic px-2 py-1.5">No headings match</p>
          ) : (
            filteredItems.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className="block shrink-0 max-w-[16rem] truncate rounded-[1px] px-2 py-1.5 font-serif text-[13px] leading-tight text-ink-fade hover:bg-vellum hover:text-ink lg:max-w-none"
                style={{ marginLeft: `${Math.max(0, item.depth - 1) * 12}px` }}
                title={item.text}
              >
                {item.text}
              </a>
            ))
          )}
        </div>
      </div>
    </nav>
  );
}

function MarkdownBody({ content, fontSize, idPrefix }: { content: string; fontSize: number; idPrefix: string }) {
  const seen = new Map<string, number>();
  const heading = (level: 1 | 2 | 3 | 4) => {
    return function Heading({ children, ...props }: HeadingProps) {
      const id = uniqueSlug(textFromChildren(children), seen, idPrefix);
      if (level === 1) return <h1 id={id} {...props}>{children}</h1>;
      if (level === 2) return <h2 id={id} {...props}>{children}</h2>;
      if (level === 3) return <h3 id={id} {...props}>{children}</h3>;
      return <h4 id={id} {...props}>{children}</h4>;
    };
  };

  return (
    <div
      style={{ fontSize: `${fontSize}px` }}
      className="prose prose-sm max-w-none font-serif
      prose-headings:scroll-mt-6 prose-headings:font-serif-display prose-headings:tracking-tight prose-headings:text-ink
      prose-h1:text-[1.7em] prose-h2:text-[1.4em] prose-h3:text-[1.3em]
      prose-p:leading-relaxed prose-p:text-ink-soft
      prose-strong:text-ink prose-strong:font-semibold
      prose-code:bg-paper-deep prose-code:px-1 prose-code:py-0.5 prose-code:rounded-[1px] prose-code:text-[0.9em] prose-code:font-mono prose-code:text-ink
      prose-pre:bg-paper-deep prose-pre:rounded-[2px] prose-pre:p-4 prose-pre:border prose-pre:border-rule
      prose-blockquote:border-l-2 prose-blockquote:border-terracotta prose-blockquote:pl-4 prose-blockquote:text-ink-fade prose-blockquote:italic
      prose-ul:list-disc prose-ol:list-decimal
      prose-li:text-ink-soft
      prose-table:text-[0.9em] prose-th:text-left prose-th:font-mono prose-th:uppercase prose-th:tracking-[0.1em] prose-th:text-ink
      prose-a:text-terracotta prose-a:underline prose-a:underline-offset-2"
    >
      <ReactMarkdown
        remarkPlugins={markdownRemarkPlugins}
        rehypePlugins={markdownRehypePlugins}
        components={{ ...markdownCodeComponents, h1: heading(1), h2: heading(2), h3: heading(3), h4: heading(4) }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export function MarkdownModal({
  notebookId,
  fileId,
  title,
  onClose,
}: {
  /** Folio id, or null for a free-form file. */
  notebookId: string | null;
  fileId: string;
  title: string;
  onClose: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [fontSize, setFontSize] = useState(14);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const idPrefix = `library-${fileId}-`;
  const toc = useMemo(() => content ? parseMarkdownToc(content, idPrefix) : [], [content, idPrefix]);

  const decFont = () => setFontSize((s) => Math.max(12, s - 1));
  const incFont = () => setFontSize((s) => Math.min(24, s + 1));

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
            <div className="flex items-center rounded-[1px] border border-rule mr-1">
              <button
                type="button"
                onClick={decFont}
                disabled={fontSize <= 12}
                title="Smaller text"
                aria-label="Decrease font size"
                className="flex items-center h-8 px-2 font-serif text-[12px] leading-none text-ink-fade hover:text-ink hover:bg-paper-deep disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-fade"
              >
                A<span className="text-[9px]">−</span>
              </button>
              <button
                type="button"
                onClick={incFont}
                disabled={fontSize >= 24}
                title="Larger text"
                aria-label="Increase font size"
                className="flex items-center h-8 px-2 font-serif text-[16px] leading-none text-ink-fade hover:text-ink hover:bg-paper-deep border-l border-rule disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ink-fade"
              >
                A<span className="text-[11px]">+</span>
              </button>
            </div>
            <ExpandButton expanded={expanded} onToggle={() => setExpanded(!expanded)} />
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-ink-fade hover:text-ink" onClick={onClose}>
              ✕
            </Button>
          </div>
        </div>
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden relative">
          {toc.length > 0 && (
            isSidebarOpen ? (
              <MarkdownDirectory items={toc} onToggleSidebar={() => setIsSidebarOpen(false)} />
            ) : (
              <div className="hidden lg:flex w-11 shrink-0 border-r border-rule bg-paper-deep/40 flex-col items-center pt-4">
                <button
                  type="button"
                  onClick={() => setIsSidebarOpen(true)}
                  className="h-7 w-7 rounded-[1px] border border-rule hover:border-ink bg-paper-light hover:bg-paper-deep text-ink-fade hover:text-ink flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                  title="Expand directory"
                  aria-label="Expand directory"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )
          )}
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
              <MarkdownBody content={content} fontSize={fontSize} idPrefix={idPrefix} />
            )}
          </div>
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
  selected = false,
  onSelectedChange,
}: {
  file: LibraryFile;
  onDeleted: () => void;
  onUpdated?: (file: LibraryFile) => void;
  selected?: boolean;
  onSelectedChange?: (selected: boolean) => void;
}) {
  const cfg = FILE_CATEGORY_CONFIG[file.file_category as CatKey] ?? DEFAULT_CAT;
  const Icon = cfg.icon;

  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [viewer, setViewer] = useState<"markdown" | "docx" | "excel" | "mindmap" | "mindmap-edit" | "quiz" | "image" | "audio" | "video" | "presentation" | "jsx" | null>(null);

  const ext = (file.file_ext ?? "").toLowerCase();
  const isMarkdown = ext === ".md" || ext === ".txt";
  const isComponent = ext === ".jsx" || ext === ".tsx";
  const isDocx = ext === ".docx" || ext === ".doc";
  const isExcel = ext === ".xlsx" || ext === ".xls" || ext === ".xlsm" || ext === ".csv";
  const isPresentation = ext === ".ppt" || ext === ".pptx";
  const isMindMap = file.file_category === "mindmap";
  const isQuiz = file.file_category === "quiz";
  const isNote = file.file_category === "note";
  const isImage = file.file_category === "image";
  const isAudio = file.file_category === "audio";
  const isVideo = file.file_category === "video";
  // The presentation viewer (Office Online embed) needs a public file URL.
  const hasViewer =
    isMarkdown || isDocx || isExcel || isMindMap || isQuiz || isImage || isAudio || isVideo ||
    isComponent || (isPresentation && !!file.r2_url);

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
    else if (isQuiz) setViewer("quiz");
    else if (isImage) setViewer("image");
    else if (isAudio) setViewer("audio");
    else if (isVideo) setViewer("video");
    else if (isComponent) setViewer("jsx");
    else if (isPresentation) setViewer("presentation");
  }

  return (
    <>
      {viewer === "markdown" && (
        <MarkdownModal notebookId={file.notebook_id} fileId={file.id} title={file.title} onClose={() => setViewer(null)} />
      )}
      {viewer === "docx" && (
        <DocxModal
          notebookId={file.notebook_id}
          fileId={file.id}
          title={file.title}
          editable={ext === ".docx"}
          onClose={() => setViewer(null)}
        />
      )}
      {viewer === "excel" && (
        <ExcelModal notebookId={file.notebook_id} fileId={file.id} title={file.title} onClose={() => setViewer(null)} />
      )}
      {viewer === "mindmap" && (
        <MindMapModal
          title={file.title}
          fetchContent={() => getLibraryFileContent(file.notebook_id, file.id)}
          onClose={() => setViewer(null)}
          onEdit={() => setViewer("mindmap-edit")}
        />
      )}
      {viewer === "mindmap-edit" && (
        <MindMapEditorModal
          notebookId={file.notebook_id}
          file={file}
          onClose={() => setViewer(null)}
          onSaved={(updated) => {
            onUpdated?.(updated);
            setViewer(null);
          }}
        />
      )}
      {viewer === "quiz" && (
        <QuizModal
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
      {viewer === "jsx" && (
        <JsxModal notebookId={file.notebook_id} fileId={file.id} title={file.title} ext={ext} onClose={() => setViewer(null)} />
      )}

      <div className={`relative rounded-[2px] overflow-hidden border bg-vellum shadow-[2px_2px_0_rgb(42_36_24_/_0.08)] hover:shadow-[3px_3px_0_rgb(42_36_24_/_0.14)] hover:-translate-y-px transition-all ${
        selected ? "border-terracotta ring-2 ring-terracotta/25" : "border-ink"
      }`}>
        {onSelectedChange && (
          <button
            type="button"
            aria-label={selected ? "Deselect artifact" : "Select artifact"}
            onClick={(e) => { e.stopPropagation(); onSelectedChange(!selected); }}
            className={`absolute top-2 left-2 z-10 h-7 w-7 rounded-[1px] border flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink ${
              selected
                ? "bg-ink text-paper border-ink"
                : "bg-paper/90 text-ink-fade border-ink/40 hover:text-ink hover:border-ink"
            }`}
          >
            {selected ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
          </button>
        )}
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
                {isNote ? "Open" : isAudio || isVideo ? "Play" : isQuiz ? "Take quiz" : "View"}
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
