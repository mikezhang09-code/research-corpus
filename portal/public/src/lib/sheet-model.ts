/**
 * Neutral spreadsheet model shared by the styled viewer (ExcelViewerPane),
 * the Univer editor (UniverSheetPane), and the exceljs file round-trip
 * (lib/xlsxio.ts). Deliberately independent of any editor's or parser's own
 * types so each side maps to/from this one schema.
 *
 * Derived from office-editor's bridge types, extended with multi-sheet
 * workbooks, borders, and row heights.
 */

/** One border edge: line style + #RRGGBB color. */
export interface BorderEdge {
  style:
    | 'thin'
    | 'hair'
    | 'dotted'
    | 'dashed'
    | 'dashDot'
    | 'dashDotDot'
    | 'double'
    | 'medium'
    | 'mediumDashed'
    | 'mediumDashDot'
    | 'mediumDashDotDot'
    | 'slantDashDot'
    | 'thick';
  color?: string;
}

export interface CellStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  fontSize?: number;
  fontFamily?: string;
  /** font color, #RRGGBB */
  color?: string;
  /** background fill, #RRGGBB */
  bg?: string;
  hAlign?: 'left' | 'center' | 'right';
  vAlign?: 'top' | 'middle' | 'bottom';
  wrap?: boolean;
  /** Excel number format pattern, e.g. "0.00%" or "yyyy-mm-dd" */
  numFmt?: string;
  borderTop?: BorderEdge;
  borderRight?: BorderEdge;
  borderBottom?: BorderEdge;
  borderLeft?: BorderEdge;
}

export interface RichCell {
  v?: string | number | boolean | null;
  /** formula including leading "=" */
  f?: string;
  style?: CellStyle;
}

export interface RichSheet {
  name: string;
  /** Dense row-major grid; null = empty cell. */
  cells: (RichCell | null)[][];
  /** merged ranges in A1 notation, e.g. "A1:C1" */
  merges: string[];
  /** column widths in px (null = default) */
  colWidths: (number | null)[];
  /** row heights in px (null = default) */
  rowHeights: (number | null)[];
}

export interface RichWorkbook {
  sheets: RichSheet[];
}

// ── A1 helpers ───────────────────────────────────────────────────────────────

export function colName(c: number): string {
  let s = '';
  let x = c;
  do {
    s = String.fromCharCode(65 + (x % 26)) + s;
    x = Math.floor(x / 26) - 1;
  } while (x >= 0);
  return s;
}

export function toA1(row: number, col: number): string {
  return `${colName(col)}${row + 1}`;
}

export function parseA1(ref: string): { row: number; col: number } {
  const m = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(ref.trim());
  if (!m) throw new Error(`bad A1 ref: ${ref}`);
  let col = 0;
  for (const ch of m[1]!.toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: Number(m[2]) - 1, col: col - 1 };
}

export function parseRange(range: string): {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
} {
  const [a, b] = range.split(':');
  const s = parseA1(a!);
  const e = b ? parseA1(b) : s;
  return {
    startRow: Math.min(s.row, e.row),
    startCol: Math.min(s.col, e.col),
    endRow: Math.max(s.row, e.row),
    endCol: Math.max(s.col, e.col),
  };
}

// ── Save-path decision: values-only diff vs structural change ────────────────

/** A changed cell (values/formulas only), in absolute 0-based coordinates. */
export interface ValueChange {
  r: number;
  c: number;
  /** New editor text: formula `=…`, raw value as text, or '' to clear. */
  text: string;
  /** Cached computed value for formula cells (from the editor's engine). */
  value?: string | number | boolean;
}

export interface WorkbookValueDiff {
  perSheet: { name: string; changes: ValueChange[]; endRow: number; endCol: number }[];
}

function cellText(cell: RichCell | null): string {
  if (!cell) return '';
  if (cell.f) return cell.f;
  if (cell.v === null || cell.v === undefined) return '';
  return String(cell.v);
}

function styleKey(cell: RichCell | null): string {
  return cell?.style ? JSON.stringify(cell.style) : '';
}

function sheetBounds(cells: (RichCell | null)[][]): { endRow: number; endCol: number } {
  let endRow = -1;
  let endCol = -1;
  cells.forEach((row, r) => {
    row.forEach((cell, c) => {
      if (cell && (cellText(cell) !== '' || cell.style)) {
        endRow = Math.max(endRow, r);
        endCol = Math.max(endCol, c);
      }
    });
  });
  return { endRow, endCol };
}

/**
 * Compare an edited workbook against the one loaded from the file and decide
 * how it can be saved:
 *
 *   • `kind: 'none'`   — nothing changed.
 *   • `kind: 'values'` — only cell values/formulas changed. The caller can
 *     patch the original file's ZIP in place (lib/sheet-patch.ts), keeping
 *     styles, charts, and pivot tables byte-for-byte intact.
 *   • `kind: 'full'`   — sheets/styles/merges/layout changed. The caller must
 *     rebuild the file (lib/xlsxio.ts), which preserves everything in the
 *     RichWorkbook model but drops objects it doesn't carry (charts, pivots).
 */
export function diffWorkbook(
  original: RichWorkbook,
  edited: RichWorkbook,
): { kind: 'none' } | { kind: 'values'; diff: WorkbookValueDiff } | { kind: 'full' } {
  if (original.sheets.length !== edited.sheets.length) return { kind: 'full' };

  const perSheet: WorkbookValueDiff['perSheet'] = [];
  let anyChange = false;

  for (let i = 0; i < edited.sheets.length; i++) {
    const before = original.sheets[i]!;
    const after = edited.sheets[i]!;
    if (before.name !== after.name) return { kind: 'full' };
    if (JSON.stringify(before.merges) !== JSON.stringify(after.merges)) return { kind: 'full' };
    // Layout: compare only up to the shorter list — editors often report
    // defaults (nulls) past the used range.
    const nCols = Math.min(before.colWidths.length, after.colWidths.length);
    for (let c = 0; c < nCols; c++) {
      if ((before.colWidths[c] ?? null) !== (after.colWidths[c] ?? null)) return { kind: 'full' };
    }
    const nRows = Math.min(before.rowHeights.length, after.rowHeights.length);
    for (let r = 0; r < nRows; r++) {
      if ((before.rowHeights[r] ?? null) !== (after.rowHeights[r] ?? null)) return { kind: 'full' };
    }

    const rows = Math.max(before.cells.length, after.cells.length);
    const changes: ValueChange[] = [];
    for (let r = 0; r < rows; r++) {
      const cols = Math.max(before.cells[r]?.length ?? 0, after.cells[r]?.length ?? 0);
      for (let c = 0; c < cols; c++) {
        const b = before.cells[r]?.[c] ?? null;
        const a = after.cells[r]?.[c] ?? null;
        if (styleKey(b) !== styleKey(a)) return { kind: 'full' };
        const bt = cellText(b);
        const at = cellText(a);
        const cachedChanged =
          a?.f != null && b?.f != null && bt === at && (a.v ?? null) !== (b.v ?? null);
        if (bt !== at || cachedChanged) {
          changes.push({
            r,
            c,
            text: at,
            ...(a?.f && a.v !== null && a.v !== undefined ? { value: a.v } : {}),
          });
        }
      }
    }
    if (changes.length > 0) anyChange = true;
    const bounds = sheetBounds(after.cells);
    perSheet.push({ name: after.name, changes, endRow: bounds.endRow, endCol: bounds.endCol });
  }

  return anyChange ? { kind: 'values', diff: { perSheet } } : { kind: 'none' };
}
