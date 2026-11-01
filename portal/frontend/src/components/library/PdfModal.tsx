"use client";

// PDF viewer/editor modal. The portal used to hand PDFs off to the browser
// ("Open" in a new tab), which meant no search, no thumbnails, no outline, no
// editing, and a different chrome on every machine. This renders them in-app
// with pdf.js instead, and offers a pdf-lib editor for files we own.
//
// Works two ways:
//   • notebookId + fileId → a folio or free-form file; editable.
//   • contentUrl          → any same-origin bytes URL (e.g. a saved Corpus
//                           artifact streamed by our own route); read-only,
//                           since the Corpus is read-only.

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { Eye, Loader2, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getLibraryFileBlob } from "@/lib/api";
import { ExpandButton, EXPANDED_MODAL } from "@/components/corpus/Expandable";

function LoadingLine({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 text-ink-fade font-mono text-[11px] tracking-[0.1em] uppercase p-6">
      <Loader2 className="h-4 w-4 animate-spin" /> {text}
    </div>
  );
}

// pdf.js — heavy, so it only loads when a PDF is actually opened.
const PdfViewerPane = dynamic(() => import("./PdfViewerPane"), {
  ssr: false,
  loading: () => <LoadingLine text="Loading viewer…" />,
});
// pdf.js + pdf-lib — heavier still, loaded only on Edit.
const PdfEditorPane = dynamic(() => import("./PdfEditorPane"), {
  ssr: false,
  loading: () => <LoadingLine text="Loading editor…" />,
});

export function PdfModal({
  notebookId = null,
  fileId,
  contentUrl,
  downloadUrl,
  title,
  editable = false,
  onClose,
  onSaved,
}: {
  /** Folio id, or null for a free-form file. Ignored when `src` is used. */
  notebookId?: string | null;
  /** Stored file to read through the content endpoint. */
  fileId?: string;
  /** Same-origin URL to read the bytes from instead — read-only. Must be
   *  same-origin (or CORS-enabled): the viewer parses the bytes in the page. */
  contentUrl?: string;
  /** Direct link for the viewer's Download button, when there is one. */
  downloadUrl?: string | null;
  title: string;
  /** Show the Edit toggle. Requires `fileId`. */
  editable?: boolean;
  onClose: () => void;
  /** Called after the editor saved, so the caller can refresh its row. */
  onSaved?: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<"view" | "edit">("view");
  // Bumped after an edit so the viewer remounts and refetches the saved bytes.
  const [reloadKey, setReloadKey] = useState(0);
  const [pages, setPages] = useState<number | null>(null);

  // Mount-once trigger so createPortal(document.body) is safe.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true); }, []);

  // Esc closes — but let the editor's own inputs swallow it first.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const fetchBytes = useCallback(async (): Promise<ArrayBuffer> => {
    if (fileId) return getLibraryFileBlob(notebookId, fileId);
    if (!contentUrl) throw new Error("No PDF source given");
    const res = await fetch(contentUrl);
    if (!res.ok) throw new Error(`Fetch ${res.status}`);
    return res.arrayBuffer();
  }, [notebookId, fileId, contentUrl]);

  if (!mounted) return null;

  const canEdit = editable && !!fileId;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className={`bg-vellum rounded-[2px] border border-ink shadow-[4px_4px_0_rgb(42_36_24_/_0.18)] w-full flex flex-col overflow-hidden ${
          expanded ? EXPANDED_MODAL : "max-w-6xl h-[90vh]"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-rule shrink-0">
          <div className="min-w-0">
            <h2 className="font-serif-display text-[22px] leading-tight tracking-tight text-ink line-clamp-1">
              {title}
            </h2>
            {pages !== null && mode === "view" && (
              <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-ink-mute mt-1">
                PDF · {pages} page{pages === 1 ? "" : "s"}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {canEdit && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 h-8 rounded-[1px] mr-1"
                onClick={() => {
                  if (mode === "view") {
                    setExpanded(true); // the editor wants room
                    setMode("edit");
                  } else {
                    setReloadKey((k) => k + 1);
                    setMode("view");
                  }
                }}
              >
                {mode === "view" ? (
                  <><Pencil className="h-3.5 w-3.5" /> Edit</>
                ) : (
                  <><Eye className="h-3.5 w-3.5" /> View</>
                )}
              </Button>
            )}
            <ExpandButton expanded={expanded} onToggle={() => setExpanded(!expanded)} />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-ink-fade hover:text-ink"
              onClick={onClose}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 bg-paper-light">
          {mode === "edit" && fileId ? (
            <PdfEditorPane
              notebookId={notebookId}
              fileId={fileId}
              title={title}
              onSaved={() => {
                setReloadKey((k) => k + 1);
                onSaved?.();
              }}
            />
          ) : (
            <PdfViewerPane
              key={reloadKey}
              fetchBytes={fetchBytes}
              title={title}
              downloadUrl={downloadUrl ?? null}
              onDocumentLoaded={({ pages: n }) => setPages(n)}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
