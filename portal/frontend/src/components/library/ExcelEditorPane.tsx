"use client";

// In-app spreadsheet editor — a virtualized react-data-grid for the grid UI
// plus SheetJS (xlsx) for the file round-trip. Loads the workbook bytes, edits
// cell values, and saves by PUT-ing the result back over the same R2 object so
// the file keeps its id/url and viewers stay valid.
//
// Why react-data-grid: the previous react-spreadsheet grid re-synced and
// re-evaluated its whole model on every keystroke (it carries a formula
// engine), so typing lagged even on small sheets. react-data-grid is canvas-
// light, virtualized, and edits a single cell without re-rendering the sheet,
// so typing is instant. It has no built-in multi-cell range paste, so block
// copy/paste (TSV from Excel) is wired here against the selected cell.
//
// Scope: .xlsx saves patch only the changed cells inside the original file's
// ZIP (see lib/sheet-patch.ts), so styling/charts/formulas survive; on an
// unusual file we fall back to a SheetJS rewrite (values only) and say so. CSV
// always uses the SheetJS path. Gated upstream to .xlsx and .csv.
//
// Heavy dependency — always load this module lazily (next/dynamic, ssr:false)
// so the main bundle stays lean.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DataGrid, renderTextEditor, type Column, type CellSelectArgs } from "react-data-grid";
import "react-data-grid/lib/styles.css";
import { Loader2, AlertCircle, AlertTriangle, Save, CheckCircle2, Plus, Minus } from "lucide-react";
import type { WorkBook } from "xlsx";
import { getLibraryFileBlob, replaceLibraryFileBytes } from "@/lib/api";
import { applyGridToSheet } from "@/lib/sheet-edit";

type Row = { __id: number; [key: string]: string | number };
type SheetState = { name: string; rows: Row[]; nCols: number };
type XlsxModule = typeof import("xlsx");

// Excel-style A, B, … Z, AA column header for a 0-based index.
function colName(i: number): string {
  let s = "", x = i;
  do { s = String.fromCharCode(65 + (x % 26)) + s; x = Math.floor(x / 26) - 1; } while (x >= 0);
  return s;
}

const emptyRow = (id: number): Row => ({ __id: id });

/** One sheet's grid rows flattened to text[][] for diffing/serialization. */
function sheetValues(s: SheetState): string[][] {
  return s.rows.map((r) => Array.from({ length: s.nCols }, (_, j) => String(r[`c${j}`] ?? "")));
}
function textGrids(sheets: SheetState[]): { name: string; values: string[][] }[] {
  return sheets.map((s) => ({ name: s.name, values: sheetValues(s) }));
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
  const [styleLoss, setStyleLoss] = useState(false);
  // Raw bytes + SheetJS parse of the file as last loaded/saved (surgical-save
  // source of truth + diff baseline); re-anchored after every successful save.
  const bytesRef = useRef<ArrayBuffer | null>(null);
  const wbRef = useRef<WorkBook | null>(null);
  // Monotonic id for rows added after load — starts well past the initial
  // 0..n-1 ids so it never collides within a sheet.
  const nextId = useRef(1_000_000);
  // Latest selected cell (for block copy/paste), tracked outside render.
  const selected = useRef<{ rowIdx: number; colIdx: number } | null>(null);

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
          const nCols = Math.max(aoa.reduce((m, r) => Math.max(m, r.length), 1), 1);
          const rows: Row[] = aoa.map((r, i) => {
            const row: Row = { __id: i };
            for (let j = 0; j < nCols; j++) row[`c${j}`] = r[j] == null ? "" : String(r[j]);
            return row;
          });
          // Guarantee at least one editable row so an empty sheet is usable.
          if (rows.length === 0) rows.push(emptyRow(0));
          return { name, rows, nCols };
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

  const columns = useMemo<Column<Row>[]>(() => {
    const n = current?.nCols ?? 0;
    const cols: Column<Row>[] = [
      {
        key: "__row",
        name: "",
        frozen: true,
        width: 52,
        resizable: false,
        cellClass: "rdg-rownum",
        renderCell: ({ rowIdx }) => rowIdx + 1,
      },
    ];
    for (let j = 0; j < n; j++) {
      cols.push({
        key: `c${j}`,
        name: colName(j),
        editable: true,
        resizable: true,
        width: 130,
        renderEditCell: renderTextEditor,
      });
    }
    return cols;
  }, [current?.nCols]);

  const onRowsChange = useCallback(
    (rows: Row[]) => {
      setSheets((prev) => {
        if (!prev) return prev;
        const copy = prev.slice();
        copy[active] = { ...copy[active], rows };
        return copy;
      });
    },
    [active],
  );

  const onSelectedCellChange = useCallback((args: CellSelectArgs<Row>) => {
    const key = args.column?.key ?? "";
    selected.current = { rowIdx: args.rowIdx, colIdx: key.startsWith("c") ? Number(key.slice(1)) : -1 };
  }, []);

  // Block paste: parse clipboard TSV and write it starting at the selected
  // cell, growing rows/cols as needed (react-data-grid has no native
  // multi-cell paste).
  function handlePaste(e: React.ClipboardEvent) {
    const text = e.clipboardData.getData("text/plain");
    const sel = selected.current;
    if (!text || !sel || sel.colIdx < 0) return;
    e.preventDefault();
    const block = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n").map((l) => l.split("\t"));
    setSheets((prev) => {
      if (!prev) return prev;
      const copy = prev.slice();
      const sheet = { ...copy[active] };
      const rows = sheet.rows.slice();
      let nCols = sheet.nCols;
      while (rows.length < sel.rowIdx + block.length) rows.push(emptyRow(nextId.current++));
      for (let i = 0; i < block.length; i++) {
        const r = sel.rowIdx + i;
        const line = block[i];
        const patch: Row = { ...rows[r] };
        for (let j = 0; j < line.length; j++) {
          const c = sel.colIdx + j;
          if (c + 1 > nCols) nCols = c + 1;
          patch[`c${c}`] = line[j];
        }
        rows[r] = patch;
      }
      sheet.rows = rows;
      sheet.nCols = nCols;
      copy[active] = sheet;
      return copy;
    });
  }

  // Copy the single selected cell (range copy isn't supported by the grid).
  function handleCopy(e: React.ClipboardEvent) {
    const sel = selected.current;
    if (!sel || sel.colIdx < 0 || !current) return;
    e.clipboardData.setData("text/plain", String(current.rows[sel.rowIdx]?.[`c${sel.colIdx}`] ?? ""));
    e.preventDefault();
  }

  const addRow = useCallback(() => {
    setSheets((prev) => {
      if (!prev) return prev;
      const copy = prev.slice();
      const sheet = copy[active];
      copy[active] = { ...sheet, rows: [...sheet.rows, emptyRow(nextId.current++)] };
      return copy;
    });
  }, [active]);

  const removeRow = useCallback(() => {
    setSheets((prev) => {
      if (!prev) return prev;
      const copy = prev.slice();
      const sheet = copy[active];
      if (sheet.rows.length <= 1) return prev;
      copy[active] = { ...sheet, rows: sheet.rows.slice(0, -1) };
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
      // Re-anchor the diff baseline on what we just persisted.
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
      <div className="excel-editor flex-1 min-h-0" onPaste={handlePaste} onCopy={handleCopy}>
        <DataGrid
          className="rdg-light"
          columns={columns}
          rows={current.rows}
          rowKeyGetter={(r) => r.__id}
          onRowsChange={onRowsChange}
          onSelectedCellChange={onSelectedCellChange}
          rowHeight={28}
          headerRowHeight={30}
          style={{ height: "100%" }}
        />
      </div>
    </div>
  );
}
