"use client";

/**
 * Styled read-only spreadsheet viewer. Replaces the Microsoft Office Online
 * embed for .xlsx files: parses the file locally (lib/xlsxio.ts) and renders
 * fonts, fills, borders, alignment, number formats, merged cells, and column
 * widths/row heights — no bytes leave for Microsoft.
 *
 * Rendering: absolutely-positioned cells inside one scroll container, with
 * row-window virtualization so a 100k-cell workbook stays smooth. Sticky
 * A/B/C column headers and row numbers are repositioned imperatively on
 * scroll (no React re-render per frame). Multi-sheet workbooks get
 * Excel-style tabs along the bottom.
 *
 * Heavy dependency (exceljs) — always load lazily (next/dynamic, ssr:false).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Table } from 'lucide-react';
import { getLibraryFileBlob } from '@/lib/api';
import { parseRange, type CellStyle, type RichSheet, type RichWorkbook, colName } from '@/lib/sheet-model';
import { parseXlsx } from '@/lib/xlsxio';

const DEFAULT_COL_W = 76;
const DEFAULT_ROW_H = 24;
const HDR_W = 46; // row-number gutter
const HDR_H = 26; // column-header strip
const OVERSCAN = 12;
const MAX_COLS = 120; // sanity cap for pathological files

type SSF = { format: (fmt: string | number, v: number) => string };
let ssfModule: SSF | null = null;

function fmtNumber(v: number, numFmt?: string): string {
  if (numFmt && ssfModule) {
    try {
      return ssfModule.format(numFmt, v);
    } catch {
      /* fall through */
    }
  }
  // Trim float noise without mangling integers or scientific values.
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e10) / 1e10);
}

function displayText(v: string | number | boolean | null | undefined, style?: CellStyle): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return fmtNumber(v, style?.numFmt);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v);
}

const BORDER_PX: Record<string, string> = {
  thin: '1px solid',
  hair: '1px solid',
  dotted: '1px dotted',
  dashed: '1px dashed',
  dashDot: '1px dashed',
  dashDotDot: '1px dotted',
  double: '3px double',
  medium: '2px solid',
  mediumDashed: '2px dashed',
  mediumDashDot: '2px dashed',
  mediumDashDotDot: '2px dotted',
  slantDashDot: '2px dashed',
  thick: '3px solid',
};

function edgeCss(edge?: { style: string; color?: string }): string | undefined {
  if (!edge) return undefined;
  return `${BORDER_PX[edge.style] ?? '1px solid'} ${edge.color ?? '#9ca3af'}`;
}

function cellCss(style: CellStyle | undefined): React.CSSProperties {
  const s: React.CSSProperties = {};
  if (!style) return s;
  if (style.bold) s.fontWeight = 600;
  if (style.italic) s.fontStyle = 'italic';
  const deco = [style.underline ? 'underline' : '', style.strike ? 'line-through' : '']
    .filter(Boolean)
    .join(' ');
  if (deco) s.textDecoration = deco;
  if (style.fontSize) s.fontSize = Math.round((style.fontSize * 4) / 3); // pt → px
  if (style.fontFamily) s.fontFamily = `${style.fontFamily}, Calibri, sans-serif`;
  if (style.color) s.color = style.color;
  if (style.bg) s.background = style.bg;
  if (style.hAlign) s.justifyContent =
    style.hAlign === 'center' ? 'center' : style.hAlign === 'right' ? 'flex-end' : 'flex-start';
  if (style.vAlign) s.alignItems =
    style.vAlign === 'top' ? 'flex-start' : style.vAlign === 'middle' ? 'center' : 'flex-end';
  if (style.wrap) s.whiteSpace = 'pre-wrap';
  const bt = edgeCss(style.borderTop);
  const br = edgeCss(style.borderRight);
  const bb = edgeCss(style.borderBottom);
  const bl = edgeCss(style.borderLeft);
  if (bt) s.borderTop = bt;
  if (br) s.borderRight = br;
  if (bb) s.borderBottom = bb;
  if (bl) s.borderLeft = bl;
  return s;
}

/** Cumulative pixel offsets: offsets[i] = left/top edge of index i; last = total. */
function cumulate(sizes: (number | null)[], count: number, fallback: number): number[] {
  const out = new Array<number>(count + 1);
  out[0] = 0;
  for (let i = 0; i < count; i++) out[i + 1] = out[i]! + (sizes[i] ?? fallback);
  return out;
}

function findIndex(offsets: number[], pos: number): number {
  let lo = 0;
  let hi = offsets.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid]! <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

interface SheetGeometry {
  nRows: number;
  nCols: number;
  rowOff: number[];
  colOff: number[];
  /** merge anchor "r,c" → span + covered flag map */
  mergeAt: Map<string, { rowSpan: number; colSpan: number }>;
  covered: Set<string>;
}

function computeGeometry(sheet: RichSheet): SheetGeometry {
  const nRows = sheet.cells.length;
  const nCols = Math.min(
    MAX_COLS,
    Math.max(sheet.cells[0]?.length ?? 0, sheet.colWidths.length, 1),
  );
  const rowOff = cumulate(sheet.rowHeights, nRows, DEFAULT_ROW_H);
  const colOff = cumulate(sheet.colWidths, nCols, DEFAULT_COL_W);
  const mergeAt = new Map<string, { rowSpan: number; colSpan: number }>();
  const covered = new Set<string>();
  for (const m of sheet.merges) {
    try {
      const r = parseRange(m);
      if (r.startRow >= nRows || r.startCol >= nCols) continue;
      mergeAt.set(`${r.startRow},${r.startCol}`, {
        rowSpan: r.endRow - r.startRow + 1,
        colSpan: r.endCol - r.startCol + 1,
      });
      for (let rr = r.startRow; rr <= Math.min(r.endRow, nRows - 1); rr++) {
        for (let cc = r.startCol; cc <= Math.min(r.endCol, nCols - 1); cc++) {
          if (rr !== r.startRow || cc !== r.startCol) covered.add(`${rr},${cc}`);
        }
      }
    } catch {
      /* skip bad range */
    }
  }
  return { nRows, nCols, rowOff, colOff, mergeAt, covered };
}

export default function ExcelViewerPane({ notebookId, fileId }: { notebookId: string | null; fileId: string }) {
  const [workbook, setWorkbook] = useState<RichWorkbook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [rowWindow, setRowWindow] = useState<[number, number]>([0, 60]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const colHdrRef = useRef<HTMLDivElement>(null);
  const rowHdrRef = useRef<HTMLDivElement>(null);
  const cornerRef = useRef<HTMLDivElement>(null);
  const windowRef = useRef<[number, number]>([0, 60]);

  // Mounted fresh per file (the modal unmounts it on close), so initial state
  // covers the reset; the effect only fills in async results.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getLibraryFileBlob(notebookId, fileId),
      import('xlsx').then((m) => {
        ssfModule = m.SSF as SSF;
      }),
    ])
      .then(([buf]) => parseXlsx(buf))
      .then((wb) => !cancelled && setWorkbook(wb))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [notebookId, fileId]);

  const sheet = workbook?.sheets[sheetIdx] ?? null;
  const geo = useMemo(() => (sheet ? computeGeometry(sheet) : null), [sheet]);

  // Reset scroll + row window when switching sheets (intentional sync to the
  // active-sheet prop).
  useEffect(() => {
    windowRef.current = [0, 60];
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRowWindow([0, 60]);
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
      scrollRef.current.scrollLeft = 0;
    }
  }, [sheetIdx, workbook]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el || !geo) return;
    // Sticky headers, repositioned without a React render.
    if (colHdrRef.current) colHdrRef.current.style.transform = `translateY(${el.scrollTop}px)`;
    if (rowHdrRef.current) rowHdrRef.current.style.transform = `translateX(${el.scrollLeft}px)`;
    if (cornerRef.current)
      cornerRef.current.style.transform = `translate(${el.scrollLeft}px, ${el.scrollTop}px)`;
    const first = findIndex(geo.rowOff, Math.max(0, el.scrollTop - HDR_H));
    const last = findIndex(geo.rowOff, el.scrollTop + el.clientHeight);
    const next: [number, number] = [Math.max(0, first - OVERSCAN), Math.min(geo.nRows, last + OVERSCAN)];
    if (next[0] !== windowRef.current[0] || next[1] !== windowRef.current[1]) {
      windowRef.current = next;
      setRowWindow(next);
    }
  }

  if (error)
    return (
      <div className="flex items-center gap-2 text-terracotta font-mono text-[11px] tracking-[0.1em] uppercase p-6">
        Failed to load: {error}
      </div>
    );
  if (!workbook || !sheet || !geo)
    return (
      <div className="flex items-center gap-2 text-ink-fade font-mono text-[11px] tracking-[0.1em] uppercase p-6">
        Rendering spreadsheet…
      </div>
    );

  const totalW = geo.colOff[geo.nCols]!;
  const totalH = geo.rowOff[geo.nRows]!;
  const [winStart, winEnd] = rowWindow;

  const cells: React.ReactNode[] = [];
  const pushCell = (r: number, c: number) => {
    if (geo.covered.has(`${r},${c}`)) return;
    const cell = sheet.cells[r]?.[c] ?? null;
    const merge = geo.mergeAt.get(`${r},${c}`);
    if (!cell && !merge) return;
    const left = geo.colOff[c]!;
    const top = geo.rowOff[r]!;
    const endR = merge ? Math.min(r + merge.rowSpan, geo.nRows) : r + 1;
    const endC = merge ? Math.min(c + merge.colSpan, geo.nCols) : c + 1;
    const w = geo.colOff[endC]! - left;
    const h = geo.rowOff[endR]! - top;
    const text = displayText(cell?.v, cell?.style);
    if (!text && !cell?.style && !merge) return;
    cells.push(
      <div
        key={`${r},${c}`}
        title={cell?.f ? `${cell.f}` : undefined}
        style={{
          position: 'absolute',
          left: HDR_W + left,
          top: HDR_H + top,
          width: w,
          height: h,
          display: 'flex',
          alignItems: 'flex-end',
          padding: '1px 4px',
          boxSizing: 'border-box',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
          justifyContent: typeof cell?.v === 'number' && !cell?.style?.hAlign ? 'flex-end' : undefined,
          zIndex: merge ? 2 : 1,
          background: merge && !cell?.style?.bg ? '#fff' : undefined,
          ...cellCss(cell?.style),
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxHeight: '100%' }}>{text}</span>
      </div>,
    );
  };
  for (let r = winStart; r < winEnd; r++) {
    for (let c = 0; c < geo.nCols; c++) pushCell(r, c);
  }
  // Merge anchors above the window that reach into it.
  for (const [key, span] of geo.mergeAt) {
    const [r, c] = key.split(',').map(Number) as [number, number];
    if (r < winStart && r + span.rowSpan > winStart) pushCell(r, c);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#e9ecf1' }}>
      <div ref={scrollRef} onScroll={onScroll} style={{ flex: 1, minHeight: 0, overflow: 'auto', position: 'relative' }}>
        <div
          style={{
            position: 'relative',
            width: HDR_W + totalW,
            height: HDR_H + totalH,
            background: '#fff',
            color: '#111827',
            fontFamily: 'Calibri, ui-sans-serif, sans-serif',
            fontSize: 14,
            lineHeight: 1.25,
            // Excel-ish default gridlines without per-cell borders.
            backgroundImage:
              'linear-gradient(to right, #e5e7eb 1px, transparent 1px), linear-gradient(to bottom, #e5e7eb 1px, transparent 1px)',
            backgroundSize: `${DEFAULT_COL_W}px ${DEFAULT_ROW_H}px`,
            backgroundPosition: `${HDR_W}px ${HDR_H}px`,
          }}
        >
          {cells}
          {/* column headers (A, B, C, …) */}
          <div
            ref={colHdrRef}
            style={{ position: 'absolute', top: 0, left: 0, width: HDR_W + totalW, height: HDR_H, background: '#f3f4f6', borderBottom: '1px solid #d1d5db', zIndex: 5 }}
          >
            {Array.from({ length: geo.nCols }, (_, c) => (
              <span
                key={c}
                style={{
                  position: 'absolute',
                  left: HDR_W + geo.colOff[c]!,
                  width: geo.colOff[c + 1]! - geo.colOff[c]!,
                  height: HDR_H,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11.5,
                  color: '#6b7280',
                  borderRight: '1px solid #e5e7eb',
                  boxSizing: 'border-box',
                }}
              >
                {colName(c)}
              </span>
            ))}
          </div>
          {/* row numbers */}
          <div
            ref={rowHdrRef}
            style={{ position: 'absolute', top: 0, left: 0, width: HDR_W, height: HDR_H + totalH, background: '#f3f4f6', borderRight: '1px solid #d1d5db', zIndex: 4 }}
          >
            {Array.from({ length: winEnd - winStart }, (_, i) => {
              const r = winStart + i;
              return (
                <span
                  key={r}
                  style={{
                    position: 'absolute',
                    top: HDR_H + geo.rowOff[r]!,
                    height: geo.rowOff[r + 1]! - geo.rowOff[r]!,
                    width: HDR_W,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11.5,
                    color: '#6b7280',
                    borderBottom: '1px solid #e5e7eb',
                    boxSizing: 'border-box',
                  }}
                >
                  {r + 1}
                </span>
              );
            })}
          </div>
          {/* corner */}
          <div
            ref={cornerRef}
            style={{ position: 'absolute', top: 0, left: 0, width: HDR_W, height: HDR_H, background: '#f3f4f6', borderRight: '1px solid #d1d5db', borderBottom: '1px solid #d1d5db', zIndex: 6 }}
          />
        </div>
      </div>
      {workbook.sheets.length > 1 && (
        <div className="flex items-center gap-1 px-4 py-2 shrink-0 overflow-x-auto border-t border-rule bg-paper-light">
          {workbook.sheets.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setSheetIdx(i)}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-[2px] font-mono text-[10px] tracking-[0.14em] uppercase border transition-colors whitespace-nowrap ${
                i === sheetIdx
                  ? 'bg-vellum text-ink border-ink'
                  : 'bg-paper-deep/40 text-ink-fade border-rule hover:text-ink hover:bg-vellum'
              }`}
            >
              <Table className="h-3 w-3" /> {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
