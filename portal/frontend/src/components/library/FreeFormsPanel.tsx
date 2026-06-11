"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Plus, Loader2, AlertCircle, Pencil, Trash2, Download, ExternalLink, Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  deleteFreeFormFile, getFreeFormFiles, getLibraryFileContent,
  updateFreeFormFile, uploadFreeFormFile, type FreeFormFile,
} from "@/lib/api";
import { SectionHead } from "@/components/corpus/SectionHead";
import { PresentationModal } from "@/components/corpus/PresentationModal";
import { FILE_CATEGORY_CONFIG, MarkdownModal, formatBytes, type CatKey } from "./FileCard";
import { CATEGORY_OPTIONS, categoryLabel } from "./file-categories";
import { AddFileModal } from "./AddFileModal";
import { DocxModal } from "./DocxModal";
import { ExcelModal } from "./ExcelModal";
import { ImageModal } from "./ImageModal";
import { AudioModal } from "./AudioModal";
import { VideoModal } from "./VideoModal";
import { MindMapModal } from "./MindMapModal";
import { MindMapEditorModal } from "./MindMapEditorModal";
import { QuizModal } from "./QuizModal";
import { QuizEditorModal } from "./QuizEditorModal";
import { NewArtifactButton } from "./NewArtifactButton";
import { JsxModal } from "./JsxModal";
import { NoteEditorModal } from "./NoteEditorModal";
import { TagInput } from "./TagInput";

const CATEGORIES = [
  { value: "",            label: "All"          },
  { value: "slide",       label: "Slides"       },
  { value: "note",        label: "Notes"        },
  { value: "report",      label: "Reports"      },
  { value: "spreadsheet", label: "Spreadsheets" },
  { value: "audio",       label: "Audio"        },
  { value: "video",       label: "Video"        },
  { value: "mindmap",     label: "Mindmap"      },
  { value: "quiz",        label: "Quizzes"      },
  { value: "image",       label: "Images"       },
  { value: "component",   label: "Components"   },
];

type ViewerKind =
  | "markdown" | "docx" | "excel" | "mindmap" | "quiz" | "image" | "audio" | "video"
  | "presentation" | "jsx";

/** Pick the viewer for a file, mirroring FileCard's dispatch (notes open read-only). */
function viewerFor(file: FreeFormFile): ViewerKind | null {
  const ext = (file.file_ext ?? "").toLowerCase();
  if (ext === ".docx" || ext === ".doc") return "docx";
  if (ext === ".xlsx" || ext === ".xls" || ext === ".xlsm" || ext === ".csv") return "excel";
  if (ext === ".md" || ext === ".txt") return "markdown";
  if (file.file_category === "mindmap") return "mindmap";
  if (file.file_category === "quiz") return "quiz";
  if (file.file_category === "image") return "image";
  if (file.file_category === "audio") return "audio";
  if (file.file_category === "video") return "video";
  if (ext === ".jsx" || ext === ".tsx") return "jsx";
  // The presentation viewer (Office Online embed) needs a public file URL.
  if ((ext === ".ppt" || ext === ".pptx") && file.r2_url) return "presentation";
  return null;
}

function EditFileDialog({
  file,
  tagSuggestions,
  onClose,
  onSaved,
}: {
  file: FreeFormFile;
  tagSuggestions: string[];
  onClose: () => void;
  onSaved: (updated: FreeFormFile) => void;
}) {
  const [title, setTitle] = useState(file.title);
  const [category, setCategory] = useState(file.file_category);
  const [tags, setTags] = useState<string[]>(file.tags);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedTitle = title.trim();
  const titleChanged = trimmedTitle !== file.title && trimmedTitle.length > 0;
  const categoryChanged = category !== file.file_category;
  const tagsChanged =
    tags.length !== file.tags.length || tags.some((t, i) => t !== file.tags[i]);
  const dirty = titleChanged || categoryChanged || tagsChanged;

  async function handleSave() {
    if (!dirty) { onClose(); return; }
    setSaving(true);
    setError(null);
    try {
      const updated = await updateFreeFormFile(file.id, {
        ...(titleChanged ? { title: trimmedTitle } : {}),
        ...(categoryChanged ? { file_category: category } : {}),
        ...(tagsChanged ? { tags } : {}),
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

        <div className="space-y-1.5">
          <label className="font-mono text-[10px] tracking-[0.18em] uppercase text-ink-mute">Tags</label>
          <TagInput value={tags} onChange={setTags} suggestions={tagSuggestions} disabled={saving} />
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

export function FreeFormsPanel() {
  const [files, setFiles] = useState<FreeFormFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState("");
  const [search, setSearch] = useState("");
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [showAdd, setShowAdd] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [showMindMap, setShowMindMap] = useState(false);
  const [mindMapEdit, setMindMapEdit] = useState<FreeFormFile | null>(null);
  const [showQuiz, setShowQuiz] = useState(false);
  const [quizEdit, setQuizEdit] = useState<FreeFormFile | null>(null);
  const [noteTarget, setNoteTarget] = useState<FreeFormFile | null>(null);
  const [editTarget, setEditTarget] = useState<FreeFormFile | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FreeFormFile | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ file: FreeFormFile; kind: ViewerKind } | null>(null);

  useEffect(() => {
    getFreeFormFiles()
      .then(setFiles)
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  // Universe of tags + total counts: fixed display order so chips don't jump
  // as the user clicks — only the displayed number changes.
  const tagTotals = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of files) {
      for (const t of f.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return counts;
  }, [files]);

  const tagOrder = useMemo(
    () =>
      [...tagTotals.keys()].sort(
        (a, b) => (tagTotals.get(b)! - tagTotals.get(a)!) || a.localeCompare(b)
      ),
    [tagTotals]
  );

  function toggleTag(tag: string) {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag); else next.add(tag);
      return next;
    });
  }

  const filtered = useMemo(() => {
    let list = files;
    if (activeCategory) list = list.filter((f) => f.file_category === activeCategory);
    if (selectedTags.size > 0) {
      list = list.filter((f) => {
        for (const t of selectedTags) if (!f.tags.includes(t)) return false;
        return true;
      });
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((f) =>
        f.title.toLowerCase().includes(q) ||
        f.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    return list;
  }, [files, activeCategory, selectedTags, search]);

  const visibleCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of filtered) {
      for (const t of f.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return counts;
  }, [filtered]);

  function handleUpdated(updated: FreeFormFile) {
    setFiles((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setActionError(null);
    try {
      await deleteFreeFormFile(deleteTarget.id);
      setFiles((prev) => prev.filter((f) => f.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }

  function openFile(file: FreeFormFile) {
    if (file.file_category === "note") { setNoteTarget(file); return; }
    const kind = viewerFor(file);
    if (kind) setViewer({ file, kind });
    else if (file.r2_url) window.open(file.r2_url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="pb-16">
      <SectionHead eyebrow="Section III" title="Free Forms" count={files.length} />

      <div className="px-5 sm:px-8 lg:px-14 space-y-5">
        {/* Category pills + add button */}
        <div className="flex gap-2 flex-wrap items-center">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              onClick={() => setActiveCategory(cat.value)}
              className={`px-3 py-1 rounded-[1px] font-mono text-[10px] tracking-[0.14em] uppercase border transition-colors ${
                activeCategory === cat.value
                  ? "bg-ink text-paper border-ink"
                  : "bg-vellum text-ink-fade border-rule hover:bg-paper-deep hover:border-ink hover:text-ink"
              }`}
            >
              {cat.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <NewArtifactButton
              onCreate={(kind) => {
                if (kind === "note") setShowNote(true);
                else if (kind === "mindmap") setShowMindMap(true);
                else setShowQuiz(true);
              }}
            />
            <Button size="sm" className="gap-1.5 h-7 rounded-[1px]" onClick={() => setShowAdd(true)}>
              <Plus className="h-3.5 w-3.5" />
              Add file
            </Button>
          </div>
        </div>

        {/* Search */}
        <div className="relative max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-mute/60" />
          <Input
            placeholder="Search files…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Tag chips */}
        {tagOrder.length > 0 && (
          <div className="flex items-center gap-2 flex-nowrap overflow-x-auto no-scrollbar md:flex-wrap md:overflow-visible">
            <span className="font-mono text-[10px] tracking-[0.18em] uppercase text-ink-mute shrink-0">
              Tags
            </span>
            {tagOrder.map((tag) => {
              const active = selectedTags.has(tag);
              const count = visibleCounts.get(tag) ?? 0;
              const dim = !active && count === 0;
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => toggleTag(tag)}
                  className={
                    "inline-flex shrink-0 items-center gap-1.5 font-mono text-[10px] tracking-[0.14em] uppercase px-2 py-1 rounded-[1px] border transition-colors " +
                    (active
                      ? "border-ink bg-ink text-paper"
                      : dim
                        ? "border-rule/60 bg-vellum text-ink-mute opacity-50 hover:opacity-100 hover:border-ink hover:text-ink"
                        : "border-rule bg-vellum text-ink-fade hover:border-ink hover:text-ink")
                  }
                >
                  {tag}
                  <span className={active ? "text-paper/70" : "text-ink-mute"}>{count}</span>
                </button>
              );
            })}
            {selectedTags.size > 0 && (
              <button
                type="button"
                onClick={() => setSelectedTags(new Set())}
                className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-fade hover:text-ink underline-offset-2 hover:underline ml-1"
              >
                Clear
              </button>
            )}
          </div>
        )}

        {(loadError || actionError) && (
          <div className="flex items-start gap-2 font-mono text-[11px] tracking-[0.08em] text-terracotta bg-vellum border border-terracotta/40 rounded-[1px] p-2.5">
            <AlertCircle className="h-4 w-4 shrink-0 mt-px" />
            <span className="break-words">{loadError || actionError}</span>
          </div>
        )}

        {/* File table */}
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-12 w-full rounded-[1px]" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-ink-mute gap-3">
            <p className="font-serif italic text-[14px] text-ink-fade">
              {files.length === 0
                ? "No files yet — anything that belongs nowhere lives here."
                : "No files match the current filters"}
            </p>
            {files.length === 0 && (
              <Button variant="outline" size="sm" className="gap-1.5 rounded-[1px]" onClick={() => setShowAdd(true)}>
                <Plus className="h-3.5 w-3.5" />
                Add your first file
              </Button>
            )}
          </div>
        ) : (
          <div className="rounded-[2px] border border-ink bg-vellum shadow-[2px_2px_0_rgb(42_36_24_/_0.08)] overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-rule bg-paper-light">
                  <th className="px-4 py-2.5 font-mono text-[10px] tracking-[0.16em] uppercase text-ink-mute font-normal">Name</th>
                  <th className="px-4 py-2.5 font-mono text-[10px] tracking-[0.16em] uppercase text-ink-mute font-normal hidden sm:table-cell">Type</th>
                  <th className="px-4 py-2.5 font-mono text-[10px] tracking-[0.16em] uppercase text-ink-mute font-normal hidden md:table-cell">Size</th>
                  <th className="px-4 py-2.5 font-mono text-[10px] tracking-[0.16em] uppercase text-ink-mute font-normal hidden md:table-cell">Added</th>
                  <th className="px-4 py-2.5 font-mono text-[10px] tracking-[0.16em] uppercase text-ink-mute font-normal text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((file) => {
                  const cfg = FILE_CATEGORY_CONFIG[file.file_category as CatKey] ?? FILE_CATEGORY_CONFIG.other;
                  const Icon = cfg.icon;
                  const sizeStr = formatBytes(file.file_size_bytes);
                  const added = new Date(file.added_at).toLocaleDateString("en-US", {
                    month: "short", day: "numeric", year: "numeric",
                  });
                  const openable = viewerFor(file) !== null || !!file.r2_url;
                  return (
                    <tr key={file.id} className="border-b border-rule last:border-b-0 hover:bg-paper-deep/50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <span
                            className="h-8 w-8 shrink-0 rounded-[1px] border border-ink/20 flex items-center justify-center"
                            style={{ background: cfg.bg }}
                          >
                            <Icon className="h-4 w-4" style={{ color: cfg.iconColor }} />
                          </span>
                          <div className="min-w-0">
                            <button
                              type="button"
                              onClick={() => openFile(file)}
                              disabled={!openable}
                              className="block max-w-full truncate font-serif text-[15px] text-ink text-left hover:underline underline-offset-2 disabled:no-underline disabled:cursor-default"
                              title={file.title}
                            >
                              {file.title}
                            </button>
                            {file.tags.length > 0 && (
                              <div className="flex items-center gap-1 flex-wrap mt-0.5">
                                {file.tags.map((t) => (
                                  <Badge key={t} variant="outline" className="font-mono text-[9px] tracking-[0.1em] uppercase rounded-[1px] border-rule text-ink-fade px-1 py-0">
                                    {t}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <span className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-fade">
                          {categoryLabel(file.file_category)}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <span className="font-mono text-[10px] tracking-[0.1em] uppercase text-ink-mute">
                          {sizeStr ?? "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <span className="font-mono text-[10px] tracking-[0.12em] uppercase text-ink-mute">
                          {added}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {openable && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-ink-fade hover:text-ink"
                              onClick={() => openFile(file)}
                              title={file.file_category === "audio" || file.file_category === "video" ? "Play" : "View"}
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <a
                            href={`/api/free-forms/${file.id}/content`}
                            download={file.original_name}
                            title="Download"
                          >
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-ink-fade hover:text-ink">
                              <Download className="h-3.5 w-3.5" />
                            </Button>
                          </a>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-ink-fade hover:text-ink"
                            onClick={() => setEditTarget(file)}
                            title="Edit"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-ink-fade hover:text-terracotta"
                            onClick={() => setDeleteTarget(file)}
                            title="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Viewers */}
      {viewer?.kind === "markdown" && (
        <MarkdownModal notebookId={null} fileId={viewer.file.id} title={viewer.file.title} onClose={() => setViewer(null)} />
      )}
      {viewer?.kind === "docx" && (
        <DocxModal
          notebookId={null}
          fileId={viewer.file.id}
          title={viewer.file.title}
          editable={(viewer.file.file_ext ?? "").toLowerCase() === ".docx"}
          onClose={() => setViewer(null)}
        />
      )}
      {viewer?.kind === "excel" && (
        <ExcelModal notebookId={null} fileId={viewer.file.id} title={viewer.file.title} onClose={() => setViewer(null)} />
      )}
      {viewer?.kind === "mindmap" && (
        <MindMapModal
          title={viewer.file.title}
          fetchContent={() => getLibraryFileContent(null, viewer.file.id)}
          onClose={() => setViewer(null)}
          onEdit={() => {
            setMindMapEdit(viewer.file);
            setViewer(null);
          }}
        />
      )}
      {mindMapEdit && (
        <MindMapEditorModal<FreeFormFile>
          notebookId={null}
          file={mindMapEdit}
          onClose={() => setMindMapEdit(null)}
          onSaved={(updated) => {
            handleUpdated(updated);
            setMindMapEdit(null);
          }}
        />
      )}
      {viewer?.kind === "quiz" && (
        <QuizModal
          title={viewer.file.title}
          fetchContent={() => getLibraryFileContent(null, viewer.file.id)}
          onClose={() => setViewer(null)}
          onEdit={() => {
            setQuizEdit(viewer.file);
            setViewer(null);
          }}
        />
      )}
      {quizEdit && (
        <QuizEditorModal<FreeFormFile>
          notebookId={null}
          file={quizEdit}
          onClose={() => setQuizEdit(null)}
          onSaved={(updated) => {
            handleUpdated(updated);
            setQuizEdit(null);
          }}
        />
      )}
      {viewer?.kind === "image" && viewer.file.r2_url && (
        <ImageModal src={viewer.file.r2_url} title={viewer.file.title} onClose={() => setViewer(null)} />
      )}
      {viewer?.kind === "audio" && viewer.file.r2_url && (
        <AudioModal src={viewer.file.r2_url} title={viewer.file.title} onClose={() => setViewer(null)} />
      )}
      {viewer?.kind === "video" && viewer.file.r2_url && (
        <VideoModal src={viewer.file.r2_url} title={viewer.file.title} onClose={() => setViewer(null)} />
      )}
      {viewer?.kind === "presentation" && viewer.file.r2_url && (
        <PresentationModal src={viewer.file.r2_url} title={viewer.file.title} onClose={() => setViewer(null)} />
      )}
      {viewer?.kind === "jsx" && (
        <JsxModal
          notebookId={null}
          fileId={viewer.file.id}
          title={viewer.file.title}
          ext={(viewer.file.file_ext ?? "").toLowerCase()}
          onClose={() => setViewer(null)}
        />
      )}

      {showAdd && (
        <AddFileModal<FreeFormFile>
          uploadFile={uploadFreeFormFile}
          tagSuggestions={tagOrder}
          onClose={() => setShowAdd(false)}
          onUploaded={(newFile) => {
            setFiles((prev) => [newFile, ...prev]);
          }}
        />
      )}

      {showNote && (
        <NoteEditorModal<FreeFormFile>
          notebookId={null}
          onClose={() => setShowNote(false)}
          onSaved={(newNote) => {
            setFiles((prev) => [newNote, ...prev]);
            setShowNote(false);
          }}
        />
      )}

      {showMindMap && (
        <MindMapEditorModal<FreeFormFile>
          notebookId={null}
          onClose={() => setShowMindMap(false)}
          onSaved={(newFile) => {
            setFiles((prev) => [newFile, ...prev]);
            setShowMindMap(false);
          }}
        />
      )}

      {showQuiz && (
        <QuizEditorModal<FreeFormFile>
          notebookId={null}
          onClose={() => setShowQuiz(false)}
          onSaved={(newFile) => {
            setFiles((prev) => [newFile, ...prev]);
            setShowQuiz(false);
          }}
        />
      )}

      {noteTarget && (
        <NoteEditorModal<FreeFormFile>
          notebookId={null}
          file={noteTarget}
          onClose={() => setNoteTarget(null)}
          onSaved={(updated) => {
            handleUpdated(updated);
            setNoteTarget(null);
          }}
        />
      )}

      {editTarget && (
        <EditFileDialog
          file={editTarget}
          tagSuggestions={tagOrder}
          onClose={() => setEditTarget(null)}
          onSaved={(updated) => {
            handleUpdated(updated);
            setEditTarget(null);
          }}
        />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete file?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{deleteTarget?.title}&rdquo; will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDelete(); }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <><Loader2 className="h-4 w-4 animate-spin" /> Deleting…</> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
