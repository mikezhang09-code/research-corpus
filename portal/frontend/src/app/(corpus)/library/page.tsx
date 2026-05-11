"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, MoreVertical, Pencil, EyeOff, Trash2, Loader2, ArrowUpDown,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  getLibraryNotebooks, updateLibraryNotebook, hideLibraryNotebook,
  restoreLibraryNotebook, deleteLibraryNotebook, type LibraryNotebook,
} from "@/lib/api";
import { CreateLibraryNotebookModal } from "@/components/library/CreateLibraryNotebookModal";
import { EmojiPicker } from "@/components/notebook/EmojiPicker";
import { emojiFromSeed } from "@/components/notebook/emoji";
import { FolioCard, pickCover, type FolioStatus } from "@/components/corpus/FolioCard";
import { SectionHead } from "@/components/corpus/SectionHead";

function folioLabel(id: string, index: number): string {
  const code = String(index + 1).padStart(3, "0");
  return `MR-${code}`;
}

function CreateNotebookCard({ onClick }: { onClick: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      className="group cursor-pointer h-[280px] rounded-[2px] border border-dashed border-ink/40 bg-vellum hover:border-ink hover:bg-paper-deep transition-colors flex flex-col items-center justify-center gap-3 px-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
    >
      <div className="h-12 w-12 rounded-full border border-ink/40 group-hover:border-ink bg-paper flex items-center justify-center transition-colors">
        <Plus className="h-6 w-6 text-ink-fade group-hover:text-ink" />
      </div>
      <p className="font-mono text-[10px] tracking-[0.18em] uppercase text-ink-fade group-hover:text-ink transition-colors">
        New folio
      </p>
    </div>
  );
}

function NotebookCardActions({
  notebook, onEdit, onHide, onRestore, onDelete,
}: {
  notebook: LibraryNotebook;
  onEdit: () => void;
  onHide: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="absolute top-2 right-2 z-10">
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="More actions"
          onClick={(e) => e.stopPropagation()}
          className="h-7 w-7 rounded-[1px] bg-paper/90 hover:bg-paper border border-ink/40 hover:border-ink flex items-center justify-center text-ink-fade hover:text-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
        >
          <MoreVertical className="h-3.5 w-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem onClick={onEdit}>
            <Pencil className="h-4 w-4" /> Edit (title &amp; emoji)
          </DropdownMenuItem>
          {notebook.hidden ? (
            <DropdownMenuItem onClick={onRestore}>
              <RotateCcw className="h-4 w-4" /> Restore to list
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={onHide}>
              <EyeOff className="h-4 w-4" /> Hide from list
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onDelete} variant="destructive">
            <Trash2 className="h-4 w-4" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function NotebookCard({
  notebook, index, onOpen, onEdit, onHide, onRestore, onDelete,
}: {
  notebook: LibraryNotebook;
  index: number;
  onOpen: () => void;
  onEdit: () => void;
  onHide: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const cover = pickCover(notebook.id);
  const status: FolioStatus = notebook.hidden ? "archived" : "active";
  const folio = folioLabel(notebook.id, index);
  const excerpt = notebook.description?.trim()
    || `${notebook.file_count} file${notebook.file_count !== 1 ? "s" : ""}${notebook.cover_emoji ? "  " + notebook.cover_emoji : ""}`;

  return (
    <div className="relative group">
      <NotebookCardActions
        notebook={notebook}
        onEdit={onEdit}
        onHide={onHide}
        onRestore={onRestore}
        onDelete={onDelete}
      />
      <FolioCard
        folio={folio}
        title={notebook.title}
        status={status}
        cover={cover}
        sources={[]}
        excerpt={excerpt}
        tags={[]}
        updated={notebook.updated_at}
        onClick={onOpen}
      />
    </div>
  );
}

function EditDialog({ notebook, onClose, onSaved }: {
  notebook: LibraryNotebook;
  onClose: () => void;
  onSaved: (updated: LibraryNotebook) => void;
}) {
  const [title, setTitle] = useState(notebook.title);
  const [emoji, setEmoji] = useState<string>(notebook.cover_emoji || emojiFromSeed(notebook.id));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const titleChanged = title.trim() !== notebook.title;
  const emojiChanged = emoji !== (notebook.cover_emoji || emojiFromSeed(notebook.id));
  const dirty = titleChanged || emojiChanged;

  async function handleSave() {
    const t = title.trim();
    if (!t) return;
    if (!dirty) { onClose(); return; }
    setSaving(true);
    setError(null);
    try {
      const updated = await updateLibraryNotebook(notebook.id, {
        ...(titleChanged ? { title: t } : {}),
        ...(emojiChanged ? { cover_emoji: emoji } : {}),
      });
      onSaved(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit notebook</DialogTitle>
        </DialogHeader>
        <div className="flex items-start gap-2">
          <EmojiPicker value={emoji} onChange={setEmoji} />
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSave(); } }}
            autoFocus
            disabled={saving}
            className="h-12"
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !title.trim() || !dirty}>
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function LibraryPage() {
  const router = useRouter();
  const [notebooks, setNotebooks] = useState<LibraryNotebook[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<LibraryNotebook | null>(null);
  const [hideTarget, setHideTarget] = useState<LibraryNotebook | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LibraryNotebook | null>(null);
  const [pendingAction, setPendingAction] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [sortBy, setSortBy] = useState<"recent" | "title" | "files">("recent");

  async function load(includeHidden = showHidden) {
    setLoading(true);
    try {
      const res = await getLibraryNotebooks({ includeHidden });
      setNotebooks(res.items);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(showHidden);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHidden]);

  const filtered = useMemo(() => {
    let list = notebooks;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((n) => n.title.toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => {
      if (sortBy === "title") return a.title.localeCompare(b.title);
      if (sortBy === "files") return b.file_count - a.file_count;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [notebooks, search, sortBy]);

  async function handleHide() {
    if (!hideTarget) return;
    setPendingAction(true);
    setActionError(null);
    try {
      await hideLibraryNotebook(hideTarget.id);
      setNotebooks((prev) =>
        showHidden
          ? prev.map((n) => n.id === hideTarget.id ? { ...n, hidden: true } : n)
          : prev.filter((n) => n.id !== hideTarget.id)
      );
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setPendingAction(false);
      setHideTarget(null);
    }
  }

  async function handleRestore(nb: LibraryNotebook) {
    try {
      const updated = await restoreLibraryNotebook(nb.id);
      setNotebooks((prev) => prev.map((n) => n.id === nb.id ? updated : n));
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setPendingAction(true);
    setActionError(null);
    try {
      await deleteLibraryNotebook(deleteTarget.id);
      setNotebooks((prev) => prev.filter((n) => n.id !== deleteTarget.id));
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setPendingAction(false);
      setDeleteTarget(null);
    }
  }

  return (
    <div className="pb-16">
      <SectionHead eyebrow="Section II" title="My Research" count={notebooks.length} />

      <div className="px-14 space-y-6">
        {/* Action row */}
        <div className="flex items-center justify-end gap-2">
          <Button onClick={() => setShowCreate(true)} size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            New folio
          </Button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-3 flex-wrap">
          <Input
            placeholder="Search folios…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center gap-1.5 h-9 rounded-[1px] border border-rule bg-vellum hover:bg-paper-deep hover:border-ink px-3 font-mono text-[10px] tracking-[0.14em] uppercase text-ink-fade hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink transition-colors">
              <ArrowUpDown className="h-3.5 w-3.5" />
              {sortBy === "recent" ? "Recent" : sortBy === "title" ? "Title" : "Files"}
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => setSortBy("recent")}>Recent</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortBy("title")}>Title</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortBy("files")}>Files</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <label className="inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.14em] uppercase text-ink-fade cursor-pointer select-none ml-auto">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(e) => setShowHidden(e.target.checked)}
              className="h-4 w-4 rounded-[1px] border-rule"
            />
            Show hidden
          </label>
        </div>

        {actionError && (
          <p className="font-mono text-[11px] tracking-[0.1em] uppercase text-terracotta">{actionError}</p>
        )}

        {/* Grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-64 rounded-[2px]" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            <CreateNotebookCard onClick={() => setShowCreate(true)} />
            {filtered.map((nb, i) => (
              <NotebookCard
                key={nb.id}
                notebook={nb}
                index={i}
                onOpen={() => router.push(`/library/${nb.id}`)}
                onEdit={() => setEditTarget(nb)}
                onHide={() => setHideTarget(nb)}
                onRestore={() => handleRestore(nb)}
                onDelete={() => setDeleteTarget(nb)}
              />
            ))}
          </div>
        )}
      </div>

      {showCreate && <CreateLibraryNotebookModal onClose={() => setShowCreate(false)} />}

      {editTarget && (
        <EditDialog
          notebook={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={(updated) => {
            setNotebooks((prev) => prev.map((n) => n.id === updated.id ? updated : n));
            setEditTarget(null);
          }}
        />
      )}

      <AlertDialog open={!!hideTarget} onOpenChange={(open) => { if (!open) setHideTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hide notebook?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{hideTarget?.title}&rdquo; will be hidden from the list. You can restore it later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pendingAction}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleHide} disabled={pendingAction}>
              {pendingAction ? <Loader2 className="h-4 w-4 animate-spin" /> : "Hide"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete notebook?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{deleteTarget?.title}&rdquo; and all its files will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pendingAction}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={pendingAction}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {pendingAction ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
