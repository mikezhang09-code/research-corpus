"use client";

import { useEffect, useState } from "react";
import { Sparkles, MessageSquarePlus, AlertCircle, Info } from "lucide-react";
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
  const [loadedId, setLoadedId] = useState(notebookId);

  // Reset to the skeleton the moment the notebook changes — before the new
  // fetch resolves — so we never flash the previous notebook's synopsis. This
  // is React's documented "adjust state during render" pattern.
  if (loadedId !== notebookId) {
    setLoadedId(notebookId);
    setData(null);
    setError(null);
  }

  useEffect(() => {
    let cancelled = false;
    getNotebookDescription(notebookId)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [notebookId]);

  if (error) {
    return (
      <div className="flex items-start gap-2 font-mono text-[10px] tracking-[0.1em] uppercase text-ink-mute bg-vellum border border-rule rounded-[1px] p-3">
        <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span>Couldn&apos;t load summary: {error}</span>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-[2px] border border-rule bg-vellum p-4 space-y-3">
        <Skeleton className="h-4 w-32 rounded-[1px]" />
        <Skeleton className="h-3 w-full rounded-[1px]" />
        <Skeleton className="h-3 w-5/6 rounded-[1px]" />
        <Skeleton className="h-3 w-4/6 rounded-[1px]" />
        <div className="flex gap-2 pt-1">
          <Skeleton className="h-7 w-40 rounded-[1px]" />
          <Skeleton className="h-7 w-48 rounded-[1px]" />
        </div>
      </div>
    );
  }

  // Some notebooks (e.g. brand new with no sources) have no summary yet.
  if (!data.summary && data.suggested_topics.length === 0) {
    return null;
  }

  return (
    <div className="rounded-[2px] border border-ink bg-vellum p-5 space-y-3 shadow-[2px_2px_0_rgb(42_36_24_/_0.08)]">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.18em] uppercase text-terracotta">
          <Sparkles className="h-3.5 w-3.5" />
          Synopsis
        </div>
        <span
          className="inline-flex items-center gap-1 font-mono text-[9px] tracking-[0.14em] uppercase text-ink-mute"
          title="NotebookLM generates this summary and chooses its own language based on your NotebookLM account locale and source content. This portal's language setting does not control it."
        >
          <Info className="h-3 w-3" />
          NotebookLM language
        </span>
      </div>

      {data.summary && (
        <div className="prose prose-sm max-w-none font-serif
          prose-p:leading-relaxed prose-p:text-ink-soft
          prose-strong:text-ink prose-strong:font-semibold
          prose-headings:font-serif-display prose-headings:tracking-tight prose-headings:text-ink
          prose-a:text-terracotta prose-a:underline prose-a:underline-offset-2
          prose-code:bg-paper-deep prose-code:px-1 prose-code:rounded-[1px] prose-code:font-mono prose-code:text-ink">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.summary}</ReactMarkdown>
        </div>
      )}

      {data.suggested_topics.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-2 border-t border-rule-light">
          {data.suggested_topics.map((t, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onAskTopic(t.prompt)}
              className="inline-flex items-center gap-1.5 max-w-full rounded-[1px] border border-rule bg-paper hover:bg-paper-deep hover:border-ink px-3 py-1.5 font-serif text-[12.5px] text-ink-soft hover:text-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
              title={t.prompt}
            >
              <MessageSquarePlus className="h-3 w-3 shrink-0 text-terracotta" />
              <span className="truncate italic">{t.question}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
