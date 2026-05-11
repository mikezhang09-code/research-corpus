"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, RefreshCw, Loader2, CheckCircle2, AlertCircle, FileText, ExternalLink, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { listSources, type SourceRead } from "@/lib/api";
import { getSourceIcon } from "./source-icons";
import { AddSourceModal } from "./AddSourceModal";
import { DiscoverSourcesModal } from "./DiscoverSourcesModal";

const POLL_INTERVAL_MS = 3000;

export function SourcesPanel({ notebookId }: { notebookId: string }) {
  const [sources, setSources] = useState<SourceRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showDiscover, setShowDiscover] = useState(false);
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

      {showDiscover && (
        <DiscoverSourcesModal
          notebookId={notebookId}
          onClose={() => setShowDiscover(false)}
          onImported={() => {
            // Imported sources land in NLM as processing → kick a refresh + polling.
            if (pollRef.current) clearTimeout(pollRef.current);
            pollRef.current = setTimeout(() => load(true), POLL_INTERVAL_MS);
          }}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-ink-mute">
          {loading
            ? "Loading sources…"
            : `${sources.length} source${sources.length !== 1 ? "s" : ""}${
                sources.length > 0 ? ` · ${readyCount} ready` : ""
              }`}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline" size="sm" className="gap-2 rounded-[1px]"
            onClick={() => load()} disabled={refreshing}
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button variant="outline" size="sm" className="gap-2 rounded-[1px]" onClick={() => setShowDiscover(true)}>
            <Search className="h-4 w-4" />
            Discover
          </Button>
          <Button size="sm" className="gap-2 rounded-[1px]" onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4" />
            Add source
          </Button>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-[2px]" />
          ))}
        </div>
      ) : sources.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-ink-mute gap-3 rounded-[2px] border border-dashed border-ink/40 bg-vellum">
          <FileText className="h-10 w-10 opacity-30" />
          <p className="font-serif-display text-[18px] tracking-tight text-ink">No sources yet</p>
          <p className="font-serif italic text-[12.5px] text-center max-w-xs text-ink-fade">
            Add a URL, paste text, or upload a file to give NotebookLM something to work with.
          </p>
          <Button size="sm" className="gap-2 mt-2 rounded-[1px]" onClick={() => setShowAdd(true)}>
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
    <div className="flex items-center gap-3 rounded-[2px] border border-rule bg-vellum px-3 py-2.5 hover:border-ink hover:shadow-[2px_2px_0_rgb(42_36_24_/_0.06)] transition-all">
      <span className={`flex items-center justify-center h-9 w-9 rounded-[1px] border border-ink/30 shrink-0 ${cfg.bg}`}>
        <Icon className={`h-4 w-4 ${cfg.color}`} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-serif text-[14px] text-ink truncate">{display}</p>
        <div className="flex items-center gap-2 mt-1">
          <Badge variant="outline" className="font-mono text-[9px] tracking-[0.14em] uppercase rounded-[1px] border-rule text-ink-fade">
            {cfg.label}
          </Badge>
          {source.is_processing && (
            <span className="inline-flex items-center gap-1 font-mono text-[9px] tracking-[0.14em] uppercase text-ochre">
              <Loader2 className="h-3 w-3 animate-spin" /> Processing
            </span>
          )}
          {source.is_ready && (
            <span className="inline-flex items-center gap-1 font-mono text-[9px] tracking-[0.14em] uppercase text-mint">
              <CheckCircle2 className="h-3 w-3" /> Ready
            </span>
          )}
          {source.is_error && (
            <span className="inline-flex items-center gap-1 font-mono text-[9px] tracking-[0.14em] uppercase text-terracotta">
              <AlertCircle className="h-3 w-3" /> Error
            </span>
          )}
        </div>
      </div>
      {source.url && (
        <a href={source.url} target="_blank" rel="noopener noreferrer" className="shrink-0">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-ink-fade hover:text-ink">
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </a>
      )}
    </div>
  );
}
