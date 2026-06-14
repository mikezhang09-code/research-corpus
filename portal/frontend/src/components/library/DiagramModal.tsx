"use client";

import { useEffect, useState } from "react";
import { X, Loader2, AlertCircle, Pencil, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExpandButton, EXPANDED_MODAL } from "@/components/corpus/Expandable";
import { loadMermaid } from "@/lib/mermaid";

// Read-only viewer for a diagram artifact (raw Mermaid → SVG).
export function DiagramModal({
  title,
  fetchContent,
  onClose,
  onEdit,
}: {
  title: string;
  fetchContent: () => Promise<string>;
  onClose: () => void;
  onEdit?: () => void;
}) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchContent()
      .then(async (text) => {
        const src = text.trim();
        if (!src) { if (!cancelled) setError("Diagram is empty"); return; }
        const mermaid = await loadMermaid();
        const { svg: out } = await mermaid.render("dgm-view", src);
        if (!cancelled) setSvg(out);
      })
      .catch((e) => {
        document.getElementById("ddgm-view")?.remove();
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => { cancelled = true; };
  }, [fetchContent]);

  function downloadSvg() {
    if (!svg) return;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `${title || "diagram"}.svg`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={`bg-vellum rounded-[2px] border border-ink shadow-[4px_4px_0_rgb(42_36_24_/_0.18)] w-full ${expanded ? EXPANDED_MODAL : "max-w-5xl max-h-[90vh]"} flex flex-col overflow-hidden`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule shrink-0">
          <h2 className="font-serif-display text-[22px] leading-tight tracking-tight text-ink line-clamp-1">{title}</h2>
          <div className="flex items-center gap-1 shrink-0">
            <Button variant="ghost" size="sm" className="gap-1.5 rounded-[1px]" onClick={downloadSvg} disabled={!svg}>
              <Download className="h-3.5 w-3.5" /> SVG
            </Button>
            {onEdit && (
              <Button variant="outline" size="sm" className="gap-1.5 rounded-[1px]" onClick={onEdit}>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
            )}
            <ExpandButton expanded={expanded} onToggle={() => setExpanded(!expanded)} />
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-ink-fade hover:text-ink" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-auto bg-white p-6">
          {error ? (
            <div className="flex items-start gap-2 font-mono text-[11px] tracking-[0.08em] text-terracotta">
              <AlertCircle className="h-4 w-4 shrink-0 mt-px" />
              <span className="break-words">{error}</span>
            </div>
          ) : svg ? (
            <div className="[&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />
          ) : (
            <div className="flex items-center gap-2 text-ink-fade font-mono text-[11px] tracking-[0.1em] uppercase py-8">
              <Loader2 className="h-4 w-4 animate-spin" /> Rendering diagram…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
