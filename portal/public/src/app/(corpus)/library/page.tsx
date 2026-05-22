"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, FolderOpen, ArrowUpDown, Plus } from "lucide-react";
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
import { getLibraryNotebooks, type LibraryNotebook } from "@/lib/api";

type SortKey = "recent" | "title" | "files";

export default function LibraryPage() {
  const router = useRouter();
  const [folios, setFolios] = useState<LibraryNotebook[] | null>(null);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("recent");
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getLibraryNotebooks()
      .then((res) => { if (!cancelled) setFolios(res.items); })
      .catch(() => { if (!cancelled) setFolios([]); });
    return () => { cancelled = true; };
  }, []);

  const existingTags = useMemo(() => {
    const set = new Set<string>();
    for (const f of folios ?? []) for (const t of f.tags) set.add(t);
    return [...set].sort();
  }, [folios]);

  const visible = useMemo(() => {
    if (!folios) return [];
    const q = search.trim().toLowerCase();
    const arr = q
      ? folios.filter(
          (f) =>
            f.title.toLowerCase().includes(q) ||
            f.tags.some((t) => t.toLowerCase().includes(q)),
        )
      : [...folios];
    if (sortBy === "title") arr.sort((a, b) => a.title.localeCompare(b.title));
    else if (sortBy === "files") arr.sort((a, b) => b.file_count - a.file_count);
    else arr.sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));
    return arr;
  }, [folios, search, sortBy]);

  const loading = folios === null;

  return (
    <div className="pb-16">
      <SectionHead eyebrow="Section II" title="My Research" count={folios?.length ?? 0} />

      <div className="px-14 space-y-6">
        <p className="font-serif text-[14px] text-ink-soft max-w-2xl">
          Research folios and their files. Create folios, upload files, and
          organise — open any file to view it inline.
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
            <Button
              size="sm"
              className="gap-1.5 h-9 rounded-[1px] ml-auto"
              onClick={() => setShowCreate(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              New folio
            </Button>
          </div>
        )}

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
            <p className="font-serif-display text-[20px] tracking-tight text-ink">No folios yet</p>
            <p className="font-serif text-[14px] text-center max-w-sm text-ink-soft">
              Create a research folio to start collecting files.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 rounded-[1px] mt-1"
              onClick={() => setShowCreate(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              New folio
            </Button>
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
                onClick={() => router.push(`/library/${nb.id}`)}
              />
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateLibraryNotebookModal
          existingTags={existingTags}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
