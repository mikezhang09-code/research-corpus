"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { X, Loader2, AlertCircle, Pencil, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getLibraryFileBlob } from "@/lib/api";
import { ExpandButton, EXPANDED_MODAL } from "@/components/corpus/Expandable";

// react-spreadsheet + SheetJS write path — heavy, so loaded only when Edit is clicked.
const ExcelEditorPane = dynamic(() => import("./ExcelEditorPane"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center gap-2 text-ink-fade font-mono text-[11px] tracking-[0.1em] uppercase p-6">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading editor…
    </div>
  ),
});

type Sheet = { name: string; html: string; rows: number; cols: number };

// SheetJS reads xlsx/xls/csv client-side and emits HTML per sheet — we wrap
// each in a tab so the viewer handles multi-sheet workbooks. When `editable`,
// an Edit toggle swaps in a react-spreadsheet grid that writes changes back.
export function ExcelModal({
  notebookId,
  fileId,
  title,
  editable = false,
  bookType = "xlsx",
  onClose,
}: {
  /** Folio id, or null for a free-form file. */
  notebookId: string | null;
  fileId: string;
  title: string;
  /** Show the Edit toggle — gated upstream to .xlsx / .csv (SheetJS round-trips these). */
  editable?: boolean;
  /** Serialization format the editor writes back; only meaningful when editable. */
  bookType?: "xlsx" | "csv";
  onClose: () => void;
}) {
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<"view" | "edit">("view");
  // Bumped after a save so returning to view refetches the edited bytes.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (mode !== "view") return;
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
  }, [notebookId, fileId, mode, reloadKey]);

  function startEditing() {
    setExpanded(true); // the grid wants room
    setMode("edit");
  }

  function backToView() {
    // Reset here (an event handler) so the effect body stays setState-free;
    // bumping reloadKey refetches so any saved edits show in the viewer.
    setSheets(null);
    setError(null);
    setReloadKey((k) => k + 1);
    setMode("view");
  }

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
            {sheets && mode === "view" && (
              <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-ink-mute mt-1">
                {sheets.length} sheet{sheets.length !== 1 ? "s" : ""}
              </p>
            )}
          </div>
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

        {/* Sheet tabs */}
        {mode === "view" && sheets && sheets.length > 1 && (
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
        {mode === "edit" ? (
          <div className="flex-1 min-h-0 bg-paper-light">
            <ExcelEditorPane
              notebookId={notebookId}
              fileId={fileId}
              title={title}
              bookType={bookType}
            />
          </div>
        ) : (
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
        )}

        {/* Footer */}
        {mode === "view" && current && (
          <div className="px-6 py-3 border-t border-rule shrink-0 font-mono text-[10px] tracking-[0.14em] uppercase text-ink-mute flex items-center justify-between">
            <span>{current.name}</span>
            <span>{current.rows} row{current.rows !== 1 ? "s" : ""} · {current.cols} col{current.cols !== 1 ? "s" : ""}</span>
          </div>
        )}
      </div>
    </div>
  );
}
