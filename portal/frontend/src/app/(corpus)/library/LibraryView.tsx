"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, MoreVertical, Pencil, EyeOff, Trash2, Loader2, ArrowUpDown,
  RotateCcw, CheckSquare, Share2, Tag, X,
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
import { TagInput } from "@/components/library/TagInput";
import { TagFilterBar } from "@/components/library/TagFilterBar";
import { EmojiPicker } from "@/components/notebook/EmojiPicker";
import { emojiFromSeed } from "@/components/notebook/emoji";
import { FolioCard, pickCover, type FolioStatus } from "@/components/corpus/FolioCard";
import { SectionHead } from "@/components/corpus/SectionHead";

// Viewer accounts on the public Worker see only folios with this tag.
const SHARED_TAG = "shared";

// Same normalisation as TagInput: lower-case, spaces → dashes.
const normalizeTag = (raw: string) => raw.trim().toLowerCase().replace(/\s+/g, "-");

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
  notebook, index, onOpen, onEdit, onHide, onRestore, onDelete, selectable, selected,
}: {
  notebook: LibraryNotebook;
  index: number;
  selectable?: boolean;
  selected?: boolean;
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
      {!selectable && <NotebookCardActions
        notebook={notebook}
        onEdit={onEdit}
        onHide={onHide}
        onRestore={onRestore}
        onDelete={onDelete}
      />}
      <FolioCard
        folio={folio}
        title={notebook.title}
        status={status}
        cover={cover}
        sources={[]}
        excerpt={excerpt}
        tags={notebook.tags}
        updated={notebook.updated_at}
        selectable={selectable}
        selected={selected}
        onClick={onOpen}
      />
    </div>
  );
}

function tagsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function EditDialog({ notebook, suggestions, onClose, onSaved }: {
  notebook: LibraryNotebook;
  suggestions: string[];
  onClose: () => void;
  onSaved: (updated: LibraryNotebook) => void;
}) {
  const [title, setTitle] = useState(notebook.title);
  const [emoji, setEmoji] = useState<string>(notebook.cover_emoji || emojiFromSeed(notebook.id));
  const [tags, setTags] = useState<string[]>(notebook.tags);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const titleChanged = title.trim() !== notebook.title;
  const emojiChanged = emoji !== (notebook.cover_emoji || emojiFromSeed(notebook.id));
  const tagsChanged = !tagsEqual(tags, notebook.tags);
  const dirty = titleChanged || emojiChanged || tagsChanged;

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
        <div>
          <label className="block font-mono text-[10px] tracking-[0.18em] uppercase text-ink-mute mb-2">Tags</label>
          <TagInput value={tags} onChange={setTags} suggestions={suggestions} disabled={saving} />
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

/**
 * The folio grid. `initialFolios` (non-hidden folios) is read on the server by
 * page.tsx, so the cards arrive with the HTML instead of after the page's JS
 * has downloaded and hydrated. Null means that read failed; the view then
 * fetches as before. Toggling "show hidden" still refetches.
 */
export default function LibraryView({ initialFolios }: { initialFolios: LibraryNotebook[] | null }) {
  const router = useRouter();
  const [notebooks, setNotebooks] = useState<LibraryNotebook[]>(initialFolios ?? []);
  const [loading, setLoading] = useState(initialFolios === null);
  // Skip the mount-time fetch when the server already supplied the list.
  const skipInitialLoad = useRef(initialFolios !== null);
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<LibraryNotebook | null>(null);
  const [hideTarget, setHideTarget] = useState<LibraryNotebook | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LibraryNotebook | null>(null);
  const [pendingAction, setPendingAction] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [sortBy, setSortBy] = useState<"recent" | "title" | "files">("recent");
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());

  // Bulk tagging.
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [tagDraft, setTagDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  function exitSelect() {
    setSelecting(false);
    setPicked(new Set());
    setTagDraft("");
  }

  function togglePick(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  /** Add or remove one tag on every picked folio, keeping their other tags. */
  async function bulkTag(rawTag: string, mode: "add" | "remove") {
    const tag = normalizeTag(rawTag);
    if (!tag) return;
    const targets = notebooks.filter(
      (f) => picked.has(f.id) && (mode === "add" ? !f.tags.includes(tag) : f.tags.includes(tag)),
    );
    if (targets.length === 0) {
      setNotice(mode === "add" ? `All selected folios already have “${tag}”.` : `No selected folio has “${tag}”.`);
      return;
    }
    setBusy(true);
    setNotice(null);
    const updated = new Map<string, LibraryNotebook>();
    let failed = 0;
    // Small batches so a large selection doesn't flood the API.
    for (let i = 0; i < targets.length; i += 5) {
      const batch = targets.slice(i, i + 5);
      const results = await Promise.allSettled(
        batch.map((f) =>
          updateLibraryNotebook(f.id, {
            tags: mode === "add" ? [...f.tags, tag] : f.tags.filter((t) => t !== tag),
          }),
        ),
      );
      results.forEach((r) => {
        if (r.status === "fulfilled") updated.set(r.value.id, r.value);
        else failed++;
      });
    }
    setNotebooks((prev) => prev.map((f) => updated.get(f.id) ?? f));
    setBusy(false);
    setTagDraft("");
    const verb = tag === SHARED_TAG
      ? (mode === "add" ? "Shared with viewer" : "Unshared")
      : (mode === "add" ? `Tagged “${tag}”` : `Removed “${tag}” from`);
    setNotice(
      `${verb}: ${updated.size} folio${updated.size !== 1 ? "s" : ""}` +
        (failed ? ` — ${failed} failed, try again.` : "."),
    );
  }

  async function load(includeHidden = showHidden) {
    try {
      const res = await getLibraryNotebooks({ includeHidden });
      setNotebooks(res.items);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (skipInitialLoad.current) {
      skipInitialLoad.current = false;
      return;
    }
    load(showHidden);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHidden]);

  // Universe of tags + their total counts (stable across selection).
  // We use the total count to pick a fixed display order so chips don't
  // jump around as the user clicks — only the displayed number changes.
  const tagTotals = useMemo(() => {
    const counts = new Map<string, number>();
    for (const nb of notebooks) {
      for (const t of nb.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return counts;
  }, [notebooks]);

  const tagOrder = useMemo(
    () =>
      [...tagTotals.keys()].sort(
        (a, b) => (tagTotals.get(b)! - tagTotals.get(a)!) || a.localeCompare(b, "en")
      ),
    [tagTotals]
  );

  const allTags = tagOrder;

  function toggleTag(tag: string) {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag); else next.add(tag);
      return next;
    });
  }

  const filtered = useMemo(() => {
    let list = notebooks;
    if (selectedTags.size > 0) {
      list = list.filter((n) => {
        for (const t of selectedTags) if (!n.tags.includes(t)) return false;
        return true;
      });
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((n) =>
        n.title.toLowerCase().includes(q) ||
        n.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    return [...list].sort((a, b) => {
      if (sortBy === "title") return a.title.localeCompare(b.title);
      if (sortBy === "files") return b.file_count - a.file_count;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [notebooks, search, sortBy, selectedTags]);

  // Dynamic counts: how many currently-visible folios carry each tag.
  // For an unselected tag this is "what you'd see if you added this tag";
  // for a selected tag it equals the visible total.
  const visibleCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const nb of filtered) {
      for (const t of nb.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return counts;
  }, [filtered]);

  const pickedTags = useMemo(() => {
    const set = new Set<string>();
    for (const f of notebooks) if (picked.has(f.id)) for (const t of f.tags) set.add(t);
    return [...set].sort();
  }, [notebooks, picked]);

  const allVisiblePicked = filtered.length > 0 && filtered.every((f) => picked.has(f.id));

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
    <div className={selecting ? "pb-36" : "pb-16"}>
      <SectionHead eyebrow="Section II" title="My Research" count={notebooks.length} />

      <div className="px-5 sm:px-8 lg:px-14 space-y-6">
        {/* Action row */}
        <div className="flex items-center justify-end gap-2 flex-wrap">
          {selecting && filtered.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setPicked((prev) => {
                  const next = new Set(prev);
                  for (const f of filtered) {
                    if (allVisiblePicked) next.delete(f.id); else next.add(f.id);
                  }
                  return next;
                })
              }
            >
              {allVisiblePicked ? "Clear visible" : `Select all visible (${filtered.length})`}
            </Button>
          )}
          {notebooks.length > 0 && (
            <Button
              size="sm"
              variant={selecting ? "default" : "outline"}
              className="gap-2"
              onClick={() => (selecting ? exitSelect() : (setSelecting(true), setNotice(null)))}
            >
              <CheckSquare className="h-4 w-4" />
              {selecting ? "Done" : "Select"}
            </Button>
          )}
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
              onChange={(e) => {
                setLoading(true);
                setShowHidden(e.target.checked);
              }}
              className="h-4 w-4 rounded-[1px] border-rule"
            />
            Show hidden
          </label>
        </div>

        <TagFilterBar
          tags={tagOrder}
          counts={visibleCounts}
          selected={selectedTags}
          onToggle={toggleTag}
          onClear={() => setSelectedTags(new Set())}
        />

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
            {!selecting && <CreateNotebookCard onClick={() => setShowCreate(true)} />}
            {filtered.map((nb, i) => (
              <NotebookCard
                key={nb.id}
                notebook={nb}
                index={i}
                selectable={selecting}
                selected={picked.has(nb.id)}
                onOpen={() => (selecting ? togglePick(nb.id) : router.push(`/library/${nb.id}`))}
                onEdit={() => setEditTarget(nb)}
                onHide={() => setHideTarget(nb)}
                onRestore={() => handleRestore(nb)}
                onDelete={() => setDeleteTarget(nb)}
              />
            ))}
          </div>
        )}
      </div>

      {notice && !selecting && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-ink text-paper font-mono text-[11px] tracking-[0.08em] px-4 py-2 rounded-[2px] shadow-lg flex items-center gap-3">
          {notice}
          <button onClick={() => setNotice(null)} aria-label="Dismiss"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {selecting && (
        <div className="fixed bottom-0 inset-x-0 z-40 border-t border-rule bg-vellum/95 backdrop-blur px-5 sm:px-8 lg:px-14 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink mr-2">
              {picked.size} selected
            </span>
            <Button
              size="sm"
              className="gap-1.5 h-8 rounded-[1px]"
              disabled={busy || picked.size === 0}
              onClick={() => bulkTag(SHARED_TAG, "add")}
            >
              <Share2 className="h-3.5 w-3.5" />
              Share with viewer
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 h-8 rounded-[1px]"
              disabled={busy || picked.size === 0}
              onClick={() => bulkTag(SHARED_TAG, "remove")}
            >
              <EyeOff className="h-3.5 w-3.5" />
              Unshare
            </Button>
            <span className="w-px h-6 bg-rule mx-1" />
            <form
              className="flex items-center gap-1.5"
              onSubmit={(e) => { e.preventDefault(); bulkTag(tagDraft, "add"); }}
            >
              <Input
                list="bulk-tag-suggestions"
                placeholder="tag name…"
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                className="h-8 w-36"
                disabled={busy}
              />
              <datalist id="bulk-tag-suggestions">
                {allTags.map((t) => <option key={t} value={t} />)}
              </datalist>
              <Button
                type="submit"
                size="sm"
                variant="outline"
                className="gap-1.5 h-8 rounded-[1px]"
                disabled={busy || picked.size === 0 || !normalizeTag(tagDraft)}
              >
                <Tag className="h-3.5 w-3.5" />
                Add tag
              </Button>
            </form>
            <DropdownMenu>
              <DropdownMenuTrigger
                disabled={busy || pickedTags.length === 0}
                className="inline-flex items-center gap-1.5 h-8 rounded-[1px] border border-rule bg-vellum hover:bg-paper-deep hover:border-ink px-3 font-mono text-[10px] tracking-[0.14em] uppercase text-ink-fade hover:text-ink disabled:opacity-50 disabled:pointer-events-none"
              >
                <X className="h-3.5 w-3.5" />
                Remove tag
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top">
                {pickedTags.map((t) => (
                  <DropdownMenuItem key={t} onClick={() => bulkTag(t, "remove")}>
                    {t}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {(busy || notice) && (
              <span className="font-mono text-[10px] tracking-[0.08em] text-ink-fade">
                {busy ? "Saving…" : notice}
              </span>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-8 rounded-[1px] ml-auto"
              onClick={exitSelect}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {showCreate && (
        <CreateLibraryNotebookModal
          onClose={() => setShowCreate(false)}
          existingTags={allTags}
        />
      )}

      {editTarget && (
        <EditDialog
          notebook={editTarget}
          suggestions={allTags}
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
