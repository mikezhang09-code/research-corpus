"use client";

/**
 * Full spreadsheet editor for .xlsx artifacts, built on Univer (the engine
 * behind the office-editor project): live formula engine, toolbar, formula
 * bar, number formats, conditional formatting, data validation, filtering,
 * sorting, and find & replace.
 *
 * File round-trip: bytes → lib/xlsxio (exceljs) → neutral RichWorkbook →
 * Univer IWorkbookData, and back on save. Saving is hybrid (see
 * diffWorkbook in lib/sheet-model.ts):
 *
 *   • values/formulas only changed → surgical ZIP patch of the original file
 *     (lib/sheet-patch.ts) — styles, charts, and pivot tables survive
 *     byte-for-byte;
 *   • styles / merges / layout / sheets changed → full exceljs rebuild,
 *     which preserves everything the model carries but drops charts/pivots,
 *     so the user is told.
 *
 * Very heavy dependency (Univer + exceljs) — always load via React.lazy.
 */
import { useEffect, useRef, useState } from 'react';
import { createUniver, LocaleType, mergeLocales, type FUniver, type Univer } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import UniverPresetSheetsCoreEnUS from '@univerjs/preset-sheets-core/locales/en-US';
import '@univerjs/preset-sheets-core/lib/index.css';
import { UniverSheetsConditionalFormattingPreset } from '@univerjs/preset-sheets-conditional-formatting';
import UniverPresetSheetsConditionalFormattingEnUS from '@univerjs/preset-sheets-conditional-formatting/locales/en-US';
import '@univerjs/preset-sheets-conditional-formatting/lib/index.css';
import { UniverSheetsDataValidationPreset } from '@univerjs/preset-sheets-data-validation';
import UniverPresetSheetsDataValidationEnUS from '@univerjs/preset-sheets-data-validation/locales/en-US';
import '@univerjs/preset-sheets-data-validation/lib/index.css';
import { UniverSheetsFilterPreset } from '@univerjs/preset-sheets-filter';
import UniverPresetSheetsFilterEnUS from '@univerjs/preset-sheets-filter/locales/en-US';
import '@univerjs/preset-sheets-filter/lib/index.css';
import { UniverSheetsSortPreset } from '@univerjs/preset-sheets-sort';
import UniverPresetSheetsSortEnUS from '@univerjs/preset-sheets-sort/locales/en-US';
import '@univerjs/preset-sheets-sort/lib/index.css';
import { UniverSheetsFindReplacePreset } from '@univerjs/preset-sheets-find-replace';
import UniverPresetSheetsFindReplaceEnUS from '@univerjs/preset-sheets-find-replace/locales/en-US';
import '@univerjs/preset-sheets-find-replace/lib/index.css';
import { Loader2, Save, AlertCircle } from 'lucide-react';
import { getLibraryFileBlob, replaceLibraryFileBytes } from '@/lib/api';
import {
  diffWorkbook,
  parseRange,
  toA1,
  type BorderEdge,
  type CellStyle,
  type RichCell,
  type RichSheet,
  type RichWorkbook,
} from '@/lib/sheet-model';
import { parseXlsx, buildXlsx } from '@/lib/xlsxio';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// ── CellStyle ⇄ Univer IStyleData ────────────────────────────────────────────

const HT: Record<string, number> = { left: 1, center: 2, right: 3 };
const VT: Record<string, number> = { top: 1, middle: 2, bottom: 3 };
const HT_REV: Record<number, CellStyle['hAlign']> = { 1: 'left', 2: 'center', 3: 'right' };
const VT_REV: Record<number, CellStyle['vAlign']> = { 1: 'top', 2: 'middle', 3: 'bottom' };

// Univer BorderStyleTypes ⇄ OOXML border style names.
const BORDER_TO_UNIVER: Record<BorderEdge['style'], number> = {
  thin: 1, hair: 2, dotted: 3, dashed: 4, dashDot: 5, dashDotDot: 6, double: 7,
  medium: 8, mediumDashed: 9, mediumDashDot: 10, mediumDashDotDot: 11,
  slantDashDot: 12, thick: 13,
};
const BORDER_FROM_UNIVER: Record<number, BorderEdge['style']> = Object.fromEntries(
  Object.entries(BORDER_TO_UNIVER).map(([k, v]) => [v, k as BorderEdge['style']]),
);

function normHex(c?: string): string | undefined {
  if (!c || typeof c !== 'string') return undefined;
  const clean = c.replace('#', '');
  return /^[0-9A-Fa-f]{6}$/.test(clean) ? `#${clean.toUpperCase()}` : undefined;
}

type UniverBorderSide = { s: number; cl?: { rgb?: string } };

// Minimal typed views over Univer's dynamic style + workbook-snapshot shapes.
interface UniverStyleData {
  bl?: number;
  it?: number;
  ul?: { s?: number };
  st?: { s?: number };
  fs?: number;
  ff?: string;
  cl?: { rgb?: string };
  bg?: { rgb?: string };
  ht?: number;
  vt?: number;
  tb?: number;
  n?: { pattern?: string };
  bd?: { t?: UniverBorderSide; b?: UniverBorderSide; l?: UniverBorderSide; r?: UniverBorderSide };
}
interface SnapCell {
  v?: string | number | boolean | null;
  f?: string;
  s?: string | UniverStyleData;
}
interface SnapSheet {
  name?: string;
  cellData?: Record<string, Record<string, SnapCell>>;
  mergeData?: { startRow: number; startColumn: number; endRow: number; endColumn: number }[];
  columnData?: Record<string, { w?: number } | undefined>;
  rowData?: Record<string, { h?: number; ia?: number } | undefined>;
}
interface Snapshot {
  styles?: Record<string, UniverStyleData>;
  sheetOrder?: string[];
  sheets?: Record<string, SnapSheet>;
}

function toUniverStyle(s?: CellStyle): Record<string, unknown> | undefined {
  if (!s) return undefined;
  const st: Record<string, unknown> = {};
  if (s.bold) st.bl = 1;
  if (s.italic) st.it = 1;
  if (s.underline) st.ul = { s: 1 };
  if (s.strike) st.st = { s: 1 };
  if (s.fontSize) st.fs = s.fontSize;
  if (s.fontFamily) st.ff = s.fontFamily;
  if (s.color) st.cl = { rgb: s.color };
  if (s.bg) st.bg = { rgb: s.bg };
  if (s.hAlign && HT[s.hAlign]) st.ht = HT[s.hAlign];
  if (s.vAlign && VT[s.vAlign]) st.vt = VT[s.vAlign];
  if (s.wrap) st.tb = 3; // WrapStrategy.WRAP
  if (s.numFmt) st.n = { pattern: s.numFmt };
  const side = (e?: BorderEdge): UniverBorderSide | undefined =>
    e ? { s: BORDER_TO_UNIVER[e.style] ?? 1, ...(e.color ? { cl: { rgb: e.color } } : {}) } : undefined;
  const bd: Record<string, UniverBorderSide> = {};
  const t = side(s.borderTop);
  const b = side(s.borderBottom);
  const l = side(s.borderLeft);
  const r = side(s.borderRight);
  if (t) bd.t = t;
  if (b) bd.b = b;
  if (l) bd.l = l;
  if (r) bd.r = r;
  if (Object.keys(bd).length) st.bd = bd;
  return Object.keys(st).length ? st : undefined;
}

function fromUniverStyle(st: unknown): CellStyle | undefined {
  if (!st || typeof st !== 'object') return undefined;
  const u = st as UniverStyleData;
  const s: CellStyle = {};
  if (u.bl === 1) s.bold = true;
  if (u.it === 1) s.italic = true;
  if (u.ul?.s === 1) s.underline = true;
  if (u.st?.s === 1) s.strike = true;
  if (typeof u.fs === 'number') s.fontSize = u.fs;
  if (typeof u.ff === 'string') s.fontFamily = u.ff;
  const cl = normHex(u.cl?.rgb);
  if (cl) s.color = cl;
  const bg = normHex(u.bg?.rgb);
  if (bg) s.bg = bg;
  if (u.ht != null && HT_REV[u.ht]) s.hAlign = HT_REV[u.ht];
  if (u.vt != null && VT_REV[u.vt]) s.vAlign = VT_REV[u.vt];
  if (u.tb === 3) s.wrap = true;
  if (u.n?.pattern) s.numFmt = u.n.pattern;
  const edge = (v: unknown): BorderEdge | undefined => {
    if (!v || typeof v !== 'object') return undefined;
    const sd = v as UniverBorderSide;
    const style = BORDER_FROM_UNIVER[sd.s];
    if (!style) return undefined;
    const color = normHex(sd.cl?.rgb);
    return { style, ...(color ? { color } : {}) };
  };
  const bt = edge(u.bd?.t);
  const bb = edge(u.bd?.b);
  const bl2 = edge(u.bd?.l);
  const br = edge(u.bd?.r);
  if (bt) s.borderTop = bt;
  if (bb) s.borderBottom = bb;
  if (bl2) s.borderLeft = bl2;
  if (br) s.borderRight = br;
  return Object.keys(s).length ? s : undefined;
}

// ── RichWorkbook ⇄ Univer IWorkbookData ─────────────────────────────────────

function toWorkbookData(wb: RichWorkbook, name: string): Record<string, unknown> {
  const sheets: Record<string, unknown> = {};
  const sheetOrder: string[] = [];
  wb.sheets.forEach((sheet, i) => {
    const sid = `sheet-${i + 1}`;
    sheetOrder.push(sid);
    const cellData: Record<number, Record<number, unknown>> = {};
    sheet.cells.forEach((row, r) => {
      row.forEach((cell, c) => {
        if (!cell) return;
        const data: Record<string, unknown> = {};
        if (cell.f) data.f = cell.f;
        if (cell.v !== undefined && cell.v !== null && cell.v !== '') data.v = cell.v;
        const st = toUniverStyle(cell.style);
        if (st) data.s = st;
        if (!Object.keys(data).length) return;
        (cellData[r] ??= {})[c] = data;
      });
    });
    const mergeData = sheet.merges
      .map((m) => {
        try {
          const r = parseRange(m);
          return { startRow: r.startRow, startColumn: r.startCol, endRow: r.endRow, endColumn: r.endCol };
        } catch {
          return null;
        }
      })
      .filter((x) => x != null);
    const columnData: Record<number, { w: number }> = {};
    sheet.colWidths.forEach((w, c) => {
      if (w) columnData[c] = { w };
    });
    const rowData: Record<number, { h: number; ah?: number }> = {};
    sheet.rowHeights.forEach((h, r) => {
      if (h) rowData[r] = { h };
    });
    const nCols = Math.max(sheet.cells[0]?.length ?? 0, sheet.colWidths.length, 1);
    sheets[sid] = {
      id: sid,
      name: sheet.name,
      cellData,
      mergeData,
      columnData,
      rowData,
      rowCount: Math.max(sheet.cells.length + 100, 1000),
      columnCount: Math.max(nCols + 10, 26),
      defaultColumnWidth: 76,
      defaultRowHeight: 24,
    };
  });
  return { id: 'workbook-1', name, sheetOrder, sheets, styles: {}, locale: 'enUS' };
}

function fromSnapshot(snapshot: Snapshot): RichWorkbook {
  const styleDict: Record<string, unknown> = snapshot.styles ?? {};
  const order: string[] = snapshot.sheetOrder ?? Object.keys(snapshot.sheets ?? {});
  const sheets: RichSheet[] = [];
  for (const sid of order) {
    const sd = snapshot.sheets?.[sid];
    if (!sd) continue;
    const cellData: Record<string, Record<string, SnapCell>> = sd.cellData ?? {};
    let maxRow = -1;
    let maxCol = -1;
    for (const r of Object.keys(cellData)) {
      for (const c of Object.keys(cellData[r]!)) {
        const cell = cellData[r]![c];
        if (cell && (cell.v !== undefined && cell.v !== null && cell.v !== '' || cell.f || cell.s)) {
          maxRow = Math.max(maxRow, Number(r));
          maxCol = Math.max(maxCol, Number(c));
        }
      }
    }
    const cells: (RichCell | null)[][] = [];
    for (let r = 0; r <= maxRow; r++) {
      const row: (RichCell | null)[] = [];
      for (let c = 0; c <= maxCol; c++) {
        const cell = cellData[r]?.[c];
        if (!cell) {
          row.push(null);
          continue;
        }
        const raw = typeof cell.s === 'string' ? styleDict[cell.s] : cell.s;
        const rich: RichCell = {};
        // Univer stores formulas with the leading '='; drag-filled copies may
        // carry only `si` (shared id) — those fall back to their cached value.
        if (typeof cell.f === 'string' && cell.f.length > 0) rich.f = cell.f.startsWith('=') ? cell.f : `=${cell.f}`;
        if (cell.v !== undefined && cell.v !== null && cell.v !== '') rich.v = cell.v;
        const style = fromUniverStyle(raw);
        if (style) rich.style = style;
        row.push(Object.keys(rich).length ? rich : null);
      }
      cells.push(row);
    }
    const merges: string[] = (sd.mergeData ?? []).map(
      (m) => `${toA1(m.startRow, m.startColumn)}:${toA1(m.endRow, m.endColumn)}`,
    );
    const colWidths: (number | null)[] = [];
    for (let c = 0; c <= maxCol; c++) {
      const w = sd.columnData?.[c]?.w;
      colWidths.push(typeof w === 'number' ? Math.round(w) : null);
    }
    const rowHeights: (number | null)[] = [];
    for (let r = 0; r <= maxRow; r++) {
      const h = sd.rowData?.[r]?.h;
      // `ah` is Univer's auto-height; only explicit heights round-trip.
      rowHeights.push(typeof h === 'number' && sd.rowData?.[r]?.ia !== 1 ? Math.round(h) : null);
    }
    sheets.push({ name: sd.name ?? sid, cells, merges, colWidths, rowHeights });
  }
  return { sheets };
}

// ── Component ────────────────────────────────────────────────────────────────

export default function UniverSheetPane({
  notebookId,
  fileId,
  title,
  onSaved,
}: {
  notebookId: string | null;
  fileId: string;
  title: string;
  onSaved?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const univerRef = useRef<Univer | null>(null);
  const apiRef = useRef<FUniver | null>(null);
  const originalRef = useRef<RichWorkbook | null>(null);
  const bytesRef = useRef<ArrayBuffer | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // The pane is mounted fresh per file (the modal unmounts it on close), so
  // initial 'loading' state covers the reset; the effect only fills results.
  useEffect(() => {
    let cancelled = false;

    async function boot() {
      const bytes = await getLibraryFileBlob(notebookId, fileId);
      const parsed = await parseXlsx(bytes);
      if (cancelled || !containerRef.current) return;
      bytesRef.current = bytes;
      originalRef.current = parsed;

      const { univer, univerAPI } = createUniver({
        locale: LocaleType.EN_US,
        locales: {
          [LocaleType.EN_US]: mergeLocales(
            UniverPresetSheetsCoreEnUS,
            UniverPresetSheetsConditionalFormattingEnUS,
            UniverPresetSheetsDataValidationEnUS,
            UniverPresetSheetsFilterEnUS,
            UniverPresetSheetsSortEnUS,
            UniverPresetSheetsFindReplaceEnUS,
          ),
        },
        presets: [
          UniverSheetsCorePreset({ container: containerRef.current }),
          UniverSheetsConditionalFormattingPreset(),
          UniverSheetsDataValidationPreset(),
          UniverSheetsFilterPreset(),
          UniverSheetsSortPreset(),
          UniverSheetsFindReplacePreset(),
        ],
      });
      univerRef.current = univer;
      apiRef.current = univerAPI;
      univerAPI.createWorkbook(
        toWorkbookData(parsed, title || 'Workbook') as unknown as Parameters<typeof univerAPI.createWorkbook>[0],
      );
      if (!cancelled) setStatus('ready');
    }

    boot().catch((e) => {
      if (!cancelled) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
    });

    return () => {
      cancelled = true;
      apiRef.current = null;
      try {
        univerRef.current?.dispose();
      } catch {
        /* already disposed */
      }
      univerRef.current = null;
    };
    // title only names the workbook; re-mounting on the file is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebookId, fileId]);

  async function save() {
    if (saving) return;
    const api = apiRef.current;
    const original = originalRef.current;
    const bytes = bytesRef.current;
    if (!api || !original || !bytes) return;
    setSaving(true);
    setError(null);
    try {
      const wb = api.getActiveWorkbook();
      if (!wb) throw new Error('No active workbook');
      const edited = fromSnapshot(wb.save() as unknown as Snapshot);

      const decision = diffWorkbook(original, edited);
      if (decision.kind === 'none') {
        setNote('No changes to save');
        return;
      }

      let out: ArrayBuffer;
      let noteMsg = 'Saved to library';
      if (decision.kind === 'values') {
        // Cell edits only → patch the original ZIP so charts/styles survive.
        try {
          const { patchXlsx } = await import('@/lib/sheet-patch');
          const patches = decision.diff.perSheet
            .filter((s) => s.changes.length > 0)
            .map((s) => ({
              name: s.name,
              writes: s.changes.map((ch) => ({ r: ch.r, c: ch.c, text: ch.text, value: ch.value })),
              endRow: s.endRow,
              endCol: s.endCol,
            }));
          const patched = patchXlsx(new Uint8Array(bytes), patches);
          out = patched.buffer.slice(
            patched.byteOffset,
            patched.byteOffset + patched.byteLength,
          ) as ArrayBuffer;
        } catch (err) {
          console.warn('[univer-pane] surgical patch failed; falling back to full rebuild:', err);
          out = await buildXlsx(edited);
          noteMsg = 'Saved — rebuilt (charts/pivots, if any, were dropped)';
        }
      } else {
        // Styles / merges / layout changed → the file must be rebuilt.
        out = await buildXlsx(edited);
        noteMsg = 'Saved — layout/format changes rebuild the file (charts/pivots, if any, dropped)';
      }

      const filename = /\.xlsx$/i.test(title) ? title : `${title || 'workbook'}.xlsx`;
      await replaceLibraryFileBytes(notebookId, fileId, out, filename, XLSX_MIME);
      // Re-anchor the baseline on what we just persisted.
      bytesRef.current = out;
      originalRef.current = await parseXlsx(out);
      setNote(noteMsg);
      onSaved?.();
    } catch (e) {
      setError(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-rule shrink-0 flex-wrap bg-paper-light">
        <button
          type="button"
          disabled={saving || status !== 'ready'}
          onClick={() => void save()}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[1px] border border-ink bg-ink text-paper font-mono text-[10px] tracking-[0.14em] uppercase hover:bg-ink-soft disabled:opacity-50 transition-colors"
        >
          {saving ? (<><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>) : (<><Save className="h-3.5 w-3.5" /> Save</>)}
        </button>
        {error ? (
          <span className="inline-flex items-center gap-1.5 text-terracotta font-mono text-[10px] tracking-[0.1em] uppercase">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {error}
          </span>
        ) : (
          <span className="font-mono text-[10px] tracking-[0.06em] text-ink-mute normal-case">
            {note ?? 'Formulas recalculate live · cell edits keep the file’s charts & styling; layout/format changes rewrite it'}
          </span>
        )}
      </div>
      {status === 'error' && (
        <div className="flex items-center gap-2 text-terracotta font-mono text-[11px] tracking-[0.1em] uppercase p-6">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}
      {status === 'loading' && (
        <div className="flex items-center gap-2 text-ink-fade font-mono text-[11px] tracking-[0.1em] uppercase p-6">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading spreadsheet editor…
        </div>
      )}
      <div ref={containerRef} className="flex-1 min-h-0" style={{ display: status === 'ready' ? 'block' : 'none' }} />
    </div>
  );
}
