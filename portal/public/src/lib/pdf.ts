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
type PdfWorker = InstanceType<PdfJs["PDFWorker"]>;

let pdfjsPromise: Promise<PdfJs> | null = null;
let sharedWorker: PdfWorker | null = null;

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
    // Start the worker now, so it boots while the caller is still fetching.
    workerFor(pdfjs);
    return pdfjs;
  })();
  return pdfjsPromise;
}

/**
 * One worker shared by every document, passed to getDocument explicitly.
 *
 * Safe where `workerPort` was not: pdf.js only tears a worker down on
 * `loadingTask.destroy()` when it created that worker itself; a worker handed
 * in through the `worker` option is left running and only that document's
 * transport is closed. Sharing it saves a worker start-up — compiling the
 * ~1 MB worker script — on every open, which the editor pays after every edit
 * because each one re-opens the document.
 */
function workerFor(pdfjs: PdfJs): PdfWorker {
  if (!sharedWorker || sharedWorker.destroyed) sharedWorker = new pdfjs.PDFWorker();
  return sharedWorker;
}

/** Begin loading pdf.js and booting its worker without waiting for either. */
export function preloadPdfJs(): void {
  void loadPdfJs();
}

/** Absolute URL for a file under public/pdfjs (see scripts/copy-pdfjs-assets.mjs). */
function pdfjsAsset(path: string): string {
  return new URL(`/pdfjs/${path}`, window.location.origin).href;
}

/**
 * Open a PDF from raw bytes. Copies the buffer — pdf.js transfers (detaches)
 * what it is given, and callers such as the editor keep using their bytes.
 *
 * The four URLs point pdf.js at its runtime data, served from our own origin.
 * They are not optional extras: without `cMapUrl`, text set in a non-embedded
 * CJK font (predefined CMaps such as UniGB-UCS2-H) silently fails to render,
 * and without `wasmUrl` every JPEG 2000 / JBIG2 image — the usual encoding of
 * scanned papers — decodes to nothing ("OpenJPEG failed to initialize").
 * Each file is fetched lazily, only when a document actually needs it.
 */
export async function openPdf(bytes: ArrayBuffer | Uint8Array): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfJs();
  const data = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes.slice(0));
  return pdfjs.getDocument({
    data,
    worker: workerFor(pdfjs),
    cMapUrl: pdfjsAsset("cmaps/"),
    cMapPacked: true,
    standardFontDataUrl: pdfjsAsset("standard_fonts/"),
    wasmUrl: pdfjsAsset("wasm/"),
    iccUrl: pdfjsAsset("iccs/"),
  }).promise;
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

/**
 * Largest bitmap one page canvas may use: 4096², which is also iOS Safari's
 * hard limit (beyond it the canvas silently draws nothing). At 400% zoom an A4
 * page at dpr 2 would otherwise be ~31 MP / 124 MB for a single page.
 */
export const MAX_CANVAS_PIXELS = 4096 * 4096;

/** Bitmap pixels per CSS pixel for a page of the given CSS size. */
export function outputScale(cssWidth: number, cssHeight: number): number {
  const cap = Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, cssWidth * cssHeight));
  return Math.min(renderDpr(), cap);
}

// ---- render scheduling ----
//
// pdf.js parses in its worker, but *drawing* runs on the main thread in
// ~15 ms slices. Ten pages rendering at once don't render in parallel — they
// interleave, so all ten finish late and scrolling stutters throughout. A
// small cap lets the visible pages finish first, and pages scrolled past while
// still queued drop out without ever starting.

const MAX_CONCURRENT_RENDERS = 2;

/** Higher runs first. Thumbnails yield to the pages being read. */
export const RenderPriority = { page: 2, thumb: 1 } as const;

interface Waiter {
  priority: number;
  grant: () => void;
}

let activeRenders = 0;
const renderQueue: Waiter[] = [];

/** Give a slot we hold to the next waiter, or free it if nobody is waiting. */
function passSlotOn(): void {
  const next = renderQueue.shift();
  if (next) next.grant();
  else activeRenders--;
}

/**
 * Wait for a render slot; resolves with its release function. Rejects if
 * `signal` aborts while waiting. On release the slot is handed straight to the
 * next waiter rather than freed and re-taken, so the cap holds even when an
 * acquire races a release.
 *
 * A held slot is also released when `signal` aborts. Callers release in a
 * `finally`, but that never runs if the awaited pdf.js call never settles —
 * and `getPage()` on a document destroyed mid-request does exactly that. The
 * editor destroys its document after every edit, so without this the two
 * slots leaked within a few edits and every later render waited forever.
 */
export function acquireRenderSlot(priority: number, signal: AbortSignal): Promise<() => void> {
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    signal.removeEventListener("abort", release);
    passSlotOn();
  };
  const hold = () => {
    signal.addEventListener("abort", release, { once: true });
    return release;
  };
  if (activeRenders < MAX_CONCURRENT_RENDERS) {
    activeRenders++;
    return Promise.resolve(hold());
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      const i = renderQueue.indexOf(waiter);
      if (i !== -1) renderQueue.splice(i, 1);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const waiter: Waiter = {
      priority,
      grant: () => {
        signal.removeEventListener("abort", onAbort);
        // Defensive: abort normally removes a waiter before it can be granted,
        // but if one ever is, pass the slot on rather than strand it.
        if (signal.aborted) {
          passSlotOn();
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        resolve(hold());
      },
    };
    signal.addEventListener("abort", onAbort, { once: true });
    // Keep the queue ordered by priority, FIFO within a priority.
    let at = renderQueue.length;
    while (at > 0 && renderQueue[at - 1].priority < priority) at--;
    renderQueue.splice(at, 0, waiter);
  });
}

/** True for the errors a cancelled render or an aborted slot wait produce. */
export function isCancellation(e: unknown): boolean {
  const name = typeof e === "object" && e !== null ? (e as { name?: unknown }).name : undefined;
  return name === "RenderingCancelledException" || name === "AbortError";
}

/** Drop a canvas's backing store. Only shrinking it to 0×0 frees the bitmap. */
export function releaseCanvas(canvas: HTMLCanvasElement | null | undefined): void {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
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
