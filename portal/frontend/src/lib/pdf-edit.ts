// Document surgery for the PDF editor, on top of pdf-lib.
//
// Every operation takes the current bytes and returns new bytes, which keeps
// the editor's undo stack trivial (a list of buffers) and guarantees the
// thumbnails you see were rendered from exactly what would be saved. All of it
// runs in the browser — the public viewer is a Cloudflare Worker and has no
// server-side PDF toolchain.
//
// Scope is deliberately the subset of a Stirling-PDF-style toolbox that a pure
// client can do honestly: page arrangement, merge/split, rotation, metadata and
// flattened mark-up. Encryption, OCR and format conversion need a server and are
// not pretended at here.

import { LineCapStyle, PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { openPdf } from "./pdf";

export interface PdfMetadata {
  title: string;
  author: string;
  subject: string;
  keywords: string;
  creator: string;
  producer: string;
}

/** Normalised annotation geometry: 0..1 across the page as it is displayed. */
export type PdfAnnotation =
  | {
      kind: "text";
      /** Baseline start of the first line. */
      x: number;
      y: number;
      /** Font size in PDF points. */
      size: number;
      color: string;
      text: string;
    }
  | { kind: "highlight"; x: number; y: number; w: number; h: number; color: string }
  | { kind: "ink"; points: [number, number][]; color: string; width: number };

/** Annotations awaiting flattening, keyed by 0-based page index. */
export type AnnotationsByPage = Record<number, PdfAnnotation[]>;

export class EncryptedPdfError extends Error {
  constructor() {
    super("This PDF is encrypted. Remove its password before editing it here.");
    this.name = "EncryptedPdfError";
  }
}

// ---- load / save ----

async function load(bytes: Uint8Array): Promise<PDFDocument> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  if (doc.isEncrypted) throw new EncryptedPdfError();
  return doc;
}

/** A second, independent handle on the same bytes — the source for copyPages. */
async function loadSource(bytes: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(bytes, { updateMetadata: false });
}

async function save(doc: PDFDocument): Promise<Uint8Array> {
  return doc.save({ addDefaultPage: false });
}

export async function pageCount(bytes: Uint8Array): Promise<number> {
  return (await load(bytes)).getPageCount();
}

// ---- page operations ----

/** Add `delta` degrees (a multiple of 90) to each selected page's /Rotate. */
export async function rotatePages(
  bytes: Uint8Array,
  indices: number[],
  delta: number,
): Promise<Uint8Array> {
  const doc = await load(bytes);
  const pages = doc.getPages();
  for (const i of indices) {
    const page = pages[i];
    if (!page) continue;
    const next = (((page.getRotation().angle + delta) % 360) + 360) % 360;
    page.setRotation(degrees(next));
  }
  return save(doc);
}

export async function deletePages(bytes: Uint8Array, indices: number[]): Promise<Uint8Array> {
  const doc = await load(bytes);
  if (indices.length >= doc.getPageCount()) {
    throw new Error("A PDF must keep at least one page.");
  }
  // Descending, so earlier indices stay valid as pages are removed.
  for (const i of [...indices].sort((a, b) => b - a)) doc.removePage(i);
  return save(doc);
}

/**
 * Re-sequence the whole document. `order` lists the current page indices in
 * their new positions and must be a permutation of `[0, pageCount)`.
 */
export async function reorderPages(bytes: Uint8Array, order: number[]): Promise<Uint8Array> {
  const doc = await load(bytes);
  const pages = doc.getPages();
  if (order.length !== pages.length) throw new Error("Page order is incomplete.");
  // Detach every page, then re-insert in the requested sequence. The PDFPage
  // objects stay valid across removal — their underlying refs are untouched.
  for (let i = pages.length - 1; i >= 0; i--) doc.removePage(i);
  for (const idx of order) doc.addPage(pages[idx]);
  return save(doc);
}

/** Move the selected pages so the first of them lands at `target`. */
export function moveSelection(order: number[], selected: number[], target: number): number[] {
  const set = new Set(selected);
  const rest = order.filter((i) => !set.has(i));
  const moving = order.filter((i) => set.has(i));
  const at = Math.max(0, Math.min(target, rest.length));
  return [...rest.slice(0, at), ...moving, ...rest.slice(at)];
}

export async function duplicatePages(bytes: Uint8Array, indices: number[]): Promise<Uint8Array> {
  const doc = await load(bytes);
  const src = await loadSource(bytes);
  // Insert from the back so each copy lands straight after its original.
  for (const i of [...indices].sort((a, b) => b - a)) {
    const [copy] = await doc.copyPages(src, [i]);
    doc.insertPage(i + 1, copy);
  }
  return save(doc);
}

/** Insert an empty page matching `likeIndex`'s size, at `at`. */
export async function insertBlankPage(
  bytes: Uint8Array,
  at: number,
  likeIndex: number,
): Promise<Uint8Array> {
  const doc = await load(bytes);
  const model = doc.getPages()[likeIndex] ?? doc.getPages()[0];
  const { width, height } = model.getSize();
  doc.insertPage(Math.max(0, Math.min(at, doc.getPageCount())), [width, height]);
  return save(doc);
}

/** Splice every page of `otherBytes` into the document at `at`. */
export async function importPages(
  bytes: Uint8Array,
  otherBytes: Uint8Array,
  at: number,
): Promise<Uint8Array> {
  const doc = await load(bytes);
  const src = await loadSource(otherBytes);
  const copies = await doc.copyPages(src, src.getPageIndices());
  let cursor = Math.max(0, Math.min(at, doc.getPageCount()));
  for (const page of copies) doc.insertPage(cursor++, page);
  return save(doc);
}

/** A new single-document PDF holding only `indices`, in the order given. */
export async function extractPages(bytes: Uint8Array, indices: number[]): Promise<Uint8Array> {
  if (!indices.length) throw new Error("Select at least one page to extract.");
  const src = await loadSource(bytes);
  const out = await PDFDocument.create();
  const copies = await out.copyPages(src, indices);
  for (const page of copies) out.addPage(page);
  const meta = await readMetadata(bytes);
  if (meta.title) out.setTitle(meta.title);
  if (meta.author) out.setAuthor(meta.author);
  return save(out);
}

// ---- metadata ----

export async function readMetadata(bytes: Uint8Array): Promise<PdfMetadata> {
  const doc = await loadSource(bytes);
  return {
    title: doc.getTitle() ?? "",
    author: doc.getAuthor() ?? "",
    subject: doc.getSubject() ?? "",
    keywords: doc.getKeywords() ?? "",
    creator: doc.getCreator() ?? "",
    producer: doc.getProducer() ?? "",
  };
}

export async function writeMetadata(
  bytes: Uint8Array,
  meta: PdfMetadata,
): Promise<Uint8Array> {
  const doc = await load(bytes);
  doc.setTitle(meta.title);
  doc.setAuthor(meta.author);
  doc.setSubject(meta.subject);
  doc.setKeywords(
    meta.keywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean),
  );
  doc.setCreator(meta.creator);
  doc.setProducer(meta.producer);
  doc.setModificationDate(new Date());
  return save(doc);
}

// ---- annotations ----

/** #rrggbb (or #rgb) → a pdf-lib colour. Unparseable values fall back to black. */
function toRgb(hex: string) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return rgb(0, 0, 0);
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const n = parseInt(h, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

// WinAnsi is all the standard Helvetica can encode, so anything outside it
// (CJK above all) has to be replaced rather than silently corrupt the save.
const WIN_ANSI_SAFE = /[ -~ -ÿ€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ\n]/;

export function sanitizeForStandardFont(text: string): { text: string; dropped: number } {
  let dropped = 0;
  const out = Array.from(text, (ch) => {
    if (WIN_ANSI_SAFE.test(ch)) return ch;
    dropped++;
    return "?";
  }).join("");
  return { text: out, dropped };
}

/**
 * Burn pending annotations into the page content.
 *
 * Coordinates arrive normalised against the page *as displayed* (rotation
 * applied, y measured from the top). pdf.js's viewport does the conversion back
 * to PDF user space, so pages with a /Rotate land in the right place; text is
 * additionally pre-rotated by the page rotation so it reads upright on screen.
 *
 * The result is ordinary page content, not PDF annotation objects — it prints
 * and renders everywhere, and is not separately editable afterwards.
 */
export async function flattenAnnotations(
  bytes: Uint8Array,
  byPage: AnnotationsByPage,
): Promise<{ bytes: Uint8Array; droppedChars: number }> {
  const pageIndices = Object.keys(byPage)
    .map(Number)
    .filter((i) => byPage[i]?.length);
  if (!pageIndices.length) return { bytes, droppedChars: 0 };

  const doc = await load(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pdfjsDoc = await openPdf(bytes);
  let droppedChars = 0;

  try {
    for (const index of pageIndices) {
      const page = doc.getPages()[index];
      if (!page) continue;
      const jsPage = await pdfjsDoc.getPage(index + 1);
      const viewport = jsPage.getViewport({ scale: 1, rotation: jsPage.rotate });
      const dw = viewport.width;
      const dh = viewport.height;
      const rotation = page.getRotation().angle;
      /** Normalised display point → PDF user-space point. */
      const toUser = (nx: number, ny: number): [number, number] => {
        const [x, y] = viewport.convertToPdfPoint(nx * dw, ny * dh);
        return [x, y];
      };

      for (const a of byPage[index]) {
        if (a.kind === "text") {
          const { text, dropped } = sanitizeForStandardFont(a.text);
          droppedChars += dropped;
          if (!text.trim()) continue;
          const [x, y] = toUser(a.x, a.y);
          page.drawText(text, {
            x,
            y,
            size: a.size,
            font,
            color: toRgb(a.color),
            lineHeight: a.size * 1.2,
            rotate: degrees(rotation),
          });
        } else if (a.kind === "highlight") {
          const [x1, y1] = toUser(a.x, a.y);
          const [x2, y2] = toUser(a.x + a.w, a.y + a.h);
          page.drawRectangle({
            x: Math.min(x1, x2),
            y: Math.min(y1, y2),
            width: Math.abs(x2 - x1),
            height: Math.abs(y2 - y1),
            color: toRgb(a.color),
            opacity: 0.35,
            borderWidth: 0,
          });
        } else {
          const pts = a.points.map(([nx, ny]) => toUser(nx, ny));
          for (let i = 1; i < pts.length; i++) {
            page.drawLine({
              start: { x: pts[i - 1][0], y: pts[i - 1][1] },
              end: { x: pts[i][0], y: pts[i][1] },
              thickness: a.width,
              color: toRgb(a.color),
              lineCap: LineCapStyle.Round,
            });
          }
        }
      }
    }
  } finally {
    void pdfjsDoc.loadingTask.destroy();
  }

  return { bytes: await save(doc), droppedChars };
}
