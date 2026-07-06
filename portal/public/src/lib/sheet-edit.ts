/**
 * Pure workbook-mutation helpers for the in-app Excel editor.
 *
 * The editor grid only sees cell text, so saving by rebuilding a fresh
 * workbook (aoa_to_sheet) would drop everything else in the file: autofilter,
 * merged cells, column widths, number formats, and formulas. Instead we
 * mutate the originally-loaded worksheet in place — only cells whose text the
 * user actually changed are overwritten; everything untouched keeps its
 * original cell object (formula, format, hyperlink) and all sheet-level
 * features ride along into the rewrite.
 *
 * The SheetJS module is passed in (not imported) so this file stays out of
 * the lazy xlsx chunk's dependency graph.
 */
import type { WorkSheet } from "xlsx";

type XlsxModule = typeof import("xlsx");

// Coerce a text cell back to a number only for plain integers/decimals — never
// for strings with leading zeros (ids, zip codes) or thousands separators, so we
// don't silently corrupt identifiers. Everything else stays a string.
const NUMERIC = /^-?(0|[1-9]\d*)(\.\d+)?$/;
export function coerce(v: string): string | number {
  const t = v.trim();
  if (t === "" || !NUMERIC.test(t)) return v;
  const n = Number(t);
  return Number.isFinite(n) ? n : v;
}

/**
 * The text the editor shows for a worksheet — the single source of truth for
 * both the grid and the save diff, so untouched cells never look "changed".
 *
 * Formula cells render as `=<formula>` (like Excel's edit line) instead of
 * their cached value; everything else renders its raw value. Iterates the full
 * used range so every row has the same width.
 */
export function displayAoa(XLSX: XlsxModule, ws: WorkSheet): string[][] {
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  const out: string[][] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell?.f) row.push(`=${cell.f}`);
      else if (cell && cell.v != null) row.push(String(cell.v));
      else row.push("");
    }
    out.push(row);
  }
  return out;
}

/** A grid cell whose text starts with `=` (and has a body) is a formula. */
export function isFormula(text: string): boolean {
  return text.length > 1 && text[0] === "=";
}

/** A recalculated formula result. */
export type CellVal = number | string | boolean;

/** Loose equality between a computed value and a worksheet's cached `.v`. */
export function sameVal(a: CellVal, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return a === b;
  return String(a) === String(b);
}

/**
 * The format-carrying fields of a cell (style index + number format), so a
 * rewritten cell keeps its appearance — e.g. a percentage cell stays a
 * percentage after its value/formula changes.
 */
function keepFormat(cell: WorkSheet[string] | undefined): { s?: unknown; z?: string | number } {
  const out: { s?: unknown; z?: string | number } = {};
  if (cell && "s" in cell && cell.s !== undefined) out.s = cell.s;
  if (cell?.z !== undefined) out.z = cell.z;
  return out;
}

/**
 * Write the editor grid's text back into a loaded worksheet in place.
 *
 * `values` is the full grid (row-major cell text, '' for empty). Cells whose
 * text matches what the sheet already renders are left untouched; cleared
 * cells are deleted; rows/cols removed in the editor are dropped and the
 * sheet ref + autofilter/merge ranges are clamped to the new bounds.
 */
export function applyGridToSheet(
  XLSX: XlsxModule,
  ws: WorkSheet,
  values: string[][],
  computed?: Map<string, CellVal>,
): void {
  const oldRange = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  // Grid coordinates are relative to the used range's start (that's how
  // sheet_to_json built the grid), so offset by it when addressing cells.
  const start = oldRange.s;
  // Same representation the editor showed (formulas as `=…`), so old text
  // compares exactly against what the user started from.
  const oldAoa = displayAoa(XLSX, ws);

  const rows = Math.max(values.length, 1);
  const cols = Math.max(values.reduce((m, r) => Math.max(m, r.length), 1), 1);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const next = values[r]?.[c] ?? "";
      const oldStr = oldAoa[r]?.[c] ?? "";
      const addr = XLSX.utils.encode_cell({ r: start.r + r, c: start.c + c });
      if (isFormula(next)) {
        // Keep the original formula + cached value when nothing changed and we
        // have no fresh value to bake in.
        const val = computed?.get(`${r},${c}`);
        if (next === oldStr && val === undefined) continue;
        // Preserve the cell's number format / style across the rewrite.
        const cell: WorkSheet[string] = { ...keepFormat(ws[addr]), t: "n", f: next.slice(1) };
        if (val !== undefined) {
          cell.v = val;
          if (typeof val === "string") cell.t = "str";
          else if (typeof val === "boolean") cell.t = "b";
        }
        ws[addr] = cell;
        continue;
      }
      if (next === oldStr && (next !== "" ? ws[addr] !== undefined : true)) continue;
      if (next === "") {
        delete ws[addr];
        continue;
      }
      const fmt = keepFormat(ws[addr]);
      const v = coerce(next);
      ws[addr] = typeof v === "number" ? { ...fmt, t: "n", v } : { ...fmt, t: "s", v: next };
    }
  }

  // Drop cells beyond the new bounds (rows/cols removed in the editor).
  for (let r = start.r; r <= oldRange.e.r; r++) {
    for (let c = start.c; c <= oldRange.e.c; c++) {
      if (r < start.r + rows && c < start.c + cols) continue;
      delete ws[XLSX.utils.encode_cell({ r, c })];
    }
  }

  const range = { s: start, e: { r: start.r + rows - 1, c: start.c + cols - 1 } };
  ws["!ref"] = XLSX.utils.encode_range(range);

  // Clamp ranged sheet features to the new bounds so Excel doesn't reject
  // references past the end of a shrunken sheet.
  const autofilter = ws["!autofilter"];
  if (autofilter?.ref) {
    const af = XLSX.utils.decode_range(autofilter.ref);
    af.e.r = Math.min(af.e.r, range.e.r);
    af.e.c = Math.min(af.e.c, range.e.c);
    if (af.s.r > af.e.r || af.s.c > af.e.c) delete ws["!autofilter"];
    else ws["!autofilter"] = { ref: XLSX.utils.encode_range(af) };
  }
  if (ws["!merges"]) {
    ws["!merges"] = ws["!merges"]
      .filter((m) => m.s.r <= range.e.r && m.s.c <= range.e.c)
      .map((m) => ({
        s: m.s,
        e: { r: Math.min(m.e.r, range.e.r), c: Math.min(m.e.c, range.e.c) },
      }));
  }
}
