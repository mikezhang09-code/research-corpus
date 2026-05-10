"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, BookOpen, Search, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { getNotebooks, syncNotebooks, type Notebook } from "@/lib/api";
import { GenerateActionSheet } from "@/components/generate/GenerateActionSheet";
import { GenerateModal } from "@/components/generate/GenerateModal";
import { CreateNotebookModal } from "@/components/notebook/CreateNotebookModal";

// Rotating palette for notebook card headers — one color per notebook
const PALETTE = [
  { header: "bg-blue-100",   icon: "text-blue-500"   },
  { header: "bg-violet-100", icon: "text-violet-500" },
  { header: "bg-teal-100",   icon: "text-teal-500"   },
  { header: "bg-amber-100",  icon: "text-amber-500"  },
  { header: "bg-rose-100",   icon: "text-rose-500"   },
  { header: "bg-indigo-100", icon: "text-indigo-500" },
  { header: "bg-emerald-100",icon: "text-emerald-500"},
  { header: "bg-orange-100", icon: "text-orange-500" },
];

function NotebookCard({ notebook, index, onOpen, onGenerate }: {
  notebook: Notebook;
  index: number;
  onOpen: () => void;
  onGenerate: () => void;
}) {
  const color = PALETTE[index % PALETTE.length];
  const created = notebook.nlm_created_at
    ? new Date(notebook.nlm_created_at).toLocaleDateString("en-US", {
        month: "short", day: "numeric", year: "numeric",
      })
    : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      className="group relative cursor-pointer text-left rounded-2xl overflow-hidden border border-border/50 bg-card shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {/* Colored header area */}
      <div className={`${color.header} flex items-center justify-center h-36 relative`}>
        <BookOpen className={`h-14 w-14 ${color.icon} opacity-80`} />
        {/* Source count badge */}
        <span className="absolute bottom-3 right-3 text-xs font-medium px-2 py-0.5 rounded-full bg-white/70 text-foreground/70">
          {notebook.sources_count} source{notebook.sources_count !== 1 ? "s" : ""}
        </span>
        {/* Generate badge */}
        <button
          type="button"
          aria-label="Generate artifact"
          onClick={(e) => { e.stopPropagation(); onGenerate(); }}
          className="absolute top-2 right-2 h-7 w-7 rounded-full bg-white/85 hover:bg-white shadow-sm flex items-center justify-center text-foreground/70 hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* Content */}
      <div className="px-4 py-3 bg-background">
        <p className="font-semibold text-sm leading-snug line-clamp-2 group-hover:text-primary transition-colors">
          {notebook.title}
        </p>
        {created && (
          <p className="text-xs text-muted-foreground mt-1">{created}</p>
        )}
      </div>
    </div>
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

  async function load() {
    setLoading(true);
    const nbs = await getNotebooks();
    setNotebooks(nbs);
    setFiltered(nbs);
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  async function handleSync() {
    setSyncing(true);
    await syncNotebooks();
    await load();
    setSyncing(false);
  }

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
    <div className="p-8 max-w-7xl space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">NotebookLM</h1>
        <div className="flex items-center gap-2 shrink-0">
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

      {/* Search */}
      {notebooks.length > 0 && (
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search notebooks…"
            value={search}
            onChange={handleSearch}
            className="pl-9"
          />
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-52 rounded-2xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground gap-3">
          <BookOpen className="h-12 w-12 opacity-20" />
          {notebooks.length === 0 ? (
            <>
              <p className="font-medium">No notebooks yet</p>
              <p className="text-sm text-center max-w-xs">
                Click &ldquo;Sync notebooks&rdquo; to import your notebooks from NotebookLM.
              </p>
              <Button onClick={handleSync} disabled={syncing} className="mt-2 gap-2">
                <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "Syncing…" : "Sync now"}
              </Button>
            </>
          ) : (
            <p className="text-sm">No notebooks match &ldquo;{search}&rdquo;</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filtered.map((nb, i) => (
            <NotebookCard
              key={nb.id}
              notebook={nb}
              index={i}
              onOpen={() => router.push(`/notebooklm/${nb.id}`)}
              onGenerate={() => setGenerateNotebookId(nb.id)}
            />
          ))}
        </div>
      )}

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
    </div>
  );
}
