"use client";

import { useEffect, useState } from "react";
import { Sparkles, MessageSquarePlus, AlertCircle } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Skeleton } from "@/components/ui/skeleton";
import { getNotebookDescription, type NotebookDescriptionResponse } from "@/lib/api";

export function NotebookDescription({
  notebookId,
  onAskTopic,
}: {
  notebookId: string;
  onAskTopic: (prompt: string) => void;
}) {
  const [data, setData] = useState<NotebookDescriptionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    getNotebookDescription(notebookId)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [notebookId]);

  if (error) {
    return (
      <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/40 border border-border/50 rounded-xl p-3">
        <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span>Couldn&apos;t load summary: {error}</span>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-4/6" />
        <div className="flex gap-2 pt-1">
          <Skeleton className="h-7 w-40 rounded-full" />
          <Skeleton className="h-7 w-48 rounded-full" />
        </div>
      </div>
    );
  }

  // Some notebooks (e.g. brand new with no sources) have no summary yet.
  if (!data.summary && data.suggested_topics.length === 0) {
    return null;
  }

  return (
    <div className="rounded-xl border border-border/50 bg-gradient-to-br from-primary/5 via-card to-card p-4 space-y-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary/80">
        <Sparkles className="h-3.5 w-3.5" />
        Notebook overview
      </div>

      {data.summary && (
        <div className="prose prose-sm max-w-none prose-p:leading-relaxed prose-p:text-foreground/90 prose-strong:text-foreground prose-strong:font-semibold">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.summary}</ReactMarkdown>
        </div>
      )}

      {data.suggested_topics.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {data.suggested_topics.map((t, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onAskTopic(t.prompt)}
              className="inline-flex items-center gap-1.5 max-w-full rounded-full border border-border/60 bg-background hover:bg-primary/10 hover:border-primary/40 px-3 py-1.5 text-xs text-foreground/80 hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              title={t.prompt}
            >
              <MessageSquarePlus className="h-3 w-3 shrink-0" />
              <span className="truncate">{t.question}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
