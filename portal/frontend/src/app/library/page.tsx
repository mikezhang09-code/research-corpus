"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, MoreVertical, Pencil, EyeOff, Trash2, Loader2, ArrowUpDown,
  RotateCcw, BookOpen,
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

const PALETTE = [
  { header: "bg-blue-100",    icon: "text-blue-500"    },
  { header: "bg-violet-100",  icon: "text-violet-500"  },
  { header: "bg-teal-100",    icon: "text-teal-500"    },
  { header: "bg-amber-100",   icon: "text-amber-500"   },
  { header: "bg-rose-100",    icon: "text-rose-500"    },
  { header: "bg-indigo-100",  icon: "text-indigo-500"  },
  { header: "bg-emerald-100", icon: "text-emerald-500" },
  { header: "bg-orange-100",  icon: "text-orange-500"  },
];

function CreateNotebookCard({ onClick }: { onClick: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      className="group cursor-pointer rounded-2xl border border-dashed border-border/70 bg-background hover:border-primary hover:bg-primary/5 transition-colors flex flex-col items-center justify-center gap-3 py-12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <div className="h-14 w-14 rounded-full bg-primary/10 group-hover:bg-primary/15 flex items-center justify-center transition-colors">
        <Plus className="h-7 w-7 text-primary" />
      </div>
      <p className="text-sm font-medium text-foreground/80 group-hover:text-primary transition-colors">
        Create new notebook
      </p>
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
  const color = PALETTE[index % PALETTE.length];
  const created = new Date(notebook.created_at).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      className="group relative cursor-pointer text-left rounded-2xl overflow-hidden border border-border/50 bg-card shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <div className={`${color.header} flex items-center justify-center h-36 relative`}>
        <span className="text-6xl leading-none select-none" aria-hidden="true">
          {notebook.cover_emoji || emojiFromSeed(notebook.id)}
        </span>
        {notebook.hidden && (
          <span className="absolute top-2 left-2 text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-white/80 text-foreground/60">
            Hidden
          </span>
        )}
        <span className="absolute bottom-3 right-3 text-xs font-medium px-2 py-0.5 rounded-full bg-white/70 text-foreground/70">
          {notebook.file_count} file{notebook.file_count !== 1 ? "s" : ""}
        </span>
        <div className="absolute top-2 right-2 flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="More actions"
              onClick={(e) => e.stopPropagation()}
              className="h-7 w-7 rounded-full bg-white/85 hover:bg-white shadow-sm flex items-center justify-center text-foreground/70 hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <MoreVertical className="h-4 w-4" />
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
      </div>

      <div className="px-4 py-3 bg-background">
        <p className="font-semibold text-sm leading-snug line-clamp-2 group-hover:text-primary transition-colors">
          {notebook.title}
        </p>
        {notebook.description && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{notebook.description}</p>
        )}
        <p className="text-xs text-muted-foreground mt-1">{created}</p>
      </div>
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
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <BookOpen className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Library</h1>
            <p className="text-sm text-muted-foreground">
              {notebooks.length} notebook{notebooks.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
        <Button onClick={() => setShowCreate(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          New notebook
        </Button>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <Input
          placeholder="Search notebooks…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex items-center gap-2 h-9 rounded-md border border-input bg-transparent hover:bg-accent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ArrowUpDown className="h-3.5 w-3.5" />
            Sort: {sortBy === "recent" ? "Recent" : sortBy === "title" ? "Title" : "Files"}
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => setSortBy("recent")}>Recent</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSortBy("title")}>Title</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSortBy("files")}>Files</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <label className="flex items-center gap-2 text-sm cursor-pointer ml-auto">
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(e) => setShowHidden(e.target.checked)}
            className="rounded"
          />
          Show hidden
        </label>
      </div>

      {actionError && (
        <p className="text-sm text-destructive mb-4">{actionError}</p>
      )}

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-5">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-2xl overflow-hidden border border-border/50">
              <Skeleton className="h-36 w-full" />
              <div className="p-4 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-5">
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
