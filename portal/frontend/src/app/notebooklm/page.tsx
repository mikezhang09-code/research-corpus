"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Download, BookOpen, FileText, Music, Video, Image, BarChart2, Brain, StickyNote, Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getArtifacts, getNotebooks, syncNotebooks, type NLMArtifact, type Notebook } from "@/lib/api";

const ARTIFACT_ICONS: Record<string, React.ElementType> = {
  audio: Music,
  video: Video,
  report: FileText,
  quiz: Brain,
  flashcards: StickyNote,
  infographic: Image,
  slide_deck: Layers,
  data_table: BarChart2,
  mind_map: Brain,
};

const STATUS_COLORS: Record<string, string> = {
  done: "bg-emerald-500/10 text-emerald-600 border-emerald-200",
  downloading: "bg-blue-500/10 text-blue-600 border-blue-200",
  pending: "bg-amber-500/10 text-amber-600 border-amber-200",
  failed: "bg-red-500/10 text-red-600 border-red-200",
};

function ArtifactCard({ artifact }: { artifact: NLMArtifact }) {
  const Icon = ARTIFACT_ICONS[artifact.artifact_type] ?? FileText;
  const size = artifact.file_size_bytes
    ? artifact.file_size_bytes > 1_000_000
      ? `${(artifact.file_size_bytes / 1_000_000).toFixed(1)} MB`
      : `${Math.round(artifact.file_size_bytes / 1024)} KB`
    : null;

  return (
    <Card className="group hover:shadow-md transition-shadow border-border/60">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="shrink-0 rounded-md bg-primary/8 p-2">
              <Icon className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-sm font-medium truncate">
                {artifact.title || artifact.artifact_type}
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                {artifact.notebook_title ?? "Unknown notebook"}
              </p>
            </div>
          </div>
          <Badge
            variant="outline"
            className={`shrink-0 text-xs capitalize ${STATUS_COLORS[artifact.download_status]}`}
          >
            {artifact.download_status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {artifact.summary && (
          <p className="text-xs text-muted-foreground line-clamp-2">{artifact.summary}</p>
        )}
        <div className="flex items-center justify-between">
          <div className="flex gap-1 flex-wrap">
            <Badge variant="secondary" className="text-xs capitalize">
              {artifact.artifact_type.replace("_", " ")}
            </Badge>
            <Badge variant="outline" className="text-xs uppercase">
              {artifact.file_format}
            </Badge>
            {size && <span className="text-xs text-muted-foreground self-center">{size}</span>}
          </div>
          {artifact.download_status === "done" && artifact.r2_url && (
            <a href={artifact.r2_url} target="_blank" rel="noopener noreferrer">
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1">
                <Download className="h-3 w-3" /> Open
              </Button>
            </a>
          )}
        </div>
        {artifact.tags.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {artifact.tags.map((t) => (
              <Badge key={t} variant="outline" className="text-xs text-muted-foreground">
                {t}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function NotebookLMPage() {
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [artifacts, setArtifacts] = useState<NLMArtifact[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [activeType, setActiveType] = useState("all");
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);

  const TYPES = ["all", "audio", "video", "report", "quiz", "flashcards", "infographic", "slide_deck", "data_table", "mind_map"];

  async function load(type = activeType, q = search) {
    setLoading(true);
    const params: Record<string, string> = {};
    if (type !== "all") params.artifact_type = type;
    if (q) params.search = q;
    const [nb, art] = await Promise.all([getNotebooks(), getArtifacts(params)]);
    setNotebooks(nb);
    setArtifacts(art.items);
    setTotal(art.total);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleSync() {
    setSyncing(true);
    await syncNotebooks();
    await load();
    setSyncing(false);
  }

  function handleTypeChange(t: string) {
    setActiveType(t);
    load(t, search);
  }

  function handleSearch(e: React.ChangeEvent<HTMLInputElement>) {
    setSearch(e.target.value);
    load(activeType, e.target.value);
  }

  return (
    <div className="p-8 space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-primary" />
            NotebookLM
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {notebooks.length} notebook{notebooks.length !== 1 ? "s" : ""} · {total} artifact{total !== 1 ? "s" : ""}
          </p>
        </div>
        <Button onClick={handleSync} disabled={syncing} variant="outline" size="sm" className="gap-2">
          <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Syncing…" : "Sync notebooks"}
        </Button>
      </div>

      {/* Search */}
      <Input
        placeholder="Search artifacts…"
        value={search}
        onChange={handleSearch}
        className="max-w-sm"
      />

      {/* Type tabs */}
      <Tabs value={activeType} onValueChange={handleTypeChange}>
        <TabsList className="flex-wrap h-auto gap-1">
          {TYPES.map((t) => (
            <TabsTrigger key={t} value={t} className="capitalize text-xs">
              {t === "all" ? "All" : t.replace("_", " ")}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value={activeType} className="mt-6">
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-44 rounded-xl" />
              ))}
            </div>
          ) : artifacts.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground">
              <BookOpen className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No artifacts yet. Sync your notebooks to get started.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {artifacts.map((a) => <ArtifactCard key={a.id} artifact={a} />)}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
