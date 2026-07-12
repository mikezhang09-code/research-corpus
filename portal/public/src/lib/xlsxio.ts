/**
 * High-fidelity .xlsx import/export via exceljs, mapping to/from the neutral
 * RichWorkbook model (lib/sheet-model.ts): formulas, number formats, cell
 * styles (font/fill/alignment/borders), merged cells, column widths, and row
 * heights across every worksheet.
 *
 * The color pipeline is the hard-won part (ported from office-editor):
 * xlsx files reference colors as raw ARGB, legacy indexed-palette entries
 * (WPS and old Excel — including per-file <indexedColors> overrides that
 * exceljs doesn't expose, so they're read straight out of the ZIP), or
 * theme slots with a tint that must be applied in HSL space per ECMA-376.
 *
 * Heavy module (exceljs) — import only from lazily-loaded panes or
 * node-side tests, never from the main bundle.
 */
import ExcelJS from 'exceljs';
import { unzipSync, strFromU8 } from 'fflate';
import type { BorderEdge, CellStyle, RichCell, RichSheet, RichWorkbook } from './sheet-model';

const EXCEL_EPOCH_OFFSET_DAYS = 25569; // days between 1899-12-30 and 1970-01-01

function toA1Ref(row: number, col: number): string {
  let s = '';
  let x = col;
  do {
    s = String.fromCharCode(65 + (x % 26)) + s;
    x = Math.floor(x / 26) - 1;
  } while (x >= 0);
  return `${s}${row + 1}`;
}

/** Excel column-width units (chars) → px, per the usual 7px-per-char rule. */
const charsToPx = (w: number) => Math.round(w * 7 + 5);
const pxToChars = (px: number) => Math.max(1, (px - 5) / 7);
/** Row heights are in points; CSS px = pt × 4⁄3. */
const ptToPx = (pt: number) => Math.round((pt * 4) / 3);
const pxToPt = (px: number) => (px * 3) / 4;

function argbToHex(argb?: string): string | undefined {
  if (!argb || typeof argb !== 'string') return undefined;
  const hex = argb.length === 8 ? argb.slice(2) : argb;
  return /^[0-9A-Fa-f]{6}$/.test(hex) ? `#${hex.toUpperCase()}` : undefined;
}

// Legacy BIFF8 indexed color palette (used by WPS and older Excel files)
// prettier-ignore
const INDEXED_PALETTE: string[] = [
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF',
  '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080',
  '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF',
  '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF',
  '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99',
  '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696',
  '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333',
];

// Office default theme, in xlsx theme-index order (note the lt1/dk1 swap)
const DEFAULT_THEME = [
  'FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4',
  'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47',
];

function parseThemePalette(themeXml?: string): string[] {
  if (!themeXml) return DEFAULT_THEME;
  const order = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'];
  return order.map((name, i) => {
    const section = new RegExp(`<a:${name}>([\\s\\S]*?)</a:${name}>`).exec(themeXml)?.[1];
    if (!section) return DEFAULT_THEME[i]!;
    const hex =
      /lastClr="([0-9A-Fa-f]{6})"/.exec(section)?.[1] ??
      /<a:srgbClr val="([0-9A-Fa-f]{6})"/.exec(section)?.[1];
    return hex?.toUpperCase() ?? DEFAULT_THEME[i]!;
  });
}

/** Apply an Excel theme tint to a hex color (per ECMA-376: adjust HSL luminance). */
function applyTint(hex: string, tint: number): string {
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  l = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r2 = l;
  let g2 = l;
  let b2 = l;
  if (s !== 0) {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r2 = hue2rgb(p, q, h + 1 / 3);
    g2 = hue2rgb(p, q, h);
    b2 = hue2rgb(p, q, h - 1 / 3);
  }
  const toHex = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  return `${toHex(r2)}${toHex(g2)}${toHex(b2)}`.toUpperCase();
}

interface ColorContext {
  theme: string[];
  indexed: string[];
}

/** Resolve an exceljs color (argb / indexed / theme+tint) to #RRGGBB. */
function resolveColor(color: unknown, ctx: ColorContext): string | undefined {
  if (!color || typeof color !== 'object') return undefined;
  const c = color as { argb?: string; indexed?: number; theme?: number; tint?: number };
  if (c.argb) return argbToHex(c.argb);
  if (typeof c.indexed === 'number') {
    const hex = ctx.indexed[c.indexed];
    return hex ? `#${hex}` : undefined;
  }
  if (typeof c.theme === 'number') {
    const base = ctx.theme[c.theme];
    if (!base) return undefined;
    const hex = typeof c.tint === 'number' && c.tint !== 0 ? applyTint(base, c.tint) : base;
    return `#${hex}`;
  }
  return undefined;
}

/**
 * Files (often from WPS or legacy Excel) may override the standard indexed
 * palette via <indexedColors> in xl/styles.xml — exceljs doesn't expose this,
 * so read it straight out of the zip.
 */
function readIndexedPalette(buf: ArrayBuffer): string[] {
  try {
    const files = unzipSync(new Uint8Array(buf));
    const raw = files['xl/styles.xml'];
    const xml = raw ? strFromU8(raw) : undefined;
    const section = xml ? /<indexedColors>([\s\S]*?)<\/indexedColors>/.exec(xml)?.[1] : undefined;
    if (!section) return INDEXED_PALETTE;
    const colors = [...section.matchAll(/rgb="([0-9A-Fa-f]{8})"/g)].map((m) =>
      m[1]!.slice(2).toUpperCase(),
    );
    return colors.length ? colors : INDEXED_PALETTE;
  } catch {
    return INDEXED_PALETTE;
  }
}

function hexToArgb(hex?: string): string | undefined {
  if (!hex) return undefined;
  const clean = hex.replace('#', '');
  return /^[0-9A-Fa-f]{6}$/.test(clean) ? `FF${clean.toUpperCase()}` : undefined;
}

const BORDER_STYLES = new Set<BorderEdge['style']>([
  'thin', 'hair', 'dotted', 'dashed', 'dashDot', 'dashDotDot', 'double',
  'medium', 'mediumDashed', 'mediumDashDot', 'mediumDashDotDot',
  'slantDashDot', 'thick',
]);

function borderEdgeFrom(edge: Partial<ExcelJS.Border> | undefined, ctx: ColorContext): BorderEdge | undefined {
  if (!edge?.style || !BORDER_STYLES.has(edge.style as BorderEdge['style'])) return undefined;
  const color = resolveColor(edge.color, ctx);
  return { style: edge.style as BorderEdge['style'], ...(color ? { color } : {}) };
}

function cellStyleFrom(cell: ExcelJS.Cell, ctx: ColorContext): CellStyle | undefined {
  const s: CellStyle = {};
  const font = cell.font;
  if (font) {
    if (font.bold) s.bold = true;
    if (font.italic) s.italic = true;
    if (font.underline) s.underline = true;
    if (font.strike) s.strike = true;
    if (font.size) s.fontSize = font.size;
    if (font.name) s.fontFamily = font.name;
    const cl = resolveColor(font.color, ctx);
    if (cl) s.color = cl;
  }
  const fill = cell.fill as ExcelJS.FillPattern | undefined;
  if (fill && fill.type === 'pattern' && fill.pattern !== 'none') {
    const bg = resolveColor(fill.fgColor, ctx);
    if (bg) s.bg = bg;
  }
  const al = cell.alignment;
  if (al) {
    if (al.horizontal === 'left' || al.horizontal === 'center' || al.horizontal === 'right')
      s.hAlign = al.horizontal;
    if (al.vertical === 'top' || al.vertical === 'middle' || al.vertical === 'bottom')
      s.vAlign = al.vertical;
    if (al.wrapText) s.wrap = true;
  }
  if (cell.numFmt && cell.numFmt !== 'General') s.numFmt = cell.numFmt;
  const bd = cell.border;
  if (bd) {
    const top = borderEdgeFrom(bd.top, ctx);
    const right = borderEdgeFrom(bd.right, ctx);
    const bottom = borderEdgeFrom(bd.bottom, ctx);
    const left = borderEdgeFrom(bd.left, ctx);
    if (top) s.borderTop = top;
    if (right) s.borderRight = right;
    if (bottom) s.borderBottom = bottom;
    if (left) s.borderLeft = left;
  }
  return Object.keys(s).length ? s : undefined;
}

function cellValueFrom(cell: ExcelJS.Cell): Pick<RichCell, 'v' | 'f'> {
  const v = cell.value;
  if (v === null || v === undefined) return { v: null };
  if (v instanceof Date) {
    return { v: v.getTime() / 86400000 + EXCEL_EPOCH_OFFSET_DAYS };
  }
  if (typeof v === 'object') {
    const anyV = v as unknown as Record<string, unknown>;
    if (typeof anyV.formula === 'string') {
      const result =
        anyV.result instanceof Date
          ? anyV.result.getTime() / 86400000 + EXCEL_EPOCH_OFFSET_DAYS
          : typeof anyV.result === 'object'
            ? null
            : ((anyV.result as string | number | boolean | undefined) ?? null);
      return { f: `=${anyV.formula}`, v: result };
    }
    if (anyV.sharedFormula) return { v: (anyV.result as string | number | boolean | undefined) ?? null };
    if (Array.isArray(anyV.richText))
      return { v: (anyV.richText as { text: string }[]).map((r) => r.text).join('') };
    if (anyV.text !== undefined) return { v: String(anyV.text) };
    if (anyV.error) return { v: String(anyV.error) };
    return { v: String(v) };
  }
  return { v: v as string | number | boolean };
}

function parseSheet(ws: ExcelJS.Worksheet, ctx: ColorContext): RichSheet {
  const cells: (RichCell | null)[][] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const r = rowNumber - 1;
    if (!cells[r]) cells[r] = [];
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const { v, f } = cellValueFrom(cell);
      const style = cellStyleFrom(cell, ctx);
      if (v === null && !f && !style) return;
      cells[r]![colNumber - 1] = { ...(v !== null || !f ? { v } : {}), ...(f ? { f } : {}), ...(style ? { style } : {}) };
    });
  });
  // normalize sparse arrays. `cells` is sparse when the sheet has a blank row
  // in its used range (eachRow skips it), so use reduce — spreading a sparse
  // array's holes into Math.max(...) yields undefined → NaN → zero columns.
  const maxCols = cells.reduce((m, r) => Math.max(m, r?.length ?? 0), 0);
  const dense: (RichCell | null)[][] = [];
  for (let r = 0; r < cells.length; r++) {
    const row: (RichCell | null)[] = [];
    for (let c = 0; c < maxCols; c++) row.push(cells[r]?.[c] ?? null);
    dense.push(row);
  }

  // exceljs keys _merges by the master cell ("A1"); the full extent lives on
  // the Range value ("A1:B2") — office-editor's Object.keys() version silently
  // collapsed every merge to a single cell.
  interface MergeRange {
    range?: string;
    model?: { top: number; left: number; bottom: number; right: number };
  }
  const mergeModels = Object.values(
    (ws as unknown as { _merges?: Record<string, MergeRange> })._merges ?? {},
  )
    .map((m) => {
      if (m?.model) return m.model;
      if (typeof m?.range === 'string') {
        const [a, b] = m.range.split(':');
        if (!a || !b) return null;
        // parse A1 refs
        const parse = (ref: string) => {
          const mm = /^([A-Z]+)(\d+)$/.exec(ref);
          if (!mm) return null;
          let col = 0;
          for (const ch of mm[1]!) col = col * 26 + (ch.charCodeAt(0) - 64);
          return { row: Number(mm[2]), col };
        };
        const s = parse(a);
        const e = parse(b);
        return s && e ? { top: s.row, left: s.col, bottom: e.row, right: e.col } : null;
      }
      return null;
    })
    .filter((m): m is NonNullable<typeof m> => m != null)
    // Canonical order — exceljs's insertion order isn't stable across files.
    .sort((a, b) => a.top - b.top || a.left - b.left);
  const merges = mergeModels.map(
    (md) => `${toA1Ref(md.top - 1, md.left - 1)}:${toA1Ref(md.bottom - 1, md.right - 1)}`,
  );
  // Merge-slave cells mirror their master's value/style in exceljs (and gain
  // its borders on a rebuild round-trip). Semantically only the master cell
  // exists, so blank the slaves in the model.
  for (const md of mergeModels) {
    for (let r = md.top - 1; r <= md.bottom - 1 && r < dense.length; r++) {
      for (let c = md.left - 1; c <= md.right - 1 && c < maxCols; c++) {
        if (r === md.top - 1 && c === md.left - 1) continue;
        if (dense[r]) dense[r]![c] = null;
      }
    }
  }
  const colWidths: (number | null)[] = [];
  for (let c = 1; c <= maxCols; c++) {
    const w = ws.getColumn(c)?.width;
    colWidths.push(typeof w === 'number' ? charsToPx(w) : null);
  }
  const rowHeights: (number | null)[] = [];
  for (let r = 1; r <= dense.length; r++) {
    const h = ws.getRow(r)?.height;
    rowHeights.push(typeof h === 'number' ? ptToPx(h) : null);
  }

  return { name: ws.name, cells: dense, merges, colWidths, rowHeights };
}

/** Parse every worksheet of an .xlsx file into the neutral workbook model. */
export async function parseXlsx(buf: ArrayBuffer): Promise<RichWorkbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  if (wb.worksheets.length === 0) throw new Error('Workbook has no sheets');

  const ctx: ColorContext = {
    theme: parseThemePalette(
      (wb as unknown as { _themes?: { theme1?: string } })._themes?.theme1,
    ),
    indexed: readIndexedPalette(buf),
  };

  return { sheets: wb.worksheets.map((ws) => parseSheet(ws, ctx)) };
}

function applyStyleTo(target: ExcelJS.Cell, s: CellStyle): void {
  const font: Partial<ExcelJS.Font> = {};
  if (s.bold) font.bold = true;
  if (s.italic) font.italic = true;
  if (s.underline) font.underline = true;
  if (s.strike) font.strike = true;
  if (s.fontSize) font.size = s.fontSize;
  if (s.fontFamily) font.name = s.fontFamily;
  const argb = hexToArgb(s.color);
  if (argb) font.color = { argb };
  if (Object.keys(font).length) target.font = font as ExcelJS.Font;
  const bgArgb = hexToArgb(s.bg);
  if (bgArgb) {
    target.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } };
  }
  if (s.hAlign || s.vAlign || s.wrap) {
    target.alignment = {
      ...(s.hAlign ? { horizontal: s.hAlign } : {}),
      ...(s.vAlign ? { vertical: s.vAlign } : {}),
      ...(s.wrap ? { wrapText: true } : {}),
    };
  }
  if (s.numFmt) target.numFmt = s.numFmt;
  const border: Partial<ExcelJS.Borders> = {};
  const toEdge = (e?: BorderEdge): Partial<ExcelJS.Border> | undefined =>
    e
      ? { style: e.style, ...(hexToArgb(e.color) ? { color: { argb: hexToArgb(e.color)! } } : {}) }
      : undefined;
  const bt = toEdge(s.borderTop);
  const br = toEdge(s.borderRight);
  const bb = toEdge(s.borderBottom);
  const bl = toEdge(s.borderLeft);
  if (bt) border.top = bt;
  if (br) border.right = br;
  if (bb) border.bottom = bb;
  if (bl) border.left = bl;
  if (Object.keys(border).length) target.border = border;
}

/**
 * Build a fresh .xlsx from the neutral model. Full rewrite: everything the
 * model carries is preserved; anything it doesn't (charts, pivot tables,
 * defined names, VBA) is dropped — callers should warn when replacing a file
 * that may contain such objects (see diffWorkbook in sheet-model.ts).
 */
export async function buildXlsx(payload: RichWorkbook): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  for (const sheet of payload.sheets) {
    const ws = wb.addWorksheet(sheet.name || 'Sheet1');

    sheet.cells.forEach((row, r) => {
      row.forEach((cell, c) => {
        if (!cell) return;
        const target = ws.getCell(r + 1, c + 1);
        if (cell.f) {
          target.value = {
            formula: cell.f.replace(/^=/, ''),
            result: cell.v ?? undefined,
          } as ExcelJS.CellFormulaValue;
        } else if (cell.v !== null && cell.v !== undefined && cell.v !== '') {
          target.value = cell.v;
        }
        if (cell.style) applyStyleTo(target, cell.style);
      });
    });

    for (const merge of sheet.merges) {
      try {
        ws.mergeCells(merge);
      } catch {
        // overlapping/invalid merge ranges are skipped
      }
    }

    sheet.colWidths.forEach((px, i) => {
      if (px) ws.getColumn(i + 1).width = pxToChars(px);
    });
    sheet.rowHeights.forEach((px, i) => {
      if (px) ws.getRow(i + 1).height = pxToPt(px);
    });
  }

  const out = await wb.xlsx.writeBuffer();
  // exceljs returns a Node Buffer in node and an ArrayBuffer in browsers.
  return out instanceof ArrayBuffer
    ? out
    : (out as Uint8Array).buffer.slice(
        (out as Uint8Array).byteOffset,
        (out as Uint8Array).byteOffset + (out as Uint8Array).byteLength,
      ) as ArrayBuffer;
}
