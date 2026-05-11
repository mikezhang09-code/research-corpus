"use client";

import { useEffect, useState } from "react";
import {
  Layers, FileText, BookOpen, Music, Video, Network, ImageIcon, File,
  ExternalLink, Trash2, Loader2, AlertCircle,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { deleteLibraryNotebookFile, getLibraryFileContent, type LibraryFile } from "@/lib/api";
import { DocxModal } from "./DocxModal";
import { ImageModal } from "./ImageModal";
import { AudioModal } from "./AudioModal";
import { VideoModal } from "./VideoModal";
import { MindMapModal } from "./MindMapModal";

// ---- category config ----

type CatKey = "slide" | "note" | "report" | "audio" | "video" | "mindmap" | "image" | "other";

const FILE_CATEGORY_CONFIG: Record<CatKey, { icon: React.ElementType; bg: string; iconColor: string; label: string }> = {
  slide:   { icon: Layers,     bg: "bg-orange-50", iconColor: "text-orange-500", label: "Slide"    },
  note:    { icon: FileText,   bg: "bg-yellow-50", iconColor: "text-yellow-500", label: "Note"     },
  report:  { icon: BookOpen,   bg: "bg-blue-50",   iconColor: "text-blue-500",   label: "Report"   },
  audio:   { icon: Music,      bg: "bg-purple-50", iconColor: "text-purple-500", label: "Audio"    },
  video:   { icon: Video,      bg: "bg-pink-50",   iconColor: "text-pink-500",   label: "Video"    },
  mindmap: { icon: Network,    bg: "bg-green-50",  iconColor: "text-green-500",  label: "Mind Map" },
  image:   { icon: ImageIcon,  bg: "bg-teal-50",   iconColor: "text-teal-500",   label: "Image"    },
  other:   { icon: File,       bg: "bg-gray-50",   iconColor: "text-gray-500",   label: "File"     },
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

  useEffect(() => {
    getLibraryFileContent(notebookId, fileId)
      .then(setContent)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [notebookId, fileId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-background rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
          <h2 className="font-semibold text-base line-clamp-1">{title}</h2>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClose}>
            ✕
          </Button>
        </div>
        <div className="overflow-y-auto flex-1 px-8 py-6">
          {error ? (
            <div className="flex items-center gap-2 text-destructive text-sm">
              <AlertCircle className="h-4 w-4 shrink-0" /> Failed to load: {error}
            </div>
          ) : content === null ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <div className="prose prose-sm max-w-none prose-headings:font-semibold prose-p:leading-relaxed prose-p:text-foreground prose-strong:text-foreground prose-code:bg-muted prose-code:px-1 prose-code:rounded prose-a:text-primary prose-a:underline">
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
}: {
  file: LibraryFile;
  onDeleted: () => void;
}) {
  const cfg = FILE_CATEGORY_CONFIG[file.file_category as CatKey] ?? DEFAULT_CAT;
  const Icon = cfg.icon;

  const [deleting, setDeleting] = useState(false);
  const [viewer, setViewer] = useState<"markdown" | "docx" | "mindmap" | "image" | "audio" | "video" | null>(null);

  const ext = (file.file_ext ?? "").toLowerCase();
  const isMarkdown = ext === ".md" || ext === ".txt";
  const isDocx = ext === ".docx" || ext === ".doc";
  const isMindMap = file.file_category === "mindmap";
  const isImage = file.file_category === "image";
  const isAudio = file.file_category === "audio";
  const isVideo = file.file_category === "video";
  const hasViewer = isMarkdown || isDocx || isMindMap || isImage || isAudio || isVideo;

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
    if (isDocx) setViewer("docx");
    else if (isMarkdown) setViewer("markdown");
    else if (isMindMap) setViewer("mindmap");
    else if (isImage) setViewer("image");
    else if (isAudio) setViewer("audio");
    else if (isVideo) setViewer("video");
  }

  return (
    <>
      {viewer === "markdown" && (
        <MarkdownModal notebookId={file.notebook_id} fileId={file.id} title={file.title} onClose={() => setViewer(null)} />
      )}
      {viewer === "docx" && (
        <DocxModal notebookId={file.notebook_id} fileId={file.id} title={file.title} onClose={() => setViewer(null)} />
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

      <div className="rounded-2xl overflow-hidden border border-border/50 bg-card shadow-sm hover:shadow-md transition-shadow">
        {/* Category header */}
        <div className={`${cfg.bg} flex flex-col items-center justify-center gap-2 py-7`}>
          <Icon className={`h-10 w-10 ${cfg.iconColor}`} />
          <span className={`text-xs font-semibold uppercase tracking-wider ${cfg.iconColor} opacity-80`}>
            {cfg.label}
          </span>
        </div>

        {/* Content */}
        <div className="p-4 flex flex-col gap-3">
          <div>
            <p className="font-semibold text-sm leading-snug line-clamp-2">{file.title}</p>
            <p className="text-xs text-muted-foreground mt-1">{added}</p>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {file.file_ext && (
              <Badge variant="outline" className="text-xs uppercase">{file.file_ext.replace(".", "")}</Badge>
            )}
            {sizeStr && (
              <span className="text-xs text-muted-foreground">{sizeStr}</span>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 mt-1">
            {hasViewer ? (
              <Button
                variant="outline"
                size="sm"
                className="flex-1 gap-1.5 h-8 text-xs"
                onClick={openViewer}
              >
                {isAudio || isVideo ? "Play" : "View"}
              </Button>
            ) : file.r2_url ? (
              <a href={file.r2_url} target="_blank" rel="noopener noreferrer" className="flex-1">
                <Button variant="outline" size="sm" className="w-full gap-1.5 h-8 text-xs">
                  <ExternalLink className="h-3 w-3" />
                  Open
                </Button>
              </a>
            ) : null}

            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
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
    </>
  );
}
