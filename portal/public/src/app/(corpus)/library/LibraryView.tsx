"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, FolderOpen, ArrowUpDown, Plus, CheckSquare, Share2, EyeOff, Tag, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SectionHead } from "@/components/corpus/SectionHead";
import { FolioCard, pickCover } from "@/components/corpus/FolioCard";
import { CreateLibraryNotebookModal } from "@/components/library/CreateLibraryNotebookModal";
import { useIsViewer } from "@/hooks/use-role";
import { SHARED_TAG } from "@/lib/shared-tag";
import { TagFilterBar } from "@/components/library/TagFilterBar";
import { getLibraryNotebooks, updateLibraryNotebook, type LibraryNotebook } from "@/lib/api";

type SortKey = "recent" | "title" | "files";

// Same normalisation as TagInput: lower-case, spaces → dashes.
const normalizeTag = (raw: string) => raw.trim().toLowerCase().replace(/\s+/g, "-");

/**
 * The folio grid. `initialFolios` is read on the server by page.tsx, so the
 * cards arrive with the HTML; the browser no longer downloads and hydrates
 * the page before it even asks for them. Null means the server read failed,
 * and the view fetches the list itself as before.
 */
export default function LibraryView({ initialFolios }: { initialFolios: LibraryNotebook[] | null }) {
  const router = useRouter();
  const isViewer = useIsViewer();
  const [folios, setFolios] = useState<LibraryNotebook[] | null>(initialFolios);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("recent");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());

  // Bulk tagging (admin only).
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
    if (!tag || !folios) return;
    const targets = folios.filter(
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
    setFolios((prev) => prev?.map((f) => updated.get(f.id) ?? f) ?? prev);
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

  useEffect(() => {
    if (initialFolios) return; // server-rendered; nothing to fetch
    let cancelled = false;
    getLibraryNotebooks()
      .then((res) => { if (!cancelled) setFolios(res.items); })
      .catch(() => { if (!cancelled) setFolios([]); });
    return () => { cancelled = true; };
  }, [initialFolios]);

  const existingTags = useMemo(() => {
    const set = new Set<string>();
    for (const f of folios ?? []) for (const t of f.tags) set.add(t);
    return [...set].sort();
  }, [folios]);

  // Tag totals and display order (stable — ordered by frequency then alpha).
  const tagTotals = useMemo(() => {
    const counts = new Map<string, number>();
    for (const nb of folios ?? []) {
      for (const t of nb.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return counts;
  }, [folios]);

  const tagOrder = useMemo(
    () =>
      [...tagTotals.keys()]
        .filter((t) => !(isViewer && t === SHARED_TAG))
        .sort((a, b) => (tagTotals.get(b)! - tagTotals.get(a)!) || a.localeCompare(b)),
    [tagTotals, isViewer],
  );

  function toggleTag(tag: string) {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag); else next.add(tag);
      return next;
    });
  }

  const visible = useMemo(() => {
    if (!folios) return [];
    let list = [...folios];
    if (selectedTags.size > 0) {
      list = list.filter((f) => {
        for (const t of selectedTags) if (!f.tags.includes(t)) return false;
        return true;
      });
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (f) =>
          f.title.toLowerCase().includes(q) ||
          f.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }
    if (sortBy === "title") list.sort((a, b) => a.title.localeCompare(b.title));
    else if (sortBy === "files") list.sort((a, b) => b.file_count - a.file_count);
    else list.sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));
    return list;
  }, [folios, search, sortBy, selectedTags]);

  // Dynamic counts: how many visible folios carry each tag.
  const visibleCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const nb of visible) {
      for (const t of nb.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return counts;
  }, [visible]);

  const pickedTags = useMemo(() => {
    const set = new Set<string>();
    for (const f of folios ?? []) if (picked.has(f.id)) for (const t of f.tags) set.add(t);
    return [...set].sort();
  }, [folios, picked]);

  const allVisiblePicked = visible.length > 0 && visible.every((f) => picked.has(f.id));

  const loading = folios === null;

  return (
    <div className={selecting ? "pb-36" : "pb-16"}>
      <SectionHead eyebrow="Section II" title="My Research" count={folios?.length ?? 0} />

      <div className="px-5 sm:px-8 lg:px-14 space-y-6">
        <p className="font-serif text-[14px] text-ink-soft max-w-2xl">
          {isViewer
            ? "Research folios shared with you — open any file to view it inline."
            : "Research folios and their files. Create folios, upload files, and organise — open any file to view it inline."}
        </p>

        {/* Toolbar: search · sort · new folio */}
        {!loading && (
          <div className="flex items-center gap-3 flex-wrap">
            {folios.length > 0 && (
              <>
                <div className="relative max-w-sm flex-1 min-w-[200px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-mute pointer-events-none" />
                  <Input
                    placeholder="Search folios & tags…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger className="inline-flex items-center gap-1.5 h-9 rounded-[1px] border border-rule bg-vellum hover:bg-paper-deep hover:border-ink px-3 font-mono text-[10px] tracking-[0.14em] uppercase text-ink-fade hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink transition-colors">
                    <ArrowUpDown className="h-3.5 w-3.5" />
                    {sortBy === "recent" ? "Recently updated" : sortBy === "title" ? "Alphabetical" : "Most files"}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setSortBy("recent")}>Recently updated</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setSortBy("title")}>Alphabetical</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setSortBy("files")}>Most files</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
            {!isViewer && folios.length > 0 && (
              <Button
                size="sm"
                variant={selecting ? "default" : "outline"}
                className="gap-1.5 h-9 rounded-[1px] ml-auto"
                onClick={() => (selecting ? exitSelect() : (setSelecting(true), setNotice(null)))}
              >
                <CheckSquare className="h-3.5 w-3.5" />
                {selecting ? "Done" : "Select"}
              </Button>
            )}
            {selecting && visible.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="h-9 rounded-[1px]"
                onClick={() =>
                  setPicked((prev) => {
                    const next = new Set(prev);
                    for (const f of visible) {
                      if (allVisiblePicked) next.delete(f.id); else next.add(f.id);
                    }
                    return next;
                  })
                }
              >
                {allVisiblePicked ? "Clear visible" : `Select all visible (${visible.length})`}
              </Button>
            )}
            {!isViewer && (
              <Button
                size="sm"
                className={`gap-1.5 h-9 rounded-[1px] ${folios.length > 0 ? "" : "ml-auto"}`}
                onClick={() => setShowCreate(true)}
              >
                <Plus className="h-3.5 w-3.5" />
                New folio
              </Button>
            )}
          </div>
        )}

        {/* Tag filter pills */}
        <TagFilterBar
          tags={tagOrder}
          counts={visibleCounts}
          selected={selectedTags}
          onToggle={toggleTag}
          onClear={() => setSelectedTags(new Set())}
        />

        {/* Grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-[280px] rounded-[2px]" />
            ))}
          </div>
        ) : folios.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-ink-mute gap-3">
            <FolderOpen className="h-12 w-12 opacity-30" />
            <p className="font-serif-display text-[20px] tracking-tight text-ink">
              {isViewer ? "Nothing shared yet" : "No folios yet"}
            </p>
            <p className="font-serif text-[14px] text-center max-w-sm text-ink-soft">
              {isViewer
                ? "No folios have been shared with you yet."
                : "Create a research folio to start collecting files."}
            </p>
            {!isViewer && <Button
              variant="outline"
              size="sm"
              className="gap-1.5 rounded-[1px] mt-1"
              onClick={() => setShowCreate(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              New folio
            </Button>}
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-ink-mute gap-3">
            <FolderOpen className="h-12 w-12 opacity-30" />
            <p className="font-serif text-[14px]">No folios match &ldquo;{search}&rdquo;</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {visible.map((nb, i) => (
              <FolioCard
                key={nb.id}
                folio={`MR-${String(i + 1).padStart(3, "0")}`}
                title={nb.title}
                status={nb.hidden ? "archived" : "active"}
                cover={pickCover(nb.id)}
                sources={[]}
                excerpt={
                  nb.description?.trim() ||
                  `${nb.file_count} file${nb.file_count !== 1 ? "s" : ""}`
                }
                tags={nb.tags}
                updated={nb.updated_at}
                selectable={selecting}
                selected={picked.has(nb.id)}
                onClick={() => (selecting ? togglePick(nb.id) : router.push(`/library/${nb.id}`))}
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

      {selecting && !isViewer && (
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
                {existingTags.map((t) => <option key={t} value={t} />)}
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
            {notice && (
              <span className="font-mono text-[10px] tracking-[0.08em] text-ink-fade">{busy ? "Saving…" : notice}</span>
            )}
            {busy && !notice && (
              <span className="font-mono text-[10px] tracking-[0.08em] text-ink-fade">Saving…</span>
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

      {showCreate && !isViewer && (
        <CreateLibraryNotebookModal
          existingTags={existingTags}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
