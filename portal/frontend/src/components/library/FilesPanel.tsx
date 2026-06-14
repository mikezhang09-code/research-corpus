"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, Loader2, CheckSquare, FolderPlus, Trash2, X, AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  createLibraryNotebookFromFiles, deleteLibraryNotebookFiles,
  generateLibraryArtifact, getLibraryNotebookFiles, type LibraryFile,
} from "@/lib/api";
import { useLanguage } from "@/hooks/use-language";
import { FileCard } from "./FileCard";
import { AddFileModal } from "./AddFileModal";
import { NoteEditorModal } from "./NoteEditorModal";
import { MindMapEditorModal } from "./MindMapEditorModal";
import { DiagramEditorModal } from "./DiagramEditorModal";
import { QuizEditorModal } from "./QuizEditorModal";
import { FlashcardEditorModal } from "./FlashcardEditorModal";
import { GenerateArtifactButton, NewArtifactButton, type ArtifactKind } from "./NewArtifactButton";

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
  { value: "flashcards",  label: "Flashcards"   },
  { value: "image",       label: "Images"       },
  { value: "component",   label: "Components"   },
];

function CreateFolioFromSelectionDialog({
  count,
  onClose,
  onCreate,
}: {
  count: number;
  onClose: () => void;
  onCreate: (title: string) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    const trimmed = title.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      await onCreate(trimmed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !submitting) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-serif-display text-[22px] tracking-tight">New folio from selection</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <label className="font-mono text-[10px] tracking-[0.18em] uppercase text-ink-mute">
            Folio title
          </label>
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleCreate(); } }}
            placeholder="Folio B"
            disabled={submitting}
            className="h-11"
          />
          <p className="font-mono text-[10px] tracking-[0.12em] uppercase text-ink-mute">
            {count} artifact{count !== 1 ? "s" : ""} will move into this folio.
          </p>
        </div>
        {error && (
          <div className="flex items-start gap-2 font-mono text-[11px] tracking-[0.08em] text-terracotta bg-vellum border border-terracotta/40 rounded-[1px] p-2.5">
            <AlertCircle className="h-4 w-4 shrink-0 mt-px" />
            <span className="break-words">{error}</span>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button onClick={handleCreate} disabled={!title.trim() || submitting}>
            {submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating…</> : "Create folio"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FilesPanel({ notebookId }: { notebookId: string }) {
  const router = useRouter();
  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [showMindMap, setShowMindMap] = useState(false);
  const [showDiagram, setShowDiagram] = useState(false);
  const [showQuiz, setShowQuiz] = useState(false);
  const [showFlashcards, setShowFlashcards] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [generating, setGenerating] = useState<ArtifactKind | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [language] = useLanguage();

  const loadFiles = useCallback(async (category: string) => {
    setLoading(true);
    try {
      const data = await getLibraryNotebookFiles(notebookId, { category: category || undefined });
      setFiles(data);
    } finally {
      setLoading(false);
    }
  }, [notebookId]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadFiles(activeCategory);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [activeCategory, loadFiles]);

  function handleCategoryChange(cat: string) {
    setActiveCategory(cat);
    setSelectedIds(new Set());
  }

  function handleFileDeleted(fileId: string) {
    setFiles((prev) => prev.filter((f) => f.id !== fileId));
  }

  function handleFileUpdated(updated: LibraryFile) {
    setFiles((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
  }

  const selectedFileIds = useMemo(() => [...selectedIds], [selectedIds]);
  const selectedCount = selectedFileIds.length;
  const allVisibleSelected = files.length > 0 && files.every((f) => selectedIds.has(f.id));

  function toggleSelectionMode() {
    setSelectionMode((prev) => {
      const next = !prev;
      if (!next) setSelectedIds(new Set());
      return next;
    });
  }

  function setFileSelected(fileId: string, selected: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (selected) next.add(fileId); else next.delete(fileId);
      return next;
    });
  }

  function selectAllVisible() {
    setSelectedIds(new Set(files.map((f) => f.id)));
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function handleBulkDelete() {
    if (selectedCount === 0) return;
    const fileIds = selectedFileIds;
    const fileIdSet = new Set(fileIds);
    setBulkDeleting(true);
    setActionError(null);
    try {
      await deleteLibraryNotebookFiles(notebookId, fileIds);
      setFiles((prev) => prev.filter((f) => !fileIdSet.has(f.id)));
      clearSelection();
      setShowBulkDelete(false);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBulkDeleting(false);
    }
  }

  async function handleGenerate(kind: ArtifactKind) {
    setGenerating(kind);
    setActionError(null);
    try {
      const file = await generateLibraryArtifact(notebookId, kind, language);
      setFiles((prev) => [file, ...prev]);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(null);
    }
  }

  async function handleCreateFolioFromSelection(title: string) {
    if (selectedCount === 0) return;
    const fileIds = selectedFileIds;
    const fileIdSet = new Set(fileIds);
    const nb = await createLibraryNotebookFromFiles(notebookId, {
      title,
      file_ids: fileIds,
    });
    setFiles((prev) => prev.filter((f) => !fileIdSet.has(f.id)));
    clearSelection();
    setSelectionMode(false);
    setShowMoveDialog(false);
    router.push(`/library/${nb.id}`);
  }

  return (
    <div className="space-y-4">
      {/* Category filter pills */}
      <div className="flex gap-2 flex-wrap items-center">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.value}
            onClick={() => handleCategoryChange(cat.value)}
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
          {files.length > 0 && (
            <Button
              variant={selectionMode ? "secondary" : "outline"}
              size="sm"
              className="gap-1.5 h-7 rounded-[1px]"
              onClick={toggleSelectionMode}
            >
              {selectionMode ? <X className="h-3.5 w-3.5" /> : <CheckSquare className="h-3.5 w-3.5" />}
              {selectionMode ? "Done" : "Select"}
            </Button>
          )}
          <GenerateArtifactButton generating={generating} onGenerate={handleGenerate} />
          <NewArtifactButton
            onCreate={(kind) => {
              if (kind === "note") setShowNote(true);
              else if (kind === "mindmap") setShowMindMap(true);
              else if (kind === "diagram") setShowDiagram(true);
              else if (kind === "flashcards") setShowFlashcards(true);
              else setShowQuiz(true);
            }}
          />
          <Button
            size="sm"
            className="gap-1.5 h-7 rounded-[1px]"
            onClick={() => setShowAdd(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            Add file
          </Button>
        </div>
      </div>

      {selectionMode && (
        <div className="flex items-center gap-2 flex-wrap rounded-[2px] border border-rule bg-paper-light px-3 py-2">
          <span className="font-mono text-[10px] tracking-[0.16em] uppercase text-ink-fade mr-auto">
            {selectedCount} selected
          </span>
          <Button variant="ghost" size="sm" className="h-7 rounded-[1px]" onClick={allVisibleSelected ? clearSelection : selectAllVisible}>
            {allVisibleSelected ? "Clear" : "Select all"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 h-7 rounded-[1px]"
            onClick={() => setShowMoveDialog(true)}
            disabled={selectedCount === 0}
          >
            <FolderPlus className="h-3.5 w-3.5" />
            New folio
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="gap-1.5 h-7 rounded-[1px]"
            onClick={() => setShowBulkDelete(true)}
            disabled={selectedCount === 0}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </Button>
        </div>
      )}

      {actionError && (
        <div className="flex items-start gap-2 font-mono text-[11px] tracking-[0.08em] text-terracotta bg-vellum border border-terracotta/40 rounded-[1px] p-2.5">
          <AlertCircle className="h-4 w-4 shrink-0 mt-px" />
          <span className="break-words">{actionError}</span>
        </div>
      )}

      {/* File grid */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-[2px] overflow-hidden border border-rule">
              <Skeleton className="h-32 w-full rounded-none" />
              <div className="p-4 space-y-2">
                <Skeleton className="h-4 w-3/4 rounded-[1px]" />
                <Skeleton className="h-3 w-1/2 rounded-[1px]" />
              </div>
            </div>
          ))}
        </div>
      ) : files.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-ink-mute gap-3">
          <Loader2 className="h-8 w-8 opacity-20" />
          <p className="font-serif italic text-[14px] text-ink-fade">
            {activeCategory ? `No ${activeCategory} files yet` : "No files yet"}
          </p>
          <Button variant="outline" size="sm" className="gap-1.5 rounded-[1px]" onClick={() => setShowAdd(true)}>
            <Plus className="h-3.5 w-3.5" />
            Add your first file
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {files.map((f) => (
            <FileCard
              key={f.id}
              file={f}
              onDeleted={() => handleFileDeleted(f.id)}
              onUpdated={handleFileUpdated}
              selected={selectedIds.has(f.id)}
              onSelectedChange={selectionMode ? (selected) => setFileSelected(f.id, selected) : undefined}
            />
          ))}
        </div>
      )}

      {showAdd && (
        <AddFileModal
          notebookId={notebookId}
          onClose={() => setShowAdd(false)}
          onUploaded={(newFile) => {
            // Stream each completed upload into the list; modal closes itself
            // when the whole batch finishes.
            setFiles((prev) => [newFile, ...prev]);
          }}
        />
      )}

      {showNote && (
        <NoteEditorModal
          notebookId={notebookId}
          onClose={() => setShowNote(false)}
          onSaved={(newNote) => {
            setFiles((prev) => [newNote, ...prev]);
            setShowNote(false);
          }}
        />
      )}

      {showMindMap && (
        <MindMapEditorModal
          notebookId={notebookId}
          onClose={() => setShowMindMap(false)}
          onSaved={(newFile) => {
            setFiles((prev) => [newFile, ...prev]);
            setShowMindMap(false);
          }}
        />
      )}

      {showDiagram && (
        <DiagramEditorModal
          notebookId={notebookId}
          onClose={() => setShowDiagram(false)}
          onSaved={(newFile) => {
            setFiles((prev) => [newFile, ...prev]);
            setShowDiagram(false);
          }}
        />
      )}

      {showQuiz && (
        <QuizEditorModal
          notebookId={notebookId}
          onClose={() => setShowQuiz(false)}
          onSaved={(newFile) => {
            setFiles((prev) => [newFile, ...prev]);
            setShowQuiz(false);
          }}
        />
      )}

      {showFlashcards && (
        <FlashcardEditorModal
          notebookId={notebookId}
          onClose={() => setShowFlashcards(false)}
          onSaved={(newFile) => {
            setFiles((prev) => [newFile, ...prev]);
            setShowFlashcards(false);
          }}
        />
      )}

      {showMoveDialog && (
        <CreateFolioFromSelectionDialog
          count={selectedCount}
          onClose={() => setShowMoveDialog(false)}
          onCreate={handleCreateFolioFromSelection}
        />
      )}

      <AlertDialog open={showBulkDelete} onOpenChange={(open) => { if (!open && !bulkDeleting) setShowBulkDelete(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete selected artifacts?</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedCount} artifact{selectedCount !== 1 ? "s" : ""} will be permanently deleted from this folio. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleBulkDelete(); }}
              disabled={bulkDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {bulkDeleting ? <><Loader2 className="h-4 w-4 animate-spin" /> Deleting…</> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
