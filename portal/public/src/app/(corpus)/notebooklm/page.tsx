"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Database, ArrowUpDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SectionHead } from "@/components/corpus/SectionHead";
import { CorpusCard, pickSwatch } from "@/components/corpus/CorpusCard";
import { getArtifacts, type NLMArtifact } from "@/lib/api";

// A "corpus" = one NotebookLM notebook, derived by grouping its saved
// artifacts. There is no live notebook list in this public app — only the
// artifacts that were saved to the portal (Supabase + R2).
type Corpus = {
  notebookId: string;
  title: string;
  count: number;
  latest: string; // ISO date of the most recent artifact
};

function groupByNotebook(items: NLMArtifact[]): Corpus[] {
  const map = new Map<string, Corpus>();
  for (const a of items) {
    if (!a.notebook_id) continue;
    const date = a.nlm_created_at ?? a.portal_added_at ?? "";
    const existing = map.get(a.notebook_id);
    if (existing) {
      existing.count += 1;
      if (date > existing.latest) existing.latest = date;
    } else {
      map.set(a.notebook_id, {
        notebookId: a.notebook_id,
        title: a.notebook_title?.trim() || "Untitled notebook",
        count: 1,
        latest: date,
      });
    }
  }
  return [...map.values()];
}

type SortKey = "recent" | "title" | "artifacts";

export default function NotebookLMCorpusPage() {
  const router = useRouter();
  const [corpora, setCorpora] = useState<Corpus[] | null>(null);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("recent");

  useEffect(() => {
    let cancelled = false;
    getArtifacts({ limit: 200 })
      .then((res) => { if (!cancelled) setCorpora(groupByNotebook(res.items)); })
      .catch(() => { if (!cancelled) setCorpora([]); });
    return () => { cancelled = true; };
  }, []);

  const visible = useMemo(() => {
    if (!corpora) return [];
    const q = search.trim().toLowerCase();
    const arr = q ? corpora.filter((c) => c.title.toLowerCase().includes(q)) : [...corpora];
    if (sortBy === "title") arr.sort((a, b) => a.title.localeCompare(b.title));
    else if (sortBy === "artifacts") arr.sort((a, b) => b.count - a.count);
    else arr.sort((a, b) => (a.latest < b.latest ? 1 : a.latest > b.latest ? -1 : 0));
    return arr;
  }, [corpora, search, sortBy]);

  const loading = corpora === null;

  return (
    <div className="pb-16">
      <SectionHead eyebrow="Section I" title="NotebookLM Corpus" count={corpora?.length ?? 0} />

      <div className="px-5 sm:px-8 lg:px-14 space-y-6">
        <p className="font-serif text-[14px] text-ink-soft max-w-2xl">
          Saved artifacts from NotebookLM, grouped by notebook. This is a read-only
          archive — generate new artifacts from the private Research portal.
        </p>

        {/* Toolbar: search · sort */}
        {!loading && corpora.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative max-w-sm flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-mute pointer-events-none" />
              <Input
                placeholder="Search corpora…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex items-center gap-1.5 h-9 rounded-[1px] border border-rule bg-vellum hover:bg-paper-deep hover:border-ink px-3 font-mono text-[10px] tracking-[0.14em] uppercase text-ink-fade hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink transition-colors">
                <ArrowUpDown className="h-3.5 w-3.5" />
                {sortBy === "recent" ? "Most recent" : sortBy === "title" ? "Alphabetical" : "Most artifacts"}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setSortBy("recent")}>Most recent</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSortBy("title")}>Alphabetical</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSortBy("artifacts")}>Most artifacts</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        {/* Grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[5/3] rounded-[2px]" />
            ))}
          </div>
        ) : corpora.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-ink-mute gap-3">
            <Database className="h-12 w-12 opacity-30" />
            <p className="font-serif-display text-[20px] tracking-tight text-ink">No saved artifacts yet</p>
            <p className="font-serif text-[14px] text-center max-w-sm text-ink-soft">
              Save artifacts to the portal from the private Research portal — they will
              appear here grouped by notebook.
            </p>
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-ink-mute gap-3">
            <Database className="h-12 w-12 opacity-30" />
            <p className="font-serif text-[14px]">No corpora match &ldquo;{search}&rdquo;</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {visible.map((c, i) => (
              <CorpusCard
                key={c.notebookId}
                number={i + 1}
                domain="NLM"
                title={c.title}
                date={c.latest}
                sources={c.count}
                swatch={pickSwatch({ id: c.notebookId })}
                onClick={() => router.push(`/notebooklm/${c.notebookId}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
