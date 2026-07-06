"use client";

// In-app spreadsheet editor — wraps react-spreadsheet for the grid UI and uses
// SheetJS (xlsx) for the file round-trip. Loads the workbook bytes, edits cell
// values in place, and saves by PUT-ing the result back over the same R2
// object, so the file keeps its id/url and viewers stay valid.
//
// Scope: .xlsx saves patch only the changed cells inside the original file's
// ZIP (see lib/sheet-patch.ts), so styling (fills/fonts/themes), autofilters,
// merges, widths, charts, and untouched formulas all survive. If patching
// fails on an unusual file, we fall back to a SheetJS rewrite that keeps
// values + structure but strips styling — and say so. CSV (no styling) always
// uses the SheetJS path. Editing is gated upstream to .xlsx and .csv.
//
// Heavy dependency — always load this module lazily (next/dynamic, ssr:false)
// so the main bundle stays lean.

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Spreadsheet, { type Matrix, type CellBase } from "react-spreadsheet";
import { Loader2, AlertCircle, AlertTriangle, Save, CheckCircle2, Plus, Minus } from "lucide-react";
import type { WorkBook } from "xlsx";
import { getLibraryFileBlob, replaceLibraryFileBytes } from "@/lib/api";
import { applyGridToSheet } from "@/lib/sheet-edit";

type Cell = CellBase<string>;
type SheetState = { name: string; data: Matrix<Cell> };
type XlsxModule = typeof import("xlsx");

/** Grid state flattened to plain text for diffing/serialization. */
function textGrids(sheets: SheetState[]): { name: string; values: string[][] }[] {
  return sheets.map((s) => ({
    name: s.name,
    values: s.data.map((row) => row.map((cell) => cell?.value ?? "")),
  }));
}

/** Style-stripping fallback: write the grids into the SheetJS model and re-serialize. */
function rebuildWithSheetJs(
  XLSX: XlsxModule,
  wb: WorkBook,
  grids: { name: string; values: string[][] }[],
  bookType: "xlsx" | "csv",
): ArrayBuffer {
  for (const g of grids) {
    const ws = wb.Sheets[g.name];
    if (ws) applyGridToSheet(XLSX, ws, g.values);
  }
  return XLSX.write(wb, { type: "array", bookType, cellStyles: true }) as ArrayBuffer;
}

export default function ExcelEditorPane({
  notebookId,
  fileId,
  title,
  bookType,
  onSaved,
}: {
  /** Folio id, or null for a free-form file. */
  notebookId: string | null;
  fileId: string;
  title: string;
  /** File kind, gated upstream to the two SheetJS can round-trip losslessly. */
  bookType: "xlsx" | "csv";
  /** Called after a successful save so the parent can refresh its preview. */
  onSaved?: () => void;
}) {
  const [sheets, setSheets] = useState<SheetState[] | null>(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  // True when the last save fell back to a SheetJS rewrite (styling stripped).
  const [styleLoss, setStyleLoss] = useState(false);
  // The file as last loaded/saved: raw bytes (source of truth the surgical
  // save patches) plus the SheetJS parse (the diff baseline for "what
  // changed"). Both are re-anchored after every successful save.
  const bytesRef = useRef<ArrayBuffer | null>(null);
  const wbRef = useRef<WorkBook | null>(null);

  // The pane is mounted fresh per file (the modal unmounts it on close), so
  // initial state covers the reset; the effect only fills in async results.
  useEffect(() => {
    let cancelled = false;
    bytesRef.current = null;
    wbRef.current = null;
    (async () => {
      try {
        const buf = await getLibraryFileBlob(notebookId, fileId);
        if (cancelled) return;
        const XLSX = await import("xlsx");
        // cellStyles keeps column widths / row heights on the parsed sheets.
        const wb = XLSX.read(buf, { type: "array", cellStyles: true });
        bytesRef.current = buf;
        wbRef.current = wb;
        const parsed: SheetState[] = wb.SheetNames.map((name) => {
          const ws = wb.Sheets[name];
          const aoa = XLSX.utils.sheet_to_json<(string | number)[]>(ws, {
            header: 1,
            defval: "",
            blankrows: true,
          });
          const cols = aoa.reduce((m, r) => Math.max(m, r.length), 1);
          const data: Matrix<Cell> = aoa.map((row) =>
            Array.from({ length: cols }, (_, c) => ({
              value: row[c] == null ? "" : String(row[c]),
            })),
          );
          // Guarantee at least one editable row so an empty sheet is usable.
          if (data.length === 0) data.push(Array.from({ length: cols }, () => ({ value: "" })));
          return { name, data };
        });
        if (cancelled) return;
        if (parsed.length === 0) setError("Workbook has no sheets");
        else setSheets(parsed);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [notebookId, fileId]);

  const current = sheets?.[active];

  const onChange = useCallback(
    (next: Matrix<Cell>) => {
      setSheets((prev) => {
        if (!prev) return prev;
        const copy = prev.slice();
        copy[active] = { ...copy[active], data: next };
        return copy;
      });
    },
    [active],
  );

  const addRow = useCallback(() => {
    setSheets((prev) => {
      if (!prev) return prev;
      const copy = prev.slice();
      const sheet = copy[active];
      const cols = sheet.data[0]?.length ?? 1;
      copy[active] = { ...sheet, data: [...sheet.data, Array.from({ length: cols }, () => ({ value: "" }))] };
      return copy;
    });
  }, [active]);

  const removeRow = useCallback(() => {
    setSheets((prev) => {
      if (!prev) return prev;
      const copy = prev.slice();
      const sheet = copy[active];
      if (sheet.data.length <= 1) return prev;
      copy[active] = { ...sheet, data: sheet.data.slice(0, -1) };
      return copy;
    });
  }, [active]);

  async function save() {
    if (saving || !sheets) return;
    setSaving(true);
    setError(null);
    try {
      const XLSX = await import("xlsx");
      const wb = wbRef.current;
      const bytes = bytesRef.current;
      if (!wb || !bytes) throw new Error("Workbook not loaded yet");
      const grids = textGrids(sheets);

      // Preferred path: patch only the changed cells inside the original file
      // so styling/themes/charts survive byte-for-byte (xlsx only).
      let out: ArrayBuffer;
      let lostStyle = false;
      if (bookType === "xlsx") {
        try {
          const { diffSheetGrid, patchXlsx } = await import("@/lib/sheet-patch");
          const patches = grids.flatMap((g) => {
            const ws = wb.Sheets[g.name];
            return ws ? [{ name: g.name, ...diffSheetGrid(XLSX, ws, g.values) }] : [];
          });
          const patched = patchXlsx(new Uint8Array(bytes), patches);
          out = patched.buffer.slice(
            patched.byteOffset,
            patched.byteOffset + patched.byteLength,
          ) as ArrayBuffer;
        } catch (err) {
          console.warn("[excel-editor] surgical patch failed; falling back to SheetJS rewrite:", err);
          lostStyle = true;
          out = rebuildWithSheetJs(XLSX, wb, grids, bookType);
        }
      } else {
        out = rebuildWithSheetJs(XLSX, wb, grids, bookType);
      }

      const mime =
        bookType === "csv"
          ? "text/csv"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      await replaceLibraryFileBytes(notebookId, fileId, out, `${title || "workbook"}.${bookType}`, mime);
      // Re-anchor the diff baseline on what we just persisted, so the next
      // save diffs against the saved file rather than the original load.
      bytesRef.current = out;
      wbRef.current = XLSX.read(out, { type: "array", cellStyles: true });
      setStyleLoss(lostStyle);
      setSavedAt(Date.now());
      onSaved?.();
    } catch (e) {
      setError(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  const columnLabels = useMemo(() => {
    const n = current?.data[0]?.length ?? 0;
    // Excel-style A, B, … Z, AA, AB column headers.
    return Array.from({ length: n }, (_, i) => {
      let s = "", x = i;
      do { s = String.fromCharCode(65 + (x % 26)) + s; x = Math.floor(x / 26) - 1; } while (x >= 0);
      return s;
    });
  }, [current]);

  if (error && !sheets) {
    return (
      <div className="flex items-center gap-2 text-terracotta font-mono text-[11px] tracking-[0.1em] uppercase p-6">
        <AlertCircle className="h-4 w-4 shrink-0" /> {error}
      </div>
    );
  }
  if (!sheets || !current) {
    return (
      <div className="flex items-center gap-2 text-ink-fade font-mono text-[11px] tracking-[0.1em] uppercase p-6">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading workbook…
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-rule shrink-0 flex-wrap">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[1px] border border-ink bg-ink text-paper font-mono text-[10px] tracking-[0.14em] uppercase hover:bg-ink-soft disabled:opacity-60 transition-colors"
        >
          {saving ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>
          ) : savedAt ? (
            <><CheckCircle2 className="h-3.5 w-3.5" /> Saved — save again</>
          ) : (
            <><Save className="h-3.5 w-3.5" /> Save</>
          )}
        </button>
        <div className="h-5 w-px bg-rule mx-1" />
        <button type="button" onClick={addRow} className="inline-flex items-center gap-1 h-8 px-2.5 rounded-[1px] border border-rule hover:border-ink text-ink-fade hover:text-ink font-mono text-[10px] tracking-[0.14em] uppercase transition-colors">
          <Plus className="h-3.5 w-3.5" /> Row
        </button>
        <button type="button" onClick={removeRow} className="inline-flex items-center gap-1 h-8 px-2.5 rounded-[1px] border border-rule hover:border-ink text-ink-fade hover:text-ink font-mono text-[10px] tracking-[0.14em] uppercase transition-colors">
          <Minus className="h-3.5 w-3.5" /> Row
        </button>
        {error ? (
          <span className="inline-flex items-center gap-1.5 text-terracotta font-mono text-[10px] tracking-[0.1em] uppercase">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {error}
          </span>
        ) : savedAt && styleLoss ? (
          <span className="inline-flex items-center gap-1.5 text-ochre font-mono text-[10px] tracking-[0.1em] uppercase">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> Saved — cell formatting couldn’t be preserved
          </span>
        ) : null}
      </div>

      {/* Sheet tabs */}
      {sheets.length > 1 && (
        <div className="flex items-center gap-1 px-4 pt-2 shrink-0 overflow-x-auto border-b border-rule bg-paper-light">
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

      {/* Grid */}
      <div className="excel-editor overflow-auto flex-1 p-4 bg-paper-light">
        <Spreadsheet data={current.data} onChange={onChange} columnLabels={columnLabels} darkMode={false} />
      </div>
    </div>
  );
}
