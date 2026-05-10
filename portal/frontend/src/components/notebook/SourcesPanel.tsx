"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, RefreshCw, Loader2, CheckCircle2, AlertCircle, FileText, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { listSources, type SourceRead } from "@/lib/api";
import { getSourceIcon } from "./source-icons";
import { AddSourceModal } from "./AddSourceModal";

const POLL_INTERVAL_MS = 3000;

export function SourcesPanel({ notebookId }: { notebookId: string }) {
  const [sources, setSources] = useState<SourceRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function load(silent = false) {
    if (!silent) setRefreshing(true);
    try {
      const data = await listSources(notebookId);
      setSources(data);
      const hasProcessing = data.some((s) => s.is_processing);
      if (pollRef.current) clearTimeout(pollRef.current);
      if (hasProcessing) {
        pollRef.current = setTimeout(() => load(true), POLL_INTERVAL_MS);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebookId]);

  const readyCount = sources.filter((s) => s.is_ready).length;

  return (
    <div className="space-y-4">
      {showAdd && (
        <AddSourceModal
          notebookId={notebookId}
          onClose={() => setShowAdd(false)}
          onAdded={(s) => {
            setSources((prev) => [s, ...prev.filter((p) => p.id !== s.id)]);
            // Kick polling so we see processing → ready
            if (pollRef.current) clearTimeout(pollRef.current);
            pollRef.current = setTimeout(() => load(true), POLL_INTERVAL_MS);
          }}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {loading
            ? "Loading sources…"
            : `${sources.length} source${sources.length !== 1 ? "s" : ""}${
                sources.length > 0 ? ` · ${readyCount} ready` : ""
              }`}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline" size="sm" className="gap-2"
            onClick={() => load()} disabled={refreshing}
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button size="sm" className="gap-2" onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4" />
            Add source
          </Button>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      ) : sources.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3 rounded-2xl border-2 border-dashed">
          <FileText className="h-10 w-10 opacity-30" />
          <p className="text-sm font-medium">No sources yet</p>
          <p className="text-xs text-center max-w-xs">
            Add a URL, paste text, or upload a file to give NotebookLM something to work with.
          </p>
          <Button size="sm" className="gap-2 mt-2" onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4" />
            Add source
          </Button>
        </div>
      ) : (
        <div className="space-y-1.5">
          {sources.map((s) => <SourceRow key={s.id} source={s} />)}
        </div>
      )}
    </div>
  );
}

function SourceRow({ source }: { source: SourceRead }) {
  const cfg = getSourceIcon(source.kind);
  const Icon = cfg.icon;
  const display = source.title || source.url || cfg.label;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-card px-3 py-2.5 hover:shadow-sm transition-shadow">
      <span className={`flex items-center justify-center h-9 w-9 rounded-md shrink-0 ${cfg.bg}`}>
        <Icon className={`h-4 w-4 ${cfg.color}`} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{display}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <Badge variant="outline" className="text-xs capitalize">
            {cfg.label}
          </Badge>
          {source.is_processing && (
            <span className="inline-flex items-center gap-1 text-xs text-amber-600">
              <Loader2 className="h-3 w-3 animate-spin" /> Processing
            </span>
          )}
          {source.is_ready && (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
              <CheckCircle2 className="h-3 w-3" /> Ready
            </span>
          )}
          {source.is_error && (
            <span className="inline-flex items-center gap-1 text-xs text-destructive">
              <AlertCircle className="h-3 w-3" /> Error
            </span>
          )}
        </div>
      </div>
      {source.url && (
        <a href={source.url} target="_blank" rel="noopener noreferrer" className="shrink-0">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </a>
      )}
    </div>
  );
}
