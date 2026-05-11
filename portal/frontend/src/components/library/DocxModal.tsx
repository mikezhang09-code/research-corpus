"use client";

import { useEffect, useState } from "react";
import { X, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getLibraryFileContent } from "@/lib/api";

export function DocxModal({
  notebookId,
  fileId,
  title,
  onClose,
}: {
  notebookId: string;
  fileId: string;
  title: string;
  onClose: () => void;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getLibraryFileContent(notebookId, fileId, "html")
      .then(setHtml)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [notebookId, fileId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-vellum rounded-[2px] border border-ink shadow-[4px_4px_0_rgb(42_36_24_/_0.18)] w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule shrink-0">
          <h2 className="font-serif-display text-[22px] leading-tight tracking-tight text-ink line-clamp-1">{title}</h2>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-ink-fade hover:text-ink" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4">
          {error ? (
            <div className="flex items-center gap-2 text-terracotta font-mono text-[11px] tracking-[0.1em] uppercase">
              <AlertCircle className="h-4 w-4 shrink-0" />
              Failed to load: {error}
            </div>
          ) : html === null ? (
            <div className="flex items-center gap-2 text-ink-fade font-mono text-[11px] tracking-[0.1em] uppercase">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            /* mammoth output from user's own uploaded docx — no sanitization needed */
            <div
              className="prose prose-sm max-w-none font-serif
                prose-headings:font-serif-display prose-headings:tracking-tight prose-headings:text-ink
                prose-p:leading-relaxed prose-p:text-ink-soft
                prose-strong:text-ink prose-a:text-terracotta"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
