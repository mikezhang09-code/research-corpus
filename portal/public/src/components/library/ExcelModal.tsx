"use client";

import { useEffect, useState } from "react";
import { X, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getLibraryFileBlob } from "@/lib/api";
import { ExpandButton, EXPANDED_MODAL } from "@/components/corpus/Expandable";

type Sheet = { name: string; html: string; rows: number; cols: number };

// SheetJS reads xlsx/xls/csv client-side and emits HTML per sheet — we wrap
// each in a tab so the viewer handles multi-sheet workbooks.
export function ExcelModal({
  notebookId,
  fileId,
  title,
  onClose,
}: {
  /** Folio id, or null for a free-form file. */
  notebookId: string | null;
  fileId: string;
  title: string;
  onClose: () => void;
}) {
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const buf = await getLibraryFileBlob(notebookId, fileId);
        if (cancelled) return;
        const XLSX = await import("xlsx");
        const wb = XLSX.read(buf, { type: "array" });
        const parsed: Sheet[] = wb.SheetNames.map((name) => {
          const ws = wb.Sheets[name];
          const html = XLSX.utils.sheet_to_html(ws, { header: "", footer: "" });
          const ref = ws["!ref"];
          const range = ref ? XLSX.utils.decode_range(ref) : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
          return {
            name,
            html,
            rows: range.e.r - range.s.r + 1,
            cols: range.e.c - range.s.c + 1,
          };
        });
        if (cancelled) return;
        if (parsed.length === 0) {
          setError("Workbook has no sheets");
        } else {
          setSheets(parsed);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [notebookId, fileId]);

  const current = sheets?.[active];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={`bg-vellum rounded-[2px] border border-ink shadow-[4px_4px_0_rgb(42_36_24_/_0.18)] w-full ${expanded ? EXPANDED_MODAL : "max-w-6xl max-h-[90vh]"} flex flex-col overflow-hidden`}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule shrink-0">
          <div className="min-w-0">
            <h2 className="font-serif-display text-[22px] leading-tight tracking-tight text-ink line-clamp-1">{title}</h2>
            {sheets && (
              <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-ink-mute mt-1">
                {sheets.length} sheet{sheets.length !== 1 ? "s" : ""}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <ExpandButton expanded={expanded} onToggle={() => setExpanded(!expanded)} />
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-ink-fade hover:text-ink" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Sheet tabs */}
        {sheets && sheets.length > 1 && (
          <div className="flex items-center gap-1 px-6 pt-3 shrink-0 overflow-x-auto border-b border-rule bg-paper-light">
            {sheets.map((s, i) => (
              <button
                key={`${s.name}-${i}`}
                type="button"
                onClick={() => setActive(i)}
                className={`px-3 py-1.5 rounded-t-[2px] font-mono text-[10px] tracking-[0.14em] uppercase border border-b-0 transition-colors whitespace-nowrap ${
                  i === active
                    ? "bg-vellum text-ink border-ink"
                    : "bg-paper-deep/40 text-ink-fade border-rule hover:text-ink hover:bg-vellum"
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}

        {/* Body */}
        <div className="overflow-auto flex-1">
          {error ? (
            <div className="flex items-center gap-2 text-terracotta font-mono text-[11px] tracking-[0.1em] uppercase p-6">
              <AlertCircle className="h-4 w-4 shrink-0" />
              Failed to load: {error}
            </div>
          ) : !current ? (
            <div className="flex items-center gap-2 text-ink-fade font-mono text-[11px] tracking-[0.1em] uppercase p-6">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <div
              className="excel-sheet"
              dangerouslySetInnerHTML={{ __html: current.html }}
            />
          )}
        </div>

        {/* Footer */}
        {current && (
          <div className="px-6 py-3 border-t border-rule shrink-0 font-mono text-[10px] tracking-[0.14em] uppercase text-ink-mute flex items-center justify-between">
            <span>{current.name}</span>
            <span>{current.rows} row{current.rows !== 1 ? "s" : ""} · {current.cols} col{current.cols !== 1 ? "s" : ""}</span>
          </div>
        )}
      </div>
    </div>
  );
}
