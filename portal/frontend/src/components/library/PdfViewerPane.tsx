"use client";

// Self-contained PDF reader built on pdf.js. Replaces the old "Open in a new
// tab and let the browser render it" path so PDFs behave like every other
// artifact in the portal: same paper/ink chrome, same modal, and the same
// controls whether or not the browser ships a PDF plugin.
//
// Features: continuous scroll with lazy page rendering, zoom (fit-width /
// fit-page / stepped), view rotation, a real text layer (selection + copy),
// full-document search with hit highlighting, a thumbnail rail, the document
// outline, print, and download.
//
// Heavy (pdf.js) — always mount through `next/dynamic` with `ssr: false`.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import {
  AlertCircle, ChevronLeft, ChevronRight, ChevronUp, Download, Loader2, Maximize,
  Minus, Plus, Printer, RotateCw, Search, List, Image as ImageIcon, X, ArrowDownToLine,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  downloadBytes, findMatches, openPdf, paintMatches, pdfFilename, renderDpr,
  type TextMatch,
} from "@/lib/pdf";

// ---- constants ----

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6];
/** Space around a page inside the scroll area, in CSS px. */
const GUTTER = 24;
/** Render a page once it is within this many px of the viewport. */
const PRERENDER_MARGIN = 600;
/** Printing rasterises every page — refuse beyond this to avoid freezing the tab. */
const PRINT_PAGE_LIMIT = 80;

type Zoom = number | "fit-width" | "fit-page";
type Side = "thumbs" | "outline" | null;

interface PageGeom {
  /** The page's own /Rotate, in degrees. */
  rotate: number;
  /** Intrinsic size in PDF points, before any view rotation. */
  width: number;
  height: number;
}

interface OutlineItem {
  title: string;
  dest: string | unknown[] | null;
  depth: number;
}

// ---- helpers ----

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Size of a page on screen at `scale`, including the extra view rotation. */
function sizeOf(geom: PageGeom, scale: number, rotation: number): { w: number; h: number } {
  const swap = ((geom.rotate + rotation) % 180 + 180) % 180 === 90;
  const w = swap ? geom.height : geom.width;
  const h = swap ? geom.width : geom.height;
  return { w: Math.floor(w * scale), h: Math.floor(h * scale) };
}

// ---- one page ----

function PdfPage({
  doc,
  pageNumber,
  geom,
  scale,
  rotation,
  scrollRef,
  matches,
  activeMatch,
  onElement,
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  geom: PageGeom;
  scale: number;
  rotation: number;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** Search hits on this page, in document order. */
  matches: TextMatch[];
  /** Index into `matches` of the globally active hit, or -1. */
  activeMatch: number;
  onElement: (pageNumber: number, el: HTMLDivElement | null) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const [near, setNear] = useState(false);
  const [painted, setPainted] = useState(false);
  // Text layer output, kept so search repaints don't need a re-render.
  const layerRef = useRef<{ divs: HTMLElement[]; items: string[] } | null>(null);

  const { w, h } = sizeOf(geom, scale, rotation);

  // Only render pages that are on (or near) screen.
  useEffect(() => {
    const el = hostRef.current;
    const root = scrollRef.current;
    if (!el || !root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) setNear(e.isIntersecting);
      },
      { root, rootMargin: `${PRERENDER_MARGIN}px 0px` },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [scrollRef]);

  // Paint the canvas + text layer.
  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    let page: PDFPageProxy | null = null;

    (async () => {
      try {
        page = await doc.getPage(pageNumber);
        if (cancelled) return;
        const viewport = page.getViewport({ scale, rotation: (page.rotate + rotation) % 360 });
        const canvas = canvasRef.current;
        if (!canvas) return;

        const dpr = renderDpr();
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        task = page.render({
          canvas,
          viewport,
          transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
        });
        await task.promise;
        if (cancelled) return;

        // Text layer — selection, copy, and search highlighting.
        const host = textRef.current;
        if (host) {
          host.textContent = "";
          host.style.width = `${Math.floor(viewport.width)}px`;
          host.style.height = `${Math.floor(viewport.height)}px`;
          host.style.setProperty("--total-scale-factor", String(viewport.scale));
          host.style.setProperty("--scale-round-x", "1px");
          host.style.setProperty("--scale-round-y", "1px");
          const { TextLayer } = await import("pdfjs-dist");
          if (cancelled) return;
          const layer = new TextLayer({
            textContentSource: page.streamTextContent(),
            container: host,
            viewport,
          });
          await layer.render();
          if (cancelled) return;
          // setLayerDimensions() sizes the host with a CSS round() expression;
          // pin it to the canvas instead so the two always line up exactly.
          host.style.width = `${Math.floor(viewport.width)}px`;
          host.style.height = `${Math.floor(viewport.height)}px`;
          layerRef.current = { divs: layer.textDivs, items: layer.textContentItemsStr };
        }
        setPainted(true);
      } catch (e) {
        // A cancelled render throws RenderingCancelledException — not an error.
        if (!cancelled && !(e instanceof Error && e.name === "RenderingCancelledException")) {
          console.error(`PDF page ${pageNumber} failed to render`, e);
        }
      }
    })();

    return () => {
      cancelled = true;
      task?.cancel();
      layerRef.current = null;
      setPainted(false);
    };
  }, [doc, pageNumber, scale, rotation, near]);

  // Repaint search highlights without re-rendering the page.
  useEffect(() => {
    const layer = layerRef.current;
    if (!painted || !layer) return;
    paintMatches(layer.divs, layer.items, matches, activeMatch);
  }, [painted, matches, activeMatch]);

  return (
    <div
      ref={(el) => {
        hostRef.current = el;
        onElement(pageNumber, el);
      }}
      data-page={pageNumber}
      className="relative shrink-0 bg-white border border-ink shadow-[2px_2px_0_rgb(42_36_24_/_0.12)]"
      style={{ width: w, height: h }}
    >
      <canvas ref={canvasRef} className="block" aria-label={`Page ${pageNumber}`} />
      <div ref={textRef} className="pdf-text-layer" />
      {!painted && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-mono text-[10px] tracking-[0.18em] uppercase text-ink-mute">
            {pageNumber}
          </span>
        </div>
      )}
    </div>
  );
}

// ---- thumbnail rail ----

function Thumb({
  doc,
  pageNumber,
  active,
  onClick,
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  active: boolean;
  onClick: () => void;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let task: RenderTask | null = null;
    (async () => {
      try {
        const page = await doc.getPage(pageNumber);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: 110 / base.width });
        const canvas = ref.current;
        if (!canvas) return;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        task = page.render({ canvas, viewport });
        await task.promise;
        if (!cancelled) setDone(true);
      } catch {
        /* a cancelled thumbnail is not worth reporting */
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, pageNumber]);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex flex-col items-center gap-1 w-full py-1.5 focus-visible:outline-none ${
        active ? "" : "opacity-80 hover:opacity-100"
      }`}
      aria-current={active ? "true" : undefined}
    >
      <canvas
        ref={ref}
        className={`block bg-white border ${
          active ? "border-terracotta ring-2 ring-terracotta/30" : "border-rule group-hover:border-ink"
        }`}
        style={{ opacity: done ? 1 : 0.25 }}
      />
      <span
        className={`font-mono text-[9px] tracking-[0.14em] ${
          active ? "text-terracotta" : "text-ink-mute"
        }`}
      >
        {pageNumber}
      </span>
    </button>
  );
}

// ---- the pane ----

export default function PdfViewerPane({
  fetchBytes,
  title,
  downloadUrl,
  onDocumentLoaded,
}: {
  /** Resolves the PDF bytes. Called once — remount the pane (via `key`) to reload. */
  fetchBytes: () => Promise<ArrayBuffer>;
  title: string;
  /** Direct URL used by "Download original", when the file has one. */
  downloadUrl?: string | null;
  /** Reports page count so the parent can show it in the header. */
  onDocumentLoaded?: (info: { pages: number }) => void;
}) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [geoms, setGeoms] = useState<PageGeom[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [zoom, setZoom] = useState<Zoom>("fit-width");
  const [rotation, setRotation] = useState(0);
  const [page, setPage] = useState(1);
  const [pageDraft, setPageDraft] = useState("1");
  const [side, setSide] = useState<Side>(null);
  const [outline, setOutline] = useState<OutlineItem[] | null>(null);

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<TextMatch[]>([]);
  const [activeMatch, setActiveMatch] = useState(-1);
  const [searching, setSearching] = useState(false);

  const [box, setBox] = useState({ w: 0, h: 0 });
  const [printing, setPrinting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pageEls = useRef(new Map<number, HTMLDivElement>());
  const bytesRef = useRef<Uint8Array | null>(null);
  const textCache = useRef(new Map<number, string[]>());
  const searchRunRef = useRef(0);

  const numPages = doc?.numPages ?? 0;

  // ---- load ----
  useEffect(() => {
    let cancelled = false;
    let opened: PDFDocumentProxy | null = null;

    (async () => {
      try {
        const buf = await fetchBytes();
        if (cancelled) return;
        bytesRef.current = new Uint8Array(buf.slice(0));
        const next = await openPdf(bytesRef.current);
        if (cancelled) {
          void next.loadingTask.destroy();
          return;
        }
        opened = next;

        const pages = await Promise.all(
          Array.from({ length: next.numPages }, (_, i) => next.getPage(i + 1)),
        );
        if (cancelled) return;
        setGeoms(
          pages.map((p) => {
            const vp = p.getViewport({ scale: 1, rotation: 0 });
            return { rotate: p.rotate, width: vp.width, height: vp.height };
          }),
        );
        setDoc(next);
        onDocumentLoaded?.({ pages: next.numPages });

        const raw = await next.getOutline();
        if (cancelled || !raw) return;
        const flat: OutlineItem[] = [];
        const walk = (nodes: typeof raw, depth: number) => {
          for (const n of nodes) {
            flat.push({ title: n.title, dest: n.dest, depth });
            if (n.items?.length) walk(n.items, depth + 1);
          }
        };
        walk(raw, 0);
        setOutline(flat.length ? flat : null);
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : String(e);
          setError(
            /password/i.test(msg)
              ? "This PDF is password-protected — the portal can't open encrypted files."
              : msg,
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      void opened?.loadingTask.destroy();
    };
    // `fetchBytes` and `onDocumentLoaded` are inline closures at every call
    // site; re-running on their identity would refetch the document on every
    // parent render. Callers remount the pane (a changed `key`) to reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- container size, for the fit modes ----
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setBox({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [doc]);

  const scale = useMemo(() => {
    if (typeof zoom === "number") return zoom;
    if (!geoms.length || !box.w) return 1;
    let maxW = 0;
    let maxH = 0;
    for (const g of geoms) {
      const rot = ((g.rotate + rotation) % 180 + 180) % 180 === 90;
      maxW = Math.max(maxW, rot ? g.height : g.width);
      maxH = Math.max(maxH, rot ? g.width : g.height);
    }
    const byWidth = (box.w - GUTTER * 2) / maxW;
    if (zoom === "fit-width") return clamp(byWidth, 0.1, 6);
    const byHeight = (box.h - GUTTER * 2) / maxH;
    return clamp(Math.min(byWidth, byHeight), 0.1, 6);
  }, [zoom, geoms, box, rotation]);

  // ---- current page from scroll position ----
  // "Current" is the page showing the most of itself, not the one under some
  // fixed probe line: after jumping to a search hit the viewport is centred on
  // that hit, and a probe would often still sit on the page above it.
  // offsetTop/offsetHeight are relative to the scroll container (it is
  // `position: relative`), so they compare directly against scrollTop.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !numPages) return;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const top = el.scrollTop;
        const bottom = top + el.clientHeight;
        let best = 1;
        let bestVisible = -1;
        for (let i = 1; i <= numPages; i++) {
          const pe = pageEls.current.get(i);
          if (!pe) continue;
          const pTop = pe.offsetTop;
          if (pTop > bottom) break;
          const visible = Math.min(pTop + pe.offsetHeight, bottom) - Math.max(pTop, top);
          if (visible > bestVisible) {
            bestVisible = visible;
            best = i;
          }
        }
        setPage(best);
        setPageDraft(String(best));
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [numPages]);

  const scrollToPage = useCallback((n: number) => {
    const el = scrollRef.current;
    const target = pageEls.current.get(n);
    if (!el || !target) return;
    el.scrollTo({ top: target.offsetTop - GUTTER / 2, behavior: "smooth" });
    setPage(n);
    setPageDraft(String(n));
  }, []);

  const registerPageEl = useCallback((n: number, el: HTMLDivElement | null) => {
    if (el) pageEls.current.set(n, el);
    else pageEls.current.delete(n);
  }, []);

  // ---- zoom ----
  const stepZoom = useCallback(
    (dir: 1 | -1) => {
      setZoom((prev) => {
        const current = typeof prev === "number" ? prev : scale;
        if (dir > 0) return ZOOM_STEPS.find((z) => z > current + 1e-4) ?? ZOOM_STEPS.at(-1)!;
        return [...ZOOM_STEPS].reverse().find((z) => z < current - 1e-4) ?? ZOOM_STEPS[0];
      });
    },
    [scale],
  );

  // ---- search ----
  useEffect(() => {
    const q = query.trim();
    const run = ++searchRunRef.current;
    const timer = setTimeout(() => {
      if (!doc || q.length < 2) {
        setMatches([]);
        setActiveMatch(-1);
        setSearching(false);
        return;
      }
      setSearching(true);
      (async () => {
        const found: TextMatch[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          if (searchRunRef.current !== run) return;
          let items = textCache.current.get(i);
          if (!items) {
            const page_ = await doc.getPage(i);
            const tc = await page_.getTextContent();
            items = tc.items.map((it) => ("str" in it ? it.str : null)).filter(
              (s): s is string => s !== null,
            );
            textCache.current.set(i, items);
          }
          found.push(...findMatches(items, q, i - 1));
        }
        if (searchRunRef.current !== run) return;
        setMatches(found);
        setActiveMatch(found.length ? 0 : -1);
        setSearching(false);
      })().catch(() => {
        if (searchRunRef.current === run) setSearching(false);
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [doc, query]);

  // Jump to the active hit.
  useEffect(() => {
    const m = matches[activeMatch];
    if (!m) return;
    scrollToPage(m.page + 1);
    let tries = 0;
    let raf = 0;
    const seek = () => {
      const pe = pageEls.current.get(m.page + 1);
      const hit = pe?.querySelector(".pdf-hl-active");
      if (hit) {
        hit.scrollIntoView({ block: "center", behavior: "smooth" });
        return;
      }
      if (tries++ < 90) raf = requestAnimationFrame(seek);
    };
    raf = requestAnimationFrame(seek);
    return () => cancelAnimationFrame(raf);
  }, [activeMatch, matches, scrollToPage]);

  const matchesByPage = useMemo(() => {
    const map = new Map<number, { list: TextMatch[]; activeLocal: number }>();
    matches.forEach((m, i) => {
      const entry = map.get(m.page) ?? { list: [], activeLocal: -1 };
      if (i === activeMatch) entry.activeLocal = entry.list.length;
      entry.list.push(m);
      map.set(m.page, entry);
    });
    return map;
  }, [matches, activeMatch]);

  const stepMatch = useCallback(
    (dir: 1 | -1) => {
      if (!matches.length) return;
      setActiveMatch((i) => (i + dir + matches.length) % matches.length);
    },
    [matches.length],
  );

  // ---- destinations (outline) ----
  const goToDest = useCallback(
    async (dest: OutlineItem["dest"]) => {
      if (!doc || !dest) return;
      try {
        const resolved = typeof dest === "string" ? await doc.getDestination(dest) : dest;
        if (!resolved?.length) return;
        const index = await doc.getPageIndex(resolved[0] as Parameters<typeof doc.getPageIndex>[0]);
        scrollToPage(index + 1);
      } catch {
        /* a broken outline entry just does nothing */
      }
    },
    [doc, scrollToPage],
  );

  // ---- download / print ----
  const download = useCallback(() => {
    if (downloadUrl) {
      window.open(downloadUrl, "_blank", "noopener,noreferrer");
      return;
    }
    if (bytesRef.current) downloadBytes(bytesRef.current, pdfFilename(title));
  }, [downloadUrl, title]);

  const print = useCallback(async () => {
    if (!doc || printing) return;
    if (doc.numPages > PRINT_PAGE_LIMIT) {
      setNotice(
        `Printing is limited to ${PRINT_PAGE_LIMIT} pages — download the file and print it from there.`,
      );
      return;
    }
    setPrinting(true);
    setNotice(null);
    try {
      // Rasterise every page, then hand a plain image document to the browser's
      // print dialog. Slower than a native PDF print, but it prints exactly what
      // the viewer shows and needs no PDF plugin.
      const imgs: { src: string; w: number; h: number }[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const p = await doc.getPage(i);
        const vp = p.getViewport({ scale: 2, rotation: (p.rotate + rotation) % 360 });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        await p.render({ canvas, viewport: vp }).promise;
        imgs.push({ src: canvas.toDataURL("image/png"), w: vp.width, h: vp.height });
      }
      const win = window.open("", "_blank");
      if (!win) {
        setNotice("The print window was blocked — allow pop-ups for this site.");
        return;
      }
      const body = imgs
        .map(
          (im) =>
            `<div class="p" style="width:${im.w}px;height:${im.h}px"><img src="${im.src}" width="${im.w}" height="${im.h}" alt=""></div>`,
        )
        .join("");
      win.document.write(
        `<!doctype html><html><head><meta charset="utf-8"><title>${title.replace(/[<&]/g, "")}</title>` +
          `<style>@page{margin:0}html,body{margin:0;padding:0;background:#fff}` +
          `.p{page-break-after:always;break-after:page;display:flex;align-items:center;justify-content:center}` +
          `.p:last-child{page-break-after:auto;break-after:auto}img{max-width:100%;height:auto}</style>` +
          `</head><body>${body}<script>window.onload=function(){window.focus();window.print();}<\/script></body></html>`,
      );
      win.document.close();
    } catch (e) {
      setNotice(`Print failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPrinting(false);
    }
  }, [doc, printing, rotation, title]);

  // ---- keyboard ----
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing =
        !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (typing) {
        if (e.key === "Enter" && target?.dataset.pdfSearch === "1") {
          e.preventDefault();
          stepMatch(e.shiftKey ? -1 : 1);
        }
        return;
      }
      switch (e.key) {
        case "ArrowRight":
        case "PageDown":
          e.preventDefault();
          scrollToPage(Math.min(page + 1, numPages));
          break;
        case "ArrowLeft":
        case "PageUp":
          e.preventDefault();
          scrollToPage(Math.max(page - 1, 1));
          break;
        case "Home":
          e.preventDefault();
          scrollToPage(1);
          break;
        case "End":
          e.preventDefault();
          scrollToPage(numPages);
          break;
        case "+":
        case "=":
          e.preventDefault();
          stepZoom(1);
          break;
        case "-":
          e.preventDefault();
          stepZoom(-1);
          break;
        default:
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [page, numPages, scrollToPage, stepZoom, stepMatch]);

  // ---- render ----

  if (error) {
    return (
      <div className="flex items-start gap-2 text-terracotta font-mono text-[11px] tracking-[0.1em] uppercase p-6">
        <AlertCircle className="h-4 w-4 shrink-0 mt-px" /> Failed to load: {error}
      </div>
    );
  }
  if (!doc) {
    return (
      <div className="flex items-center gap-2 text-ink-fade font-mono text-[11px] tracking-[0.1em] uppercase p-6">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading document…
      </div>
    );
  }

  const zoomLabel =
    zoom === "fit-width" ? "Fit width" : zoom === "fit-page" ? "Fit page" : `${Math.round(scale * 100)}%`;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-rule bg-paper-deep/40 shrink-0 flex-wrap">
        <div className="flex items-center rounded-[1px] border border-rule overflow-hidden">
          <button
            type="button"
            onClick={() => setSide(side === "thumbs" ? null : "thumbs")}
            title="Page thumbnails"
            aria-pressed={side === "thumbs"}
            className={`h-7 w-7 flex items-center justify-center transition-colors ${
              side === "thumbs" ? "bg-ink text-paper" : "text-ink-fade hover:text-ink hover:bg-paper-light"
            }`}
          >
            <ImageIcon className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setSide(side === "outline" ? null : "outline")}
            title={outline ? "Document outline" : "This PDF has no outline"}
            aria-pressed={side === "outline"}
            disabled={!outline}
            className={`h-7 w-7 flex items-center justify-center border-l border-rule transition-colors disabled:opacity-35 ${
              side === "outline" ? "bg-ink text-paper" : "text-ink-fade hover:text-ink hover:bg-paper-light"
            }`}
          >
            <List className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Pager */}
        <div className="flex items-center gap-1 ml-1">
          <Button
            variant="ghost" size="icon"
            className="h-7 w-7 text-ink-fade hover:text-ink"
            onClick={() => scrollToPage(Math.max(page - 1, 1))}
            disabled={page <= 1}
            title="Previous page"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </Button>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(pageDraft);
              if (Number.isFinite(n)) scrollToPage(clamp(Math.round(n), 1, numPages));
            }}
            className="flex items-center gap-1"
          >
            <input
              value={pageDraft}
              onChange={(e) => setPageDraft(e.target.value)}
              onBlur={() => setPageDraft(String(page))}
              aria-label="Page number"
              className="w-10 h-7 px-1 text-center bg-vellum border border-rule rounded-[1px] font-mono text-[11px] text-ink focus:outline-none focus:border-ink"
            />
          </form>
          <span className="font-mono text-[10px] tracking-[0.12em] uppercase text-ink-mute">
            / {numPages}
          </span>
          <Button
            variant="ghost" size="icon"
            className="h-7 w-7 text-ink-fade hover:text-ink"
            onClick={() => scrollToPage(Math.min(page + 1, numPages))}
            disabled={page >= numPages}
            title="Next page"
          >
            <ArrowDownToLine className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="w-px h-5 bg-rule mx-1.5" />

        {/* Zoom */}
        <Button
          variant="ghost" size="icon"
          className="h-7 w-7 text-ink-fade hover:text-ink"
          onClick={() => stepZoom(-1)}
          title="Zoom out (−)"
        >
          <Minus className="h-3.5 w-3.5" />
        </Button>
        <button
          type="button"
          onClick={() => setZoom(zoom === "fit-width" ? "fit-page" : zoom === "fit-page" ? 1 : "fit-width")}
          title="Cycle fit width / fit page / 100%"
          className="h-7 min-w-[5.5rem] px-2 rounded-[1px] border border-rule bg-vellum font-mono text-[10px] tracking-[0.12em] uppercase text-ink-fade hover:text-ink hover:border-ink transition-colors"
        >
          {zoomLabel}
        </button>
        <Button
          variant="ghost" size="icon"
          className="h-7 w-7 text-ink-fade hover:text-ink"
          onClick={() => stepZoom(1)}
          title="Zoom in (+)"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost" size="icon"
          className="h-7 w-7 text-ink-fade hover:text-ink"
          onClick={() => setZoom("fit-page")}
          title="Fit whole page"
        >
          <Maximize className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost" size="icon"
          className="h-7 w-7 text-ink-fade hover:text-ink"
          onClick={() => setRotation((r) => (r + 90) % 360)}
          title="Rotate view 90°"
        >
          <RotateCw className="h-3.5 w-3.5" />
        </Button>

        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost" size="icon"
            className={`h-7 w-7 ${searchOpen ? "text-ink" : "text-ink-fade"} hover:text-ink`}
            onClick={() => setSearchOpen((v) => !v)}
            title="Find in document (⌘F)"
            aria-pressed={searchOpen}
          >
            <Search className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost" size="icon"
            className="h-7 w-7 text-ink-fade hover:text-ink"
            onClick={() => void print()}
            disabled={printing}
            title="Print"
          >
            {printing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
          </Button>
          <Button
            variant="ghost" size="icon"
            className="h-7 w-7 text-ink-fade hover:text-ink"
            onClick={download}
            title="Download"
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Find bar */}
      {searchOpen && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-rule bg-vellum shrink-0">
          <Search className="h-3.5 w-3.5 text-ink-mute shrink-0" />
          <input
            autoFocus
            data-pdf-search="1"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find in document…"
            className="flex-1 min-w-0 h-7 px-2 bg-paper-light border border-rule rounded-[1px] font-mono text-[11px] text-ink placeholder-ink-mute/50 focus:outline-none focus:border-ink"
          />
          <span className="font-mono text-[10px] tracking-[0.12em] uppercase text-ink-mute whitespace-nowrap">
            {searching
              ? "Searching…"
              : query.trim().length < 2
                ? "2+ characters"
                : matches.length
                  ? `${activeMatch + 1} / ${matches.length}`
                  : "No matches"}
          </span>
          <Button
            variant="ghost" size="icon"
            className="h-7 w-7 text-ink-fade hover:text-ink"
            onClick={() => stepMatch(-1)}
            disabled={!matches.length}
            title="Previous match (⇧Enter)"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost" size="icon"
            className="h-7 w-7 text-ink-fade hover:text-ink"
            onClick={() => stepMatch(1)}
            disabled={!matches.length}
            title="Next match (Enter)"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost" size="icon"
            className="h-7 w-7 text-ink-fade hover:text-ink"
            onClick={() => {
              setSearchOpen(false);
              setQuery("");
            }}
            title="Close find bar"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {notice && (
        <div className="flex items-start gap-2 px-3 py-2 border-b border-rule bg-paper-deep/60 shrink-0 font-mono text-[10px] tracking-[0.1em] uppercase text-terracotta">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-px" />
          <span className="flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="shrink-0 hover:text-ink">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Body */}
      <div className="flex flex-1 min-h-0">
        {side === "thumbs" && (
          <div className="w-[9.5rem] shrink-0 border-r border-rule bg-paper-deep/30 overflow-y-auto px-3 py-2">
            {Array.from({ length: numPages }, (_, i) => (
              <Thumb
                key={i + 1}
                doc={doc}
                pageNumber={i + 1}
                active={page === i + 1}
                onClick={() => scrollToPage(i + 1)}
              />
            ))}
          </div>
        )}
        {side === "outline" && outline && (
          <div className="w-64 shrink-0 border-r border-rule bg-paper-deep/30 overflow-y-auto py-2">
            {outline.map((item, i) => (
              <button
                key={`${i}-${item.title}`}
                type="button"
                onClick={() => void goToDest(item.dest)}
                style={{ paddingLeft: 12 + item.depth * 12 }}
                className="block w-full text-left pr-3 py-1.5 font-serif text-[13px] leading-tight text-ink-fade hover:bg-vellum hover:text-ink"
                title={item.title}
              >
                {item.title}
              </button>
            ))}
          </div>
        )}

        {/* `relative` makes each page's offsetTop a content coordinate inside this
            scroller, which both the pager and scrollToPage rely on. */}
        <div ref={scrollRef} className="relative flex-1 min-w-0 overflow-auto bg-paper-deep/60">
          <div className="flex flex-col items-center" style={{ gap: GUTTER, padding: GUTTER }}>
            {geoms.map((geom, i) => {
              const entry = matchesByPage.get(i);
              return (
                <PdfPage
                  key={i + 1}
                  doc={doc}
                  pageNumber={i + 1}
                  geom={geom}
                  scale={scale}
                  rotation={rotation}
                  scrollRef={scrollRef}
                  matches={entry?.list ?? []}
                  activeMatch={entry?.activeLocal ?? -1}
                  onElement={registerPageEl}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
