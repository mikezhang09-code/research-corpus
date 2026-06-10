"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { X, Loader2, AlertCircle, Pencil, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getLibraryFileBlob } from "@/lib/api";
import { ExpandButton, EXPANDED_MODAL } from "@/components/corpus/Expandable";

// ProseMirror-based OOXML editor — heavy, so loaded only when Edit is clicked.
const DocxEditorPane = dynamic(() => import("./DocxEditorPane"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center gap-2 text-ink-fade font-mono text-[11px] tracking-[0.1em] uppercase p-6">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading editor…
    </div>
  ),
});

// docx-preview renders the .docx client-side with much higher fidelity than
// mammoth's server-side HTML conversion — in particular it keeps numbers
// and formatting inside table cells, which mammoth was dropping.
export function DocxModal({
  notebookId,
  fileId,
  title,
  editable = false,
  onClose,
}: {
  /** Folio id, or null for a free-form file. */
  notebookId: string | null;
  fileId: string;
  title: string;
  /** Show the Edit toggle (true .docx only — the editor can't open legacy .doc). */
  editable?: boolean;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<"view" | "edit">("view");

  useEffect(() => {
    if (mode !== "view") return;
    let cancelled = false;
    (async () => {
      try {
        const buf = await getLibraryFileBlob(notebookId, fileId);
        if (cancelled) return;
        const { renderAsync } = await import("docx-preview");
        if (!containerRef.current) return;
        containerRef.current.innerHTML = "";
        await renderAsync(buf, containerRef.current, undefined, {
          className: "docx-preview",
          inWrapper: false,
          ignoreWidth: false,
          ignoreHeight: false,
          ignoreFonts: false,
          breakPages: false,
          experimental: true,
          useBase64URL: true,
        });
        if (!cancelled) setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [notebookId, fileId, mode]);

  function startEditing() {
    setExpanded(true); // the editor wants room
    setMode("edit");
  }

  function backToView() {
    // Reset here (an event handler) so the effect body stays setState-free;
    // the refetch picks up any edits that were saved.
    setLoading(true);
    setError(null);
    setMode("view");
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={`bg-vellum rounded-[2px] border border-ink shadow-[4px_4px_0_rgb(42_36_24_/_0.18)] w-full ${expanded ? EXPANDED_MODAL : "max-w-4xl max-h-[90vh]"} flex flex-col overflow-hidden`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule shrink-0">
          <h2 className="font-serif-display text-[22px] leading-tight tracking-tight text-ink line-clamp-1">{title}</h2>
          <div className="flex items-center gap-1 shrink-0">
            {editable && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 h-8 rounded-[1px] mr-1"
                onClick={() => (mode === "view" ? startEditing() : backToView())}
              >
                {mode === "view" ? (
                  <><Pencil className="h-3.5 w-3.5" /> Edit</>
                ) : (
                  <><Eye className="h-3.5 w-3.5" /> View</>
                )}
              </Button>
            )}
            <ExpandButton expanded={expanded} onToggle={() => setExpanded(!expanded)} />
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-ink-fade hover:text-ink" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {mode === "edit" ? (
          <div className="flex-1 min-h-0 bg-paper-light">
            <DocxEditorPane notebookId={notebookId} fileId={fileId} title={title} />
          </div>
        ) : (
          <div className="overflow-y-auto flex-1 px-6 py-4 bg-paper-light">
            {error && (
              <div className="flex items-center gap-2 text-terracotta font-mono text-[11px] tracking-[0.1em] uppercase">
                <AlertCircle className="h-4 w-4 shrink-0" />
                Failed to load: {error}
              </div>
            )}
            {loading && !error && (
              <div className="flex items-center gap-2 text-ink-fade font-mono text-[11px] tracking-[0.1em] uppercase">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            )}
            <div
              ref={containerRef}
              className="docx-preview-host"
              style={{ display: loading || error ? "none" : "block" }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
