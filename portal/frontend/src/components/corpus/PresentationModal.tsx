"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExpandButton, EXPANDED_MODAL } from "@/components/corpus/Expandable";

// Microsoft's free Office Online viewer renders .ppt/.pptx in an iframe. It
// fetches `src` server-side, so the URL must be publicly reachable — the
// portal's R2 bucket is served from a public r2.dev domain, so `r2_url`
// works directly.
const OFFICE_EMBED = "https://view.officeapps.live.com/op/embed.aspx?src=";

/**
 * Inline viewer for PowerPoint presentations (.ppt / .pptx). Used by both the
 * My Research folio (FileCard) and the NotebookLM artifact grid.
 *
 * Portals to document.body: the NotebookLM ArtifactCard grid sits inside a
 * CSS containing block, which would otherwise trap `position: fixed`.
 */
export function PresentationModal({
  src,
  title,
  onClose,
}: {
  src: string;
  title: string;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Mount-once trigger so createPortal(document.body) is safe.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true); }, []);

  // Esc to close.
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!mounted) return null;

  const embedUrl = `${OFFICE_EMBED}${encodeURIComponent(src)}`;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={`bg-vellum rounded-[2px] border border-ink shadow-[4px_4px_0_rgb(42_36_24_/_0.18)] w-full ${expanded ? EXPANDED_MODAL : "max-w-5xl h-[85vh]"} flex flex-col overflow-hidden`}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule shrink-0">
          <h2 className="font-serif-display text-[22px] leading-tight tracking-tight text-ink line-clamp-1">{title}</h2>
          <div className="flex items-center gap-1 shrink-0">
            <a href={src} target="_blank" rel="noopener noreferrer" title="Download original">
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-ink-fade hover:text-ink">
                <ExternalLink className="h-4 w-4" />
              </Button>
            </a>
            <ExpandButton expanded={expanded} onToggle={() => setExpanded(!expanded)} />
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-ink-fade hover:text-ink" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Body */}
        <div className="relative flex-1 bg-paper-light">
          {!loaded && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-ink-fade font-mono text-[11px] tracking-[0.1em] uppercase">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}
          <iframe
            src={embedUrl}
            title={title}
            className="w-full h-full border-0"
            onLoad={() => setLoaded(true)}
            allowFullScreen
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
