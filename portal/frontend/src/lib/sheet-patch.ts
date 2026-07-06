/**
 * Surgical .xlsx patching for the in-app Excel editor.
 *
 * SheetJS's community build cannot read or write cell styling (fills, fonts,
 * theme colors), so any save that rewrites the workbook through it strips all
 * formatting. Instead of rewriting, we treat the original file as the source
 * of truth: open the ZIP, patch only the changed cells inside each
 * worksheet's XML — keeping every cell's style index (`s=`) — and leave every
 * other part (styles.xml, theme1.xml, drawings/charts, pivot caches) byte-
 * for-byte identical.
 *
 * Mechanics: changed text is written as inline strings so sharedStrings.xml
 * never needs rewriting; overwriting a formula cell removes its <f>, and the
 * now-stale calcChain.xml part is dropped so Excel doesn't prompt to repair;
 * dimension / autoFilter / mergeCells ranges are clamped when rows are
 * removed. Known limit: overwriting the *master* cell of a shared-formula
 * group orphans the group's other cells (Excel repairs them to values).
 *
 * Browser-only (DOMParser / XMLSerializer). Heavy path — reached only from
 * the lazily-loaded editor.
 */
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import type { WorkSheet } from "xlsx";
import { coerce, displayAoa, isFormula } from "./sheet-edit";

type XlsxModule = typeof import("xlsx");

/** One cell to write: 0-based absolute sheet coords; '' clears the cell. */
export interface CellWrite {
  r: number;
  c: number;
  text: string;
}

export interface SheetPatch {
  name: string;
  writes: CellWrite[];
  /** 0-based inclusive end of the sheet's used range after the edit. */
  endRow: number;
  endCol: number;
}

// ── A1-notation helpers (tiny, so the patcher doesn't need SheetJS) ─────────

function colName(c: number): string {
  let s = "";
  let x = c;
  do {
    s = String.fromCharCode(65 + (x % 26)) + s;
    x = Math.floor(x / 26) - 1;
  } while (x >= 0);
  return s;
}

function cellRef(r: number, c: number): string {
  return `${colName(c)}${r + 1}`;
}

function parseRef(ref: string): { r: number; c: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) throw new Error(`bad cell ref: ${ref}`);
  let c = 0;
  for (const ch of m[1]!) c = c * 26 + (ch.charCodeAt(0) - 64);
  return { r: Number(m[2]) - 1, c: c - 1 };
}

/**
 * Diff the editor grid against the worksheet it was loaded from, producing
 * the cell writes + new bounds for patchXlsx. Grid coordinates are relative
 * to the sheet's used range (that's how the grid was built), so writes are
 * translated back to absolute sheet coordinates here.
 */
export function diffSheetGrid(
  XLSX: XlsxModule,
  ws: WorkSheet,
  values: string[][],
): Omit<SheetPatch, "name"> {
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  // Same representation the editor showed (formulas as `=…`), so an untouched
  // formula cell isn't seen as changed and flattened to text.
  const oldAoa = displayAoa(XLSX, ws);
  const rows = Math.max(values.length, 1);
  const cols = Math.max(values.reduce((m, r) => Math.max(m, r.length), 1), 1);
  const writes: CellWrite[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const next = values[r]?.[c] ?? "";
      const oldStr = oldAoa[r]?.[c] ?? "";
      if (next !== oldStr) writes.push({ r: range.s.r + r, c: range.s.c + c, text: next });
    }
  }
  return { writes, endRow: range.s.r + rows - 1, endCol: range.s.c + cols - 1 };
}

/**
 * Apply the sheet patches to the original .xlsx bytes, returning a new file.
 * Throws on anything unexpected — the caller falls back to a SheetJS rewrite
 * (which saves values but strips formatting).
 */
export function patchXlsx(original: Uint8Array, patches: SheetPatch[]): Uint8Array {
  const files = unzipSync(original);
  const parser = new DOMParser();
  const serializer = new XMLSerializer();

  const readXml = (path: string): Document => {
    const raw = files[path];
    if (!raw) throw new Error(`missing ${path} in workbook`);
    const text = strFromU8(raw).replace(/^\uFEFF/, "");
    const doc = parser.parseFromString(text, "application/xml");
    if (doc.getElementsByTagName("parsererror").length > 0) {
      throw new Error(`cannot parse ${path}`);
    }
    return doc;
  };
  const writeXml = (path: string, doc: Document) => {
    const orig = strFromU8(files[path]!);
    const decl =
      /^\uFEFF?\s*(<\?xml[^>]*\?>)/.exec(orig)?.[1] ??
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    files[path] = strToU8(`${decl}\n${serializer.serializeToString(doc.documentElement)}`);
  };

  // Resolve sheet name → worksheet part path via the workbook relationships.
  const wbDoc = readXml("xl/workbook.xml");
  const relsDoc = readXml("xl/_rels/workbook.xml.rels");
  const relTargets = new Map<string, string>();
  for (const rel of Array.from(relsDoc.getElementsByTagName("Relationship"))) {
    relTargets.set(rel.getAttribute("Id") ?? "", rel.getAttribute("Target") ?? "");
  }
  const sheetPaths = new Map<string, string>();
  for (const sh of Array.from(wbDoc.getElementsByTagName("sheet"))) {
    const name = sh.getAttribute("name");
    let rid = sh.getAttribute("r:id");
    if (!rid) {
      for (const a of Array.from(sh.attributes)) {
        if (a.localName === "id" && a.namespaceURI?.includes("relationships")) rid = a.value;
      }
    }
    const target = rid ? relTargets.get(rid) : undefined;
    if (!name || !target) continue;
    sheetPaths.set(name, target.startsWith("/") ? target.slice(1) : `xl/${target}`);
  }

  let formulasRemoved = false;
  for (const patch of patches) {
    const path = sheetPaths.get(patch.name);
    if (!path) throw new Error(`sheet "${patch.name}" not found in workbook`);
    const doc = readXml(path);
    if (patchSheetDoc(doc, patch)) formulasRemoved = true;
    writeXml(path, doc);
  }

  // A calcChain entry pointing at a cell that no longer has a formula makes
  // Excel offer to "repair" the file. The part is only a recalculation cache,
  // so drop it (and its registrations) whenever we removed a formula.
  if (formulasRemoved && files["xl/calcChain.xml"]) {
    delete files["xl/calcChain.xml"];
    const stripEntry = (path: string, re: RegExp) => {
      if (files[path]) files[path] = strToU8(strFromU8(files[path]!).replace(re, ""));
    };
    stripEntry("[Content_Types].xml", /<Override[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>\s*/g);
    stripEntry("xl/_rels/workbook.xml.rels", /<Relationship\b[^>]*Target="[^"]*calcChain\.xml"[^>]*\/>\s*/g);
  }

  return zipSync(files, { level: 6 });
}

/** Patch one worksheet document in place; returns true if a formula was removed. */
function patchSheetDoc(doc: Document, patch: SheetPatch): boolean {
  const root = doc.documentElement;
  const ns = root.namespaceURI;
  const el = (tag: string) => (ns ? doc.createElementNS(ns, tag) : doc.createElement(tag));
  const childrenNamed = (parent: Element, name: string) =>
    Array.from(parent.children).filter((e) => e.localName === name);

  const sheetData = childrenNamed(root, "sheetData")[0];
  if (!sheetData) throw new Error("worksheet has no sheetData");

  let removedFormula = false;

  // Index existing rows; normalize missing r attributes (rare) so later math
  // and ordering work on numbers.
  const rowByNum = new Map<number, Element>();
  let seq = 0;
  for (const rowEl of childrenNamed(sheetData, "row")) {
    const rAttr = rowEl.getAttribute("r");
    const num = rAttr ? parseInt(rAttr, 10) : seq + 1;
    seq = num;
    if (!rAttr) rowEl.setAttribute("r", String(num));
    rowByNum.set(num, rowEl);
  }

  const getRow = (num: number): Element => {
    const existing = rowByNum.get(num);
    if (existing) return existing;
    const rowEl = el("row");
    rowEl.setAttribute("r", String(num));
    let before: Element | null = null;
    for (const cand of childrenNamed(sheetData, "row")) {
      if (parseInt(cand.getAttribute("r") ?? "0", 10) > num) {
        before = cand;
        break;
      }
    }
    sheetData.insertBefore(rowEl, before);
    rowByNum.set(num, rowEl);
    return rowEl;
  };

  for (const w of patch.writes) {
    const rowNum = w.r + 1;
    if (!rowByNum.has(rowNum) && w.text === "") continue;
    const rowEl = getRow(rowNum);
    const ref = cellRef(w.r, w.c);
    let cellEl = childrenNamed(rowEl, "c").find((c2) => c2.getAttribute("r") === ref) ?? null;
    if (!cellEl && w.text === "") continue;
    if (!cellEl) {
      cellEl = el("c");
      cellEl.setAttribute("r", ref);
      let before: Element | null = null;
      for (const cand of childrenNamed(rowEl, "c")) {
        const candRef = cand.getAttribute("r");
        if (candRef && parseRef(candRef).c > w.c) {
          before = cand;
          break;
        }
      }
      rowEl.insertBefore(cellEl, before);
      // The spans hint no longer covers the added cell; it's optional, so drop it.
      rowEl.removeAttribute("spans");
    }

    // Strip the old contents but keep the element (and its `s` style index).
    for (const child of Array.from(cellEl.children)) {
      if (child.localName === "f") removedFormula = true;
      cellEl.removeChild(child);
    }
    if (w.text === "") {
      cellEl.removeAttribute("t");
      // A bare styled cell keeps its formatting; a fully plain empty is noise.
      if (!cellEl.getAttribute("s")) rowEl.removeChild(cellEl);
      continue;
    }
    if (isFormula(w.text)) {
      // Write a formula (no leading '='); omit the cached <v> so Excel
      // recomputes on open. Treat as a formula change so calcChain is dropped.
      removedFormula = true;
      cellEl.removeAttribute("t");
      const fEl = el("f");
      fEl.textContent = w.text.slice(1);
      cellEl.appendChild(fEl);
      continue;
    }
    const v = coerce(w.text);
    if (typeof v === "number") {
      cellEl.removeAttribute("t");
      const vEl = el("v");
      vEl.textContent = String(v);
      cellEl.appendChild(vEl);
    } else {
      cellEl.setAttribute("t", "inlineStr");
      const isEl = el("is");
      const tEl = el("t");
      tEl.textContent = w.text;
      if (/^\s|\s$/.test(w.text)) tEl.setAttribute("xml:space", "preserve");
      isEl.appendChild(tEl);
      cellEl.appendChild(isEl);
    }
  }

  // Drop rows/cells beyond the new bounds (rows/cols removed in the editor).
  for (const [num, rowEl] of rowByNum) {
    if (num > patch.endRow + 1) {
      if (rowEl.getElementsByTagName("f").length > 0) removedFormula = true;
      sheetData.removeChild(rowEl);
      rowByNum.delete(num);
      continue;
    }
    for (const c2 of childrenNamed(rowEl, "c")) {
      const ref2 = c2.getAttribute("r");
      if (ref2 && parseRef(ref2).c > patch.endCol) {
        if (childrenNamed(c2, "f").length > 0) removedFormula = true;
        rowEl.removeChild(c2);
      }
    }
  }

  // Keep the dimension hint honest (Excel tolerates drift, but it's cheap).
  const dim = childrenNamed(root, "dimension")[0];
  if (dim) {
    const startRef = (dim.getAttribute("ref") ?? "A1").split(":")[0]!;
    dim.setAttribute("ref", `${startRef}:${cellRef(patch.endRow, patch.endCol)}`);
  }

  // Clamp ranged features so nothing points past the end of a shrunken sheet.
  const af = childrenNamed(root, "autoFilter")[0];
  const afRef = af?.getAttribute("ref");
  if (af && afRef?.includes(":")) {
    const [a, b] = afRef.split(":") as [string, string];
    const s = parseRef(a);
    const e = parseRef(b);
    const er = Math.min(e.r, patch.endRow);
    const ec = Math.min(e.c, patch.endCol);
    if (s.r > er || s.c > ec) root.removeChild(af);
    else af.setAttribute("ref", `${a}:${cellRef(er, ec)}`);
  }

  const mc = childrenNamed(root, "mergeCells")[0];
  if (mc) {
    for (const m of childrenNamed(mc, "mergeCell")) {
      const ref = m.getAttribute("ref");
      if (!ref?.includes(":")) continue;
      const [a, b] = ref.split(":") as [string, string];
      const s = parseRef(a);
      const e = parseRef(b);
      if (s.r > patch.endRow || s.c > patch.endCol) {
        mc.removeChild(m);
        continue;
      }
      m.setAttribute("ref", `${a}:${cellRef(Math.min(e.r, patch.endRow), Math.min(e.c, patch.endCol))}`);
    }
    const left = childrenNamed(mc, "mergeCell").length;
    if (left === 0) root.removeChild(mc);
    else mc.setAttribute("count", String(left));
  }

  return removedFormula;
}
