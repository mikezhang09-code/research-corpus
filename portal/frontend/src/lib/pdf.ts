// PDF helpers shared by the viewer (PdfViewerPane) and editor (PdfEditorPane).
//
// Everything here runs in the browser: the public viewer is a Cloudflare
// Worker and the private portal's Next server has no PDF toolchain, so all
// rendering (pdf.js) and all document surgery (pdf-lib) happens client-side.
// Both libraries are heavy — only import this module from a `next/dynamic`
// pane, never from a component that lands in the main bundle.

import type { PDFDocumentProxy, PageViewport } from "pdfjs-dist";

export const PDF_MIME = "application/pdf";

type PdfJs = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<PdfJs> | null = null;

/**
 * Load pdf.js and point it at its web worker, once per page load.
 *
 * `new URL(..., import.meta.url)` makes the bundler emit the worker as a
 * static asset served from our own origin — no CDN, which matters because both
 * deployments sit behind an auth gate.
 *
 * It must be `workerSrc`, not `workerPort`: a port is a single worker shared by
 * every document, and `loadingTask.destroy()` on any one of them tears that
 * shared worker down, so the next document opens onto a dead worker
 * ("PDFWorker.create - the worker is being destroyed"). With `workerSrc`,
 * pdf.js spawns one worker per document and destroy stays local to it.
 */
export function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= (async () => {
    // Legacy build: it polyfills newer built-ins pdf.js 6 relies on (e.g.
    // Map#getOrInsertComputed), which the modern build assumes and which
    // older Safari/Chrome lack — pages there would fail to render.
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
        import.meta.url,
      ).href;
    }
    return pdfjs;
  })();
  return pdfjsPromise;
}

/** Open a PDF from raw bytes. Copies the buffer — pdf.js detaches what it is given. */
export async function openPdf(bytes: ArrayBuffer | Uint8Array): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfJs();
  const data = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes.slice(0));
  return pdfjs.getDocument({ data }).promise;
}

// ---- geometry ----

/** CSS pixel size of a page at a given scale + extra view rotation. */
export function pageSizeAt(viewport: PageViewport): { width: number; height: number } {
  return { width: Math.floor(viewport.width), height: Math.floor(viewport.height) };
}

/** Device-pixel-ratio cap — rendering a huge page at 3× eats memory for nothing. */
export const MAX_RENDER_DPR = 2;

export function renderDpr(): number {
  if (typeof window === "undefined") return 1;
  return Math.min(window.devicePixelRatio || 1, MAX_RENDER_DPR);
}

// ---- formatting ----

export function formatBytes(n: number | null | undefined): string {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Trigger a browser download for in-memory PDF bytes. */
export function downloadBytes(bytes: Uint8Array, filename: string, mime = PDF_MIME): void {
  // `bytes.slice()` yields a standalone ArrayBuffer, which keeps TS happy
  // about SharedArrayBuffer-backed views and avoids aliasing surprises.
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** `My report.pdf` from a title that may or may not already carry the extension. */
export function pdfFilename(title: string, suffix = ""): string {
  const base = (title || "document").replace(/\.pdf$/i, "").trim() || "document";
  return `${base}${suffix}.pdf`;
}

// ---- text search over a rendered text layer ----

export interface TextMatch {
  /** 0-based page index. */
  page: number;
  /** Index of the first text item the match touches. */
  beginItem: number;
  beginOffset: number;
  endItem: number;
  endOffset: number;
}

/**
 * Find every occurrence of `query` in a page's text items.
 *
 * Items are concatenated so a phrase split across spans still matches; the
 * resulting range is mapped back to (item, offset) pairs the highlighter can
 * use. Case folding is only applied when it preserves length, so offsets into
 * the folded string always address the same characters as the original.
 */
export function findMatches(items: string[], query: string, page: number): TextMatch[] {
  if (!query) return [];
  const starts: number[] = [];
  let joined = "";
  for (const item of items) {
    starts.push(joined.length);
    joined += item;
  }

  const lowerJoined = joined.toLowerCase();
  const haystack = lowerJoined.length === joined.length ? lowerJoined : joined;
  const needle = haystack === lowerJoined ? query.toLowerCase() : query;
  if (!needle) return [];

  const locate = (pos: number): { item: number; offset: number } => {
    // Last item whose start is <= pos.
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return { item: lo, offset: pos - starts[lo] };
  };

  const out: TextMatch[] = [];
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) break;
    const begin = locate(at);
    const end = locate(at + needle.length);
    out.push({
      page,
      beginItem: begin.item,
      beginOffset: begin.offset,
      endItem: end.item,
      endOffset: end.offset,
    });
    from = at + Math.max(needle.length, 1);
  }
  return out;
}

/**
 * Paint `matches` onto the spans pdf.js produced for a text layer.
 *
 * Each affected span is rebuilt as text + `<span class="pdf-hl">` runs, which
 * is how pdf.js's own viewer highlights search hits: the spans are already
 * positioned and scaled over the canvas, so a nested span lands exactly on the
 * glyphs. Spans are restored from `items` first so repeat calls are idempotent.
 */
export function paintMatches(
  divs: HTMLElement[],
  items: string[],
  matches: TextMatch[],
  activeIndex: number,
): void {
  // Ranges per span: [start, end, isActive]
  const perDiv = new Map<number, [number, number, boolean][]>();
  matches.forEach((m, i) => {
    for (let d = m.beginItem; d <= m.endItem && d < items.length; d++) {
      const start = d === m.beginItem ? m.beginOffset : 0;
      const end = d === m.endItem ? m.endOffset : items[d].length;
      if (end <= start) continue;
      const list = perDiv.get(d) ?? [];
      list.push([start, end, i === activeIndex]);
      perDiv.set(d, list);
    }
  });

  divs.forEach((div, i) => {
    const ranges = perDiv.get(i);
    const text = items[i] ?? div.textContent ?? "";
    if (!ranges || ranges.length === 0) {
      if (div.childElementCount > 0) div.textContent = text;
      return;
    }
    ranges.sort((a, b) => a[0] - b[0]);
    const frag = document.createDocumentFragment();
    let cursor = 0;
    for (const [start, end, active] of ranges) {
      const from = Math.max(start, cursor);
      if (from >= end) continue;
      if (from > cursor) frag.append(text.slice(cursor, from));
      const mark = document.createElement("span");
      mark.className = active ? "pdf-hl pdf-hl-active" : "pdf-hl";
      mark.textContent = text.slice(from, end);
      frag.append(mark);
      cursor = end;
    }
    if (cursor < text.length) frag.append(text.slice(cursor));
    div.textContent = "";
    div.append(frag);
  });
}
