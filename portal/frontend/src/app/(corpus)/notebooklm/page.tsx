"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, BookOpen, Search, Plus, MoreVertical, Pencil, EyeOff, Trash2, Loader2, ArrowUpDown, RotateCcw, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getNotebooks,
  syncNotebooks,
  deleteNotebook,
  updateNotebook,
  restoreNotebook,
  removeNotebookFromRecent,
  type Notebook,
} from "@/lib/api";
import { GenerateActionSheet } from "@/components/generate/GenerateActionSheet";
import { GenerateModal } from "@/components/generate/GenerateModal";
import { CreateNotebookModal } from "@/components/notebook/CreateNotebookModal";
import { EmojiPicker } from "@/components/notebook/EmojiPicker";
import { emojiFromSeed } from "@/components/notebook/emoji";
import { pickSwatch } from "@/components/corpus/CorpusCard";
import { SectionHead } from "@/components/corpus/SectionHead";

const SWATCH_BG: Record<string, { bg: string; fg: string }> = {
  terracotta: { bg: "#f5e2d4", fg: "var(--color-terracotta)" },
  sage:       { bg: "#dde2cf", fg: "var(--color-sage)" },
  lavender:   { bg: "#dcd5e8", fg: "var(--color-lavender)" },
  ochre:      { bg: "#ece0c2", fg: "var(--color-ochre)" },
  blush:      { bg: "#ecd5d6", fg: "var(--color-blush)" },
  sky:        { bg: "#cfd9e3", fg: "var(--color-sky)" },
};

function CreateNotebookCard({ onClick }: { onClick: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      className="group cursor-pointer rounded-[2px] border border-dashed border-ink/40 bg-vellum hover:border-ink hover:bg-paper-deep transition-colors flex flex-col items-center justify-center gap-3 py-12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
    >
      <div className="h-12 w-12 rounded-full border border-ink/40 group-hover:border-ink bg-paper flex items-center justify-center transition-colors">
        <Plus className="h-6 w-6 text-ink-fade group-hover:text-ink" />
      </div>
      <p className="font-mono text-[10px] tracking-[0.18em] uppercase text-ink-fade group-hover:text-ink transition-colors">
        New notebook
      </p>
    </div>
  );
}

function NotebookCard({ notebook, index, onOpen, onGenerate, onEdit, onHide, onRestore, onDelete }: {
  notebook: Notebook;
  index: number;
  onOpen: () => void;
  onGenerate: () => void;
  onEdit: () => void;
  onHide: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const swatch = pickSwatch(notebook) ?? "terracotta";
  const sw = SWATCH_BG[swatch];
  const num = String(index + 1).padStart(3, "0");
  const date = notebook.nlm_created_at ?? notebook.last_synced_at;
  const dateFormatted = date
    ? new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "";

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      className="group relative cursor-pointer bg-vellum border border-ink rounded-[2px] overflow-hidden shadow-[2px_2px_0_rgb(42_36_24_/_0.08)] hover:shadow-[3px_3px_0_rgb(42_36_24_/_0.14)] hover:-translate-y-px transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
    >
      {/* Color block + emoji glyph */}
      <div
        className="relative aspect-[5/3] flex items-center justify-center border-b border-ink"
        style={{ background: sw.bg, color: sw.fg }}
      >
        <span className="text-5xl leading-none select-none opacity-90 group-hover:opacity-100 transition-opacity" aria-hidden="true">
          {notebook.cover_emoji || emojiFromSeed(notebook.id)}
        </span>
        <span className="absolute top-2.5 left-3 font-mono text-[10px] tracking-[0.18em] uppercase text-ink-soft">
          № {num}
        </span>
        {notebook.hidden && (
          <span className="absolute bottom-2.5 left-3 font-mono text-[9px] tracking-[0.16em] uppercase px-1.5 py-0.5 bg-paper/80 text-ink-fade border border-ink/30 rounded-[1px]">
            Hidden
          </span>
        )}
        {/* Top-right action cluster — positioned above the corner labels */}
        <div className="absolute top-1.5 right-1.5 flex items-center gap-1">
          <button
            type="button"
            aria-label="Generate artifact"
            onClick={(e) => { e.stopPropagation(); onGenerate(); }}
            className="h-7 w-7 rounded-[1px] bg-paper/90 hover:bg-paper border border-ink/40 hover:border-ink flex items-center justify-center text-ink-fade hover:text-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
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
      </div>

      {/* Caption */}
      <div className="px-4 py-3.5">
        <h3 className="font-serif-display text-[20px] leading-[1.15] tracking-tight text-ink mb-0.5 line-clamp-2">
          {notebook.title}
        </h3>
        <div className="mt-3 pt-2.5 border-t border-rule-light flex items-center justify-between font-mono text-[10px] tracking-[0.12em] uppercase text-ink-mute">
          <span>{dateFormatted}</span>
          <span>{notebook.sources_count} src</span>
        </div>
      </div>
    </article>
  );
}

function EditDialog({ notebook, onClose, onSaved }: {
  notebook: Notebook;
  onClose: () => void;
  onSaved: (updated: Notebook) => void;
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
      const updated = await updateNotebook(notebook.id, {
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
          <DialogDescription>
            Change the cover emoji (local only) or rename the notebook (synced to NotebookLM).
          </DialogDescription>
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

export default function NotebookLMPage() {
  const router = useRouter();
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [filtered, setFiltered] = useState<Notebook[]>([]);
  const [search, setSearch] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [generateNotebookId, setGenerateNotebookId] = useState<string | null>(null);
  const [generateType, setGenerateType] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<Notebook | null>(null);
  const [hideTarget, setHideTarget] = useState<Notebook | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Notebook | null>(null);
  const [pendingAction, setPendingAction] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [sortBy, setSortBy] = useState<"recent" | "title" | "sources">("recent");
  const [syncFlash, setSyncFlash] = useState<string | null>(null);

  async function load(includeHidden = showHidden) {
    setLoading(true);
    const all = await getNotebooks({ includeHidden });
    // Hide untitled notebooks — they show up as the "+ new notebook" tile
    // in NotebookLM and aren't real notebooks the user can use.
    const nbs = all.filter((n) => n.title?.trim());
    setNotebooks(nbs);
    setFiltered(nbs);
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(showHidden);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHidden]);

  async function handleSync() {
    setSyncing(true);
    setSyncFlash(null);
    const before = notebooks.length;
    const synced = await syncNotebooks();
    await load();
    const visibleAfter = synced.filter((n) => n.title?.trim()).length;
    const delta = visibleAfter - before;
    setSyncFlash(
      delta > 0 ? `Synced — ${delta} new notebook${delta === 1 ? "" : "s"}`
      : delta < 0 ? `Synced — ${Math.abs(delta)} removed`
      : `Synced — up to date (${visibleAfter} notebook${visibleAfter === 1 ? "" : "s"})`,
    );
    setSyncing(false);
    setTimeout(() => setSyncFlash(null), 3500);
  }

  function applyLocalUpdate(updater: (nbs: Notebook[]) => Notebook[]) {
    setNotebooks((prev) => {
      const next = updater(prev);
      setFiltered((cur) => {
        const q = search.trim().toLowerCase();
        return q ? next.filter((n) => n.title.toLowerCase().includes(q)) : next;
      });
      return next;
    });
  }

  async function handleEditSaved(updated: Notebook) {
    applyLocalUpdate((nbs) => nbs.map((n) => (n.id === updated.id ? { ...n, ...updated } : n)));
    setEditTarget(null);
  }

  async function handleRestore(nb: Notebook) {
    try {
      const updated = await restoreNotebook(nb.id);
      applyLocalUpdate((nbs) => nbs.map((n) => (n.id === updated.id ? { ...n, ...updated } : n)));
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleHideConfirm() {
    if (!hideTarget) return;
    setPendingAction(true);
    setActionError(null);
    try {
      await removeNotebookFromRecent(hideTarget.id);
      applyLocalUpdate((nbs) => nbs.filter((n) => n.id !== hideTarget.id));
      setHideTarget(null);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setPendingAction(false);
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    setPendingAction(true);
    setActionError(null);
    try {
      await deleteNotebook(deleteTarget.id);
      applyLocalUpdate((nbs) => nbs.filter((n) => n.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setPendingAction(false);
    }
  }

  const sortedFiltered = useMemo(() => {
    const arr = [...filtered];
    if (sortBy === "title") {
      arr.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortBy === "sources") {
      arr.sort((a, b) => b.sources_count - a.sources_count);
    } else {
      arr.sort((a, b) => new Date(b.last_synced_at).getTime() - new Date(a.last_synced_at).getTime());
    }
    return arr;
  }, [filtered, sortBy]);

  function handleSearch(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value;
    setSearch(q);
    setFiltered(
      q.trim()
        ? notebooks.filter((n) => n.title.toLowerCase().includes(q.toLowerCase()))
        : notebooks
    );
  }

  return (
    <div className="pb-16">
      <SectionHead eyebrow="Section I" title="My Corpus" count={notebooks.length} />

      <div className="px-14 space-y-6">
        {/* Action row: sync + create */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Button
              onClick={handleSync}
              disabled={syncing}
              variant="outline"
              size="sm"
              className="gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Syncing…" : "Sync notebooks"}
            </Button>
            <Button
              onClick={() => setShowCreate(true)}
              size="sm"
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              New notebook
            </Button>
          </div>
        </div>

        {/* Sync flash */}
        {syncFlash && (
          <div className="flex items-center gap-2 font-mono text-[11px] tracking-[0.1em] uppercase text-mint bg-vellum border border-mint/40 rounded-[1px] px-3 py-2 w-fit">
            <CheckCircle2 className="h-4 w-4" />
            {syncFlash}
          </div>
        )}

        {/* Toolbar: search · sort · show-hidden */}
        {notebooks.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative max-w-sm flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-mute pointer-events-none" />
              <Input
                placeholder="Search notebooks…"
                value={search}
                onChange={handleSearch}
                className="pl-9"
              />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex items-center gap-1.5 h-9 rounded-[1px] border border-rule bg-vellum hover:bg-paper-deep hover:border-ink px-3 font-mono text-[10px] tracking-[0.14em] uppercase text-ink-fade hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink transition-colors">
                <ArrowUpDown className="h-3.5 w-3.5" />
                {sortBy === "recent" ? "Recently synced" : sortBy === "title" ? "Alphabetical" : "Most sources"}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setSortBy("recent")}>Recently synced</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSortBy("title")}>Alphabetical</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSortBy("sources")}>Most sources</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <label className="inline-flex items-center gap-2 font-mono text-[10px] tracking-[0.14em] uppercase text-ink-fade cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showHidden}
                onChange={(e) => setShowHidden(e.target.checked)}
                className="h-4 w-4 rounded-[1px] border-rule"
              />
              Show hidden
            </label>
          </div>
        )}

        {/* Grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[5/3] rounded-[2px]" />
            ))}
          </div>
        ) : notebooks.length === 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            <CreateNotebookCard onClick={() => setShowCreate(true)} />
            <div className="col-span-full sm:col-span-1 lg:col-span-2 xl:col-span-3 flex flex-col items-start justify-center py-6 px-4 gap-3">
              <p className="font-serif-display text-[22px] text-ink">Nothing here yet</p>
              <p className="font-serif text-[14px] text-ink-soft">
                Click <span className="italic">New notebook</span> above, or pull existing notebooks from your NotebookLM account:
              </p>
              <Button onClick={handleSync} disabled={syncing} variant="outline" size="sm" className="gap-2">
                <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "Syncing…" : "Sync from NotebookLM"}
              </Button>
            </div>
          </div>
        ) : sortedFiltered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-ink-mute gap-3">
            <BookOpen className="h-12 w-12 opacity-30" />
            <p className="font-serif text-[14px]">No notebooks match &ldquo;{search}&rdquo;</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {!search.trim() && <CreateNotebookCard onClick={() => setShowCreate(true)} />}
            {sortedFiltered.map((nb, i) => (
              <NotebookCard
                key={nb.id}
                notebook={nb}
                index={i}
                onOpen={() => router.push(`/notebooklm/${nb.id}`)}
                onGenerate={() => setGenerateNotebookId(nb.id)}
                onEdit={() => setEditTarget(nb)}
                onHide={() => setHideTarget(nb)}
                onRestore={() => handleRestore(nb)}
                onDelete={() => setDeleteTarget(nb)}
              />
            ))}
          </div>
        )}
      </div>

      {generateNotebookId && !generateType && (
        <GenerateActionSheet
          onPick={(t) => setGenerateType(t)}
          onClose={() => setGenerateNotebookId(null)}
        />
      )}
      {generateNotebookId && generateType && (
        <GenerateModal
          artifactType={generateType}
          notebookId={generateNotebookId}
          onClose={() => { setGenerateType(null); setGenerateNotebookId(null); }}
          onGenerated={() => {
            const id = generateNotebookId;
            setGenerateType(null);
            setGenerateNotebookId(null);
            // Send the user to the detail page where they can watch progress.
            router.push(`/notebooklm/${id}`);
          }}
        />
      )}

      {showCreate && (
        <CreateNotebookModal onClose={() => setShowCreate(false)} />
      )}

      {editTarget && (
        <EditDialog
          notebook={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={handleEditSaved}
        />
      )}

      <AlertDialog open={!!hideTarget} onOpenChange={(open) => { if (!open) { setHideTarget(null); setActionError(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hide from list?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{hideTarget?.title}&rdquo; will disappear from this list and from your NotebookLM recents. The notebook, its sources, saved artifacts, and R2 files are all preserved — use <span className="font-medium">Delete</span> if you want to remove them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {actionError && <p className="text-sm text-destructive">{actionError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pendingAction}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); handleHideConfirm(); }} disabled={pendingAction}>
              {pendingAction ? <><Loader2 className="h-4 w-4 animate-spin" /> Hiding…</> : "Hide"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setActionError(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete notebook?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes &ldquo;{deleteTarget?.title}&rdquo; from NotebookLM, including all its sources and artifacts. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {actionError && <p className="text-sm text-destructive">{actionError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pendingAction}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDeleteConfirm(); }}
              disabled={pendingAction}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {pendingAction ? <><Loader2 className="h-4 w-4 animate-spin" /> Deleting…</> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
