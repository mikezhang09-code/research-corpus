"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, MoreVertical, Pencil, Trash2, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FilesPanel } from "@/components/library/FilesPanel";
import { LibraryNotebookDescription } from "@/components/library/LibraryNotebookDescription";
import { TagInput } from "@/components/library/TagInput";
import {
  getLibraryNotebook, updateLibraryNotebook, deleteLibraryNotebook,
  type LibraryNotebook,
} from "@/lib/api";

export default function FolioDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [folio, setFolio] = useState<LibraryNotebook | null>(null);
  const [loading, setLoading] = useState(true);
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getLibraryNotebook(id)
      .then((d) => { if (!cancelled) setFolio(d); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  return (
    <div className="px-14 py-8 space-y-6 pb-16">
      <Button
        variant="ghost"
        size="sm"
        className="gap-2 -ml-2 font-mono text-[10px] tracking-[0.18em] uppercase text-ink-fade hover:text-ink"
        onClick={() => router.push("/library")}
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        My Research
      </Button>

      {loading ? (
        <div className="space-y-6">
          <Skeleton className="h-10 w-64 rounded-[1px]" />
          <Skeleton className="h-20 w-full rounded-[1px]" />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-56 rounded-[2px]" />
            ))}
          </div>
        </div>
      ) : !folio ? (
        <p className="font-serif italic text-ink-fade">Folio not found.</p>
      ) : (
        <>
          {/* Header */}
          <div className="pb-4 border-b border-rule">
            <div className="flex items-start gap-3">
              {folio.cover_emoji && (
                <span className="text-4xl leading-none select-none mt-1" aria-hidden="true">
                  {folio.cover_emoji}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h1 className="font-serif-display text-[32px] leading-[1.05] tracking-tight text-ink truncate">
                    {folio.title}
                  </h1>
                  <DropdownMenu>
                    <DropdownMenuTrigger className="h-7 w-7 shrink-0 inline-flex items-center justify-center rounded-[1px] text-ink-fade hover:text-ink hover:bg-paper-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink">
                      <MoreVertical className="h-4 w-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem onClick={() => setShowEdit(true)}>
                        <Pencil className="h-4 w-4" /> Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setShowDelete(true)}
                        className="text-terracotta focus:text-terracotta"
                      >
                        <Trash2 className="h-4 w-4" /> Delete folio
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-ink-mute mt-2">
                  {folio.file_count} file{folio.file_count !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
          </div>

          {/* Description */}
          <LibraryNotebookDescription
            notebookId={id}
            initialDescription={folio.description}
            onSave={(desc) => setFolio((nb) => (nb ? { ...nb, description: desc } : nb))}
          />

          {/* Tags */}
          <div>
            <label className="block font-mono text-[10px] tracking-[0.18em] uppercase text-ink-mute mb-2">
              Tags
            </label>
            <TagInput
              value={folio.tags}
              onChange={async (next) => {
                setFolio((nb) => (nb ? { ...nb, tags: next } : nb));
                try {
                  const updated = await updateLibraryNotebook(id, { tags: next });
                  setFolio(updated);
                } catch {
                  // Revert to the source of truth on failure.
                  getLibraryNotebook(id).then(setFolio).catch(() => {});
                }
              }}
            />
          </div>

          {/* Files */}
          <FilesPanel notebookId={id} />

          {showEdit && (
            <EditFolioDialog
              folio={folio}
              onClose={() => setShowEdit(false)}
              onSaved={(updated) => { setFolio(updated); setShowEdit(false); }}
            />
          )}

          <DeleteFolioDialog
            open={showDelete}
            title={folio.title}
            onOpenChange={setShowDelete}
            onConfirm={async () => {
              await deleteLibraryNotebook(id);
              router.push("/library");
            }}
          />
        </>
      )}
    </div>
  );
}

function EditFolioDialog({
  folio,
  onClose,
  onSaved,
}: {
  folio: LibraryNotebook;
  onClose: () => void;
  onSaved: (updated: LibraryNotebook) => void;
}) {
  const [title, setTitle] = useState(folio.title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = title.trim() !== folio.title && title.trim().length > 0;

  async function handleSave() {
    if (!dirty) { onClose(); return; }
    setSaving(true);
    setError(null);
    try {
      const updated = await updateLibraryNotebook(folio.id, { title: title.trim() });
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
          <DialogTitle className="font-serif-display text-[22px] tracking-tight">Rename folio</DialogTitle>
        </DialogHeader>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSave(); } }}
          autoFocus
          disabled={saving}
          className="h-12"
        />
        {error && (
          <p className="font-mono text-[11px] tracking-[0.1em] uppercase text-terracotta">{error}</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !dirty}>
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteFolioDialog({
  open,
  title,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  title: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setDeleting(true);
    setError(null);
    try {
      await onConfirm();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDeleting(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!deleting) onOpenChange(o); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-serif-display text-[22px] tracking-tight">
            Delete this folio?
          </AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-semibold text-ink">{title}</span> and all of its
            files will be permanently deleted. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <div className="flex items-start gap-2 font-mono text-[11px] tracking-[0.08em] text-terracotta bg-vellum border border-terracotta/40 rounded-[1px] p-2.5">
            <AlertCircle className="h-4 w-4 shrink-0 mt-px" />
            <span className="break-words">{error}</span>
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={deleting}
          >
            {deleting ? <><Loader2 className="h-4 w-4 animate-spin" /> Deleting…</> : "Delete folio"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
