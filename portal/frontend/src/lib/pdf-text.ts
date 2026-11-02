// Reading and redrawing text for the PDF editor's "Edit text" tool.
//
// What the tool does is the cover-and-redraw approach: find where a line of
// text sits, paint the local background over it, and draw the replacement on
// the same baseline. It is visually exact — printing, screenshots and anyone
// reading the PDF see the new text — but the original glyphs are still in the
// page's content stream underneath, so search and copy/paste keep finding the
// old words. Removing them for real means rewriting content-stream operators
// (Tj/TJ under arbitrary cm/Tm transforms), which no client-side library does
// reliably; that limit is stated in the UI rather than hidden.
//
// Fonts: the replacement can't reuse the PDF's own font (embedded fonts are
// usually subsets missing the new characters), so text that WinAnsi can encode
// is drawn as real text in the matching standard face (Helvetica / Times /
// Courier), and anything else — CJK above all — is rendered by the browser
// with a system font and embedded as a high-resolution image. That needs no
// font download and covers every script the reader's machine can display.
//
// Browser-only, like the rest of the editor.

import type { PDFDocumentProxy } from "pdfjs-dist";

export type FontKind = "sans" | "serif" | "mono";

export interface TextRun {
  /** Stable within one document version: `${page}:${index}`. */
  key: string;
  text: string;
  kind: FontKind;
  /** Em size in PDF points. */
  size: number;
  /** The page's /Rotate: on screen the run reads turned this far clockwise. */
  rotate: number;
  /** Ink box normalised to the page as displayed (rotation applied, y from top). */
  box: { x: number; y: number; w: number; h: number };
  /** The same run in PDF user space: ink box plus the baseline start. */
  pdf: { x1: number; y1: number; x2: number; y2: number; baseX: number; baseY: number };
}

/** CSS font stacks for drawing replacement text in the browser. */
export const FONT_STACK: Record<FontKind, string> = {
  sans:
    '"Helvetica Neue", Helvetica, Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", ' +
    '"Noto Sans CJK SC", "Source Han Sans SC", "WenQuanYi Zen Hei", sans-serif',
  serif:
    '"Times New Roman", Times, "Songti SC", STSong, SimSun, "Noto Serif CJK SC", ' +
    '"Source Han Serif SC", serif',
  mono: '"Courier New", Courier, "Noto Sans Mono CJK SC", monospace',
};

function kindOf(fallbackName: string | undefined): FontKind {
  if (fallbackName === "serif") return "serif";
  if (fallbackName === "monospace") return "mono";
  return "sans";
}

// ---- reading ----

interface Item {
  str: string;
  x1: number;
  x2: number;
  baseY: number;
  top: number;
  bottom: number;
  size: number;
  kind: FontKind;
  eol: boolean;
}

/**
 * The page's text as editable runs: pdf.js items merged into contiguous
 * stretches on one baseline. Merging matters for CJK, where many PDFs place
 * every character as its own item; without it each click would grab one glyph.
 * A run stops at a wider gap, a change of size or baseline, or a line end.
 *
 * Only horizontal, left-to-right text is offered — rotated or vertical runs
 * are rare and a box drawn around them would be wrong.
 */
export async function extractTextRuns(
  doc: PDFDocumentProxy,
  pageNumber: number,
): Promise<TextRun[]> {
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1, rotation: page.rotate });
  const content = await page.getTextContent();

  const items: Item[] = [];
  for (const it of content.items) {
    if (!("str" in it)) continue;
    const [a, b, c, d, e, f] = it.transform as number[];
    const size = Math.hypot(c, d);
    // Horizontal and upright in user space: no rotation or shear.
    if (!(a > 0 && d > 0) || Math.abs(b) > a * 0.01 || Math.abs(c) > d * 0.01 || size <= 0) {
      continue;
    }
    const style = content.styles[it.fontName];
    if (style?.vertical) continue;
    const ascent = typeof style?.ascent === "number" && style.ascent > 0 ? style.ascent : 0.8;
    const descent = typeof style?.descent === "number" && style.descent < 0 ? style.descent : -0.2;
    items.push({
      str: it.str,
      x1: e,
      x2: e + it.width,
      baseY: f,
      top: f + ascent * size,
      bottom: f + descent * size,
      size,
      kind: kindOf(style?.fontFamily),
      eol: it.hasEOL,
    });
  }

  type Acc = Omit<Item, "eol"> & { baseX: number };
  const merged: Acc[] = [];
  let cur: Acc | null = null;
  for (const it of items) {
    const continues =
      cur !== null &&
      Math.abs(it.size - cur.size) <= cur.size * 0.1 &&
      Math.abs(it.baseY - cur.baseY) <= cur.size * 0.15 &&
      it.x1 - cur.x2 >= -cur.size * 0.2 &&
      it.x1 - cur.x2 <= cur.size * 0.35;
    if (cur && continues) {
      const gap = it.x1 - cur.x2;
      const needsSpace = gap > cur.size * 0.15 && !/\s$/.test(cur.str) && !/^\s/.test(it.str);
      cur.str += (needsSpace ? " " : "") + it.str;
      cur.x2 = Math.max(cur.x2, it.x2);
      cur.top = Math.max(cur.top, it.top);
      cur.bottom = Math.min(cur.bottom, it.bottom);
    } else {
      if (cur) merged.push(cur);
      cur = { ...it, baseX: it.x1 };
    }
    if (it.eol && cur) {
      merged.push(cur);
      cur = null;
    }
  }
  if (cur) merged.push(cur);

  const vw = viewport.width;
  const vh = viewport.height;
  const runs: TextRun[] = [];
  for (const r of merged) {
    const text = r.str.replace(/\s+$/, "");
    if (!text.trim() || r.x2 <= r.x1) continue;
    // Box corners through the viewport, which applies the page's /Rotate.
    const pts = [
      viewport.convertToViewportPoint(r.x1, r.bottom),
      viewport.convertToViewportPoint(r.x2, r.bottom),
      viewport.convertToViewportPoint(r.x1, r.top),
      viewport.convertToViewportPoint(r.x2, r.top),
    ];
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const left = Math.min(...xs);
    const topPx = Math.min(...ys);
    runs.push({
      key: `${pageNumber - 1}:${runs.length}`,
      text,
      kind: r.kind,
      size: r.size,
      rotate: ((page.rotate % 360) + 360) % 360,
      box: {
        x: left / vw,
        y: topPx / vh,
        w: (Math.max(...xs) - left) / vw,
        h: (Math.max(...ys) - topPx) / vh,
      },
      pdf: { x1: r.x1, y1: r.bottom, x2: r.x2, y2: r.top, baseX: r.baseX, baseY: r.baseY },
    });
  }
  return runs;
}

// ---- colour sampling ----

function hex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}

/**
 * The paper colour around a run and the ink colour inside it, sampled from the
 * page as rendered. Covering with hard-coded white only works on white paper;
 * scans, tinted boxes and highlighted headers need the local colour.
 *
 * Background is the most common (quantised) colour in a ring just outside the
 * box — outside, so glyphs can't win. Ink is the pixel inside the box that is
 * furthest from that background, which also works for light text on dark.
 */
export function sampleRunColors(
  canvas: HTMLCanvasElement,
  box: TextRun["box"],
): { background: string; ink: string } {
  const fallback = { background: "#ffffff", ink: "#000000" };
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext("2d", { willReadFrequently: true });
  } catch {
    return fallback;
  }
  if (!ctx || !canvas.width || !canvas.height) return fallback;

  const W = canvas.width;
  const H = canvas.height;
  const pad = Math.max(2, Math.round(box.h * H * 0.25));
  const x0 = Math.max(0, Math.floor(box.x * W) - pad);
  const y0 = Math.max(0, Math.floor(box.y * H) - pad);
  const x1 = Math.min(W, Math.ceil((box.x + box.w) * W) + pad);
  const y1 = Math.min(H, Math.ceil((box.y + box.h) * H) + pad);
  if (x1 - x0 < 2 || y1 - y0 < 2) return fallback;

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
  } catch {
    return fallback;
  }
  const rowW = x1 - x0;
  const ix0 = Math.floor(box.x * W) - x0;
  const iy0 = Math.floor(box.y * H) - y0;
  const ix1 = Math.ceil((box.x + box.w) * W) - x0;
  const iy1 = Math.ceil((box.y + box.h) * H) - y0;
  const inside = (x: number, y: number) => x >= ix0 && x < ix1 && y >= iy0 && y < iy1;

  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  let best = { n: 0, r: 255, g: 255, b: 255 };
  for (let y = 0; y < y1 - y0; y++) {
    for (let x = 0; x < rowW; x++) {
      if (inside(x, y)) continue;
      const i = (y * rowW + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      const hit = buckets.get(k) ?? { n: 0, r, g, b };
      hit.n++;
      buckets.set(k, hit);
      if (hit.n > best.n) best = hit;
    }
  }

  let far = -1;
  let ink = { r: 0, g: 0, b: 0 };
  for (let y = Math.max(0, iy0); y < Math.min(y1 - y0, iy1); y++) {
    for (let x = Math.max(0, ix0); x < Math.min(rowW, ix1); x++) {
      const i = (y * rowW + x) * 4;
      const dist =
        (data[i] - best.r) ** 2 + (data[i + 1] - best.g) ** 2 + (data[i + 2] - best.b) ** 2;
      if (dist > far) {
        far = dist;
        ink = { r: data[i], g: data[i + 1], b: data[i + 2] };
      }
    }
  }
  return {
    background: hex(best.r, best.g, best.b),
    // A run with no contrast at all (blank box) gets plain black text.
    ink: far < 40 * 40 ? "#000000" : hex(ink.r, ink.g, ink.b),
  };
}

// ---- drawing text in the browser ----

let measureCtx: CanvasRenderingContext2D | null = null;

/** Width in CSS px of `text` set at `px` in the given face. */
export function measureTextPx(text: string, kind: FontKind, px: number): number {
  measureCtx ??= document.createElement("canvas").getContext("2d");
  if (!measureCtx) return text.length * px * 0.6;
  measureCtx.font = `${px}px ${FONT_STACK[kind]}`;
  return measureCtx.measureText(text).width;
}

/** Bitmap pixels per PDF point for rasterised text: 4 → 288 dpi. */
const RASTER_PX_PER_PT = 4;

export interface RasterText {
  png: Uint8Array;
  /** Image size in PDF points. */
  width: number;
  height: number;
  /** Distance from the first line's baseline down to the image's bottom edge, in points. */
  belowBaseline: number;
}

/**
 * Render text with the browser's fonts into a transparent PNG. Used for
 * anything the standard 14 PDF fonts can't encode (CJK, Cyrillic, emoji …).
 */
export async function rasterizeText(
  text: string,
  opts: { size: number; color: string; kind: FontKind; lineHeight?: number },
): Promise<RasterText> {
  const px = opts.size * RASTER_PX_PER_PT;
  const lines = text.split("\n");
  const lineH = (opts.lineHeight ?? opts.size * 1.2) * RASTER_PX_PER_PT;
  const font = `${px}px ${FONT_STACK[opts.kind]}`;

  const probe = document.createElement("canvas").getContext("2d");
  if (!probe) throw new Error("Canvas 2D is not available");
  probe.font = font;
  let width = 0;
  let ascent = px * 0.9;
  let descent = px * 0.25;
  for (const line of lines) {
    const m = probe.measureText(line || " ");
    width = Math.max(width, m.width);
    if (m.fontBoundingBoxAscent) ascent = Math.max(ascent, m.fontBoundingBoxAscent);
    if (m.fontBoundingBoxDescent) descent = Math.max(descent, m.fontBoundingBoxDescent);
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width) + 2);
  canvas.height = Math.max(1, Math.ceil(ascent + descent + (lines.length - 1) * lineH));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is not available");
  ctx.font = font;
  ctx.fillStyle = opts.color;
  ctx.textBaseline = "alphabetic";
  lines.forEach((line, i) => ctx.fillText(line, 1, ascent + i * lineH));

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  const w = canvas.width;
  const h = canvas.height;
  canvas.width = 0; // free the bitmap now rather than at GC
  canvas.height = 0;
  if (!blob) throw new Error("Could not encode the text image");
  return {
    png: new Uint8Array(await blob.arrayBuffer()),
    width: w / RASTER_PX_PER_PT,
    height: h / RASTER_PX_PER_PT,
    belowBaseline: (h - ascent) / RASTER_PX_PER_PT,
  };
}
