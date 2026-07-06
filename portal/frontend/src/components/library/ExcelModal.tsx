"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { X, Loader2, AlertCircle, Pencil, Eye, Table, FileSpreadsheet, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getLibraryFileBlob } from "@/lib/api";
import { ExpandButton, EXPANDED_MODAL } from "@/components/corpus/Expandable";

// react-data-grid + SheetJS write path — heavy, so loaded only when Edit is clicked.
const ExcelEditorPane = dynamic(() => import("./ExcelEditorPane"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center gap-2 text-ink-fade font-mono text-[11px] tracking-[0.1em] uppercase p-6">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading editor…
    </div>
  ),
});

// Microsoft's free Office Online viewer renders .xlsx/.xls in an iframe with
// full fidelity (fills, fonts, borders, charts, merges) — same as the PPT
// viewer (PresentationModal). It fetches `src` server-side, so the URL must be
// publicly reachable; the portal's R2 bucket is a public r2.dev domain, so
// `r2_url` works directly. CSV isn't an Office format, so it stays on the
// SheetJS "Plain" table.
const OFFICE_EMBED = "https://view.officeapps.live.com/op/embed.aspx?src=";

type Sheet = { name: string; html: string; rows: number; cols: number };

// SheetJS reads xlsx/xls/csv client-side and emits HTML per sheet — we wrap
// each in a tab so the "Plain" view handles multi-sheet workbooks. Excel files
// with a public URL default to the higher-fidelity Office viewer; a toggle
// falls back to the Plain table. When `editable`, an Edit toggle swaps in a
// react-spreadsheet grid that writes changes back.
export function ExcelModal({
  notebookId,
  fileId,
  title,
  editable = false,
  bookType = "xlsx",
  fileUrl,
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
  /** Public R2 URL — enables the formatted Office Online preview (non-CSV only). */
  fileUrl?: string;
  onClose: () => void;
}) {
  // Office viewer needs a public URL and only handles Excel formats, not CSV.
  const officeCapable = !!fileUrl && bookType !== "csv";

  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<"view" | "edit">("view");
  // Formatted = Office Online iframe; plain = SheetJS table. Default to the
  // high-fidelity view when we can, else the only option we have.
  const [preview, setPreview] = useState<"formatted" | "plain">(officeCapable ? "formatted" : "plain");
  const [officeLoaded, setOfficeLoaded] = useState(false);
  // Bumped after a save so returning to view refetches the edited bytes and
  // cache-busts the Office iframe.
  const [reloadKey, setReloadKey] = useState(0);

  // Only download + parse the workbook when the Plain table is actually shown;
  // the Office viewer fetches the file itself.
  useEffect(() => {
    if (mode !== "view" || preview !== "plain") return;
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
  }, [notebookId, fileId, mode, preview, reloadKey]);

  function startEditing() {
    setExpanded(true); // the grid wants room
    setMode("edit");
  }

  function backToView() {
    // Reset here (an event handler) so the effect body stays setState-free;
    // bumping reloadKey refetches the table and cache-busts the Office iframe.
    setSheets(null);
    setError(null);
    setOfficeLoaded(false);
    setReloadKey((k) => k + 1);
    setMode("view");
  }

  const current = sheets?.[active];
  const showPlain = mode === "view" && preview === "plain";

  // Cache-bust the Office iframe after an edit so Microsoft refetches the file.
  const officeSrc =
    officeCapable && fileUrl
      ? reloadKey > 0
        ? `${fileUrl}${fileUrl.includes("?") ? "&" : "?"}v=${reloadKey}`
        : fileUrl
      : "";
  const embedUrl = officeSrc ? `${OFFICE_EMBED}${encodeURIComponent(officeSrc)}` : "";

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
            {showPlain && sheets && (
              <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-ink-mute mt-1">
                {sheets.length} sheet{sheets.length !== 1 ? "s" : ""}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {officeCapable && mode === "view" && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 h-8 rounded-[1px] mr-1"
                  onClick={() => setPreview((p) => (p === "formatted" ? "plain" : "formatted"))}
                  title={preview === "formatted" ? "Switch to a plain table" : "Switch to the formatted Excel view"}
                >
                  {preview === "formatted" ? (
                    <><Table className="h-3.5 w-3.5" /> Plain</>
                  ) : (
                    <><FileSpreadsheet className="h-3.5 w-3.5" /> Formatted</>
                  )}
                </Button>
                {preview === "formatted" && fileUrl && (
                  <a href={fileUrl} target="_blank" rel="noopener noreferrer" title="Download original">
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-ink-fade hover:text-ink">
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  </a>
                )}
              </>
            )}
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

        {/* Sheet tabs (plain table only) */}
        {showPlain && sheets && sheets.length > 1 && (
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
        ) : preview === "formatted" ? (
          <div className="relative flex-1 min-h-0 bg-paper-light">
            {!officeLoaded && (
              <div className="absolute inset-0 flex items-center justify-center gap-2 text-ink-fade font-mono text-[11px] tracking-[0.1em] uppercase">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading formatted view…
              </div>
            )}
            <iframe
              key={embedUrl}
              src={embedUrl}
              title={title}
              className="w-full h-full border-0"
              onLoad={() => setOfficeLoaded(true)}
              allowFullScreen
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

        {/* Footer (plain table only) */}
        {showPlain && current && (
          <div className="px-6 py-3 border-t border-rule shrink-0 font-mono text-[10px] tracking-[0.14em] uppercase text-ink-mute flex items-center justify-between">
            <span>{current.name}</span>
            <span>{current.rows} row{current.rows !== 1 ? "s" : ""} · {current.cols} col{current.cols !== 1 ? "s" : ""}</span>
          </div>
        )}
      </div>
    </div>
  );
}
