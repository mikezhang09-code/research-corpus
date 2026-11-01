"use client";

// Mark-up surface for the PDF editor: type a note, drag a highlight, draw
// freehand, or edit an existing line of text over a rendered page. Annotations
// are held here as normalised geometry and only become page content when the
// editor flattens them (see `flattenAnnotations` in lib/pdf-edit).
//
// "Edit text" is cover-and-redraw (see lib/pdf-text): the old line is painted
// over in its own background colour and the new text drawn on its baseline.
//
// Positions are stored as fractions of the page *as displayed*, with y
// measured from the top, so they survive zoom changes and map cleanly onto
// pages that carry a /Rotate.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import {
  Highlighter, Loader2, MousePointer2, PenLine, Replace, Trash2, Type,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  COVER_PAD_EM, fitSize, type AnnotationsByPage, type PdfAnnotation,
} from "@/lib/pdf-edit";
import {
  FONT_STACK, extractTextRuns, measureTextPx, sampleRunColors, type TextRun,
} from "@/lib/pdf-text";
import { RenderPriority, acquireRenderSlot, isCancellation, outputScale } from "@/lib/pdf";

type Tool = "select" | "text" | "highlight" | "ink" | "replace";
type ReplaceMark = Extract<PdfAnnotation, { kind: "replace" }>;

const COLORS = [
  { hex: "#b85c38", label: "Terracotta" },
  { hex: "#b8893a", label: "Ochre" },
  { hex: "#6b7a52", label: "Sage" },
  { hex: "#4a6e8e", label: "Sky" },
  { hex: "#2a2418", label: "Ink" },
];

/** Helvetica's ascent as a fraction of the font size — used to place the
 *  preview box from the stored baseline. */
const ASCENT = 0.76;

/**
 * A pending text edit, drawn the way `flattenAnnotations` will draw it: the
 * run's box filled with its sampled background, and the new text — shrunk to
 * fit if longer — turned to match the page's rotation.
 */
function ReplacePreview({
  a,
  view,
  ring,
  interactive,
  onPick,
}: {
  a: ReplaceMark;
  view: { w: number; h: number; scale: number };
  ring: string;
  interactive: boolean;
  onPick: (e: React.MouseEvent) => void;
}) {
  const pad = a.size * COVER_PAD_EM * view.scale;
  const across = a.rotate % 180 === 0;
  const lenPx = across ? a.box.w * view.w : a.box.h * view.h;
  const thickPx = across ? a.box.h * view.h : a.box.w * view.w;
  const basePx = a.size * view.scale;
  const text = a.text.replace(/\s+$/, "");
  const fontPx = text ? fitSize(basePx, measureTextPx(text, a.fontKind, basePx), lenPx + pad) : basePx;
  return (
    <>
      <div
        onMouseDown={onPick}
        className={`absolute ${ring}`}
        style={{
          left: a.box.x * view.w - pad,
          top: a.box.y * view.h - pad,
          width: a.box.w * view.w + pad * 2,
          height: a.box.h * view.h + pad * 2,
          background: a.background,
          pointerEvents: interactive ? "auto" : "none",
        }}
      />
      {text && (
        <div
          className="absolute pointer-events-none"
          style={{ left: (a.box.x + a.box.w / 2) * view.w, top: (a.box.y + a.box.h / 2) * view.h }}
        >
          <div
            className="absolute flex items-center whitespace-pre"
            style={{
              left: -lenPx / 2,
              top: -thickPx / 2,
              width: lenPx,
              height: thickPx,
              transform: a.rotate ? `rotate(${a.rotate}deg)` : undefined,
              color: a.color,
              fontFamily: FONT_STACK[a.fontKind],
              fontSize: fontPx,
              lineHeight: 1,
            }}
          >
            {text}
          </div>
        </div>
      )}
    </>
  );
}

export default function PdfAnnotatePane({
  doc,
  pageIndex,
  onPageIndex,
  annotations,
  onChange,
}: {
  doc: PDFDocumentProxy;
  /** 0-based page being marked up. */
  pageIndex: number;
  onPageIndex: (index: number) => void;
  annotations: AnnotationsByPage;
  onChange: (next: AnnotationsByPage) => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Rendered page box plus the pdf.js scale that produced it — the scale
  // converts stored point sizes (font size, stroke width) into screen px.
  const [size, setSize] = useState<{ w: number; h: number; scale: number } | null>(null);
  const [boxWidth, setBoxWidth] = useState(0);

  const [tool, setTool] = useState<Tool>("replace");
  const [color, setColor] = useState(COLORS[0].hex);
  const [fontSize, setFontSize] = useState(14);
  const [stroke, setStroke] = useState(2);
  const [selected, setSelected] = useState<number | null>(null);

  // In-flight gestures.
  const [rectDraft, setRectDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [inkDraft, setInkDraft] = useState<[number, number][] | null>(null);
  const [textDraft, setTextDraft] = useState<{ x: number; y: number; value: string } | null>(null);
  // Blur fires before click, so committing a text box by clicking elsewhere
  // would otherwise immediately open a new one at that spot.
  const committedAt = useRef(0);

  // "Edit text": the page's runs, and the one being edited.
  const [runsFor, setRunsFor] = useState<{
    doc: PDFDocumentProxy;
    page: number;
    runs: TextRun[];
  } | null>(null);
  const runs = runsFor && runsFor.doc === doc && runsFor.page === pageIndex ? runsFor.runs : null;
  const [editing, setEditing] = useState<{ run: TextRun; value: string } | null>(null);
  const activeEdit = editing && editing.run.key.startsWith(`${pageIndex}:`) ? editing : null;
  const editDone = useRef(false);

  const pageAnnotations = useMemo(() => annotations[pageIndex] ?? [], [annotations, pageIndex]);

  // Available width, for fit-width rendering.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxWidth(el.clientWidth));
    ro.observe(el);
    setBoxWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Render the page.
  useEffect(() => {
    if (!boxWidth) return;
    const ac = new AbortController();
    let task: RenderTask | null = null;
    (async () => {
      let release: (() => void) | null = null;
      try {
        release = await acquireRenderSlot(RenderPriority.page, ac.signal);
        const page = await doc.getPage(pageIndex + 1);
        if (ac.signal.aborted) return;
        const base = page.getViewport({ scale: 1, rotation: page.rotate });
        const scale = Math.max(0.2, Math.min((boxWidth - 48) / base.width, 3));
        const viewport = page.getViewport({ scale, rotation: page.rotate });
        const canvas = canvasRef.current;
        if (!canvas) return;
        const out = outputScale(viewport.width, viewport.height);
        canvas.width = Math.floor(viewport.width * out);
        canvas.height = Math.floor(viewport.height * out);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        task = page.render({
          canvas,
          viewport,
          transform: out === 1 ? undefined : [out, 0, 0, out, 0, 0],
        });
        await task.promise;
        if (!ac.signal.aborted) {
          setSize({ w: Math.floor(viewport.width), h: Math.floor(viewport.height), scale });
        }
      } catch (e) {
        if (!isCancellation(e)) console.error("PDF annotate page failed to render", e);
      } finally {
        release?.();
      }
    })();
    return () => {
      ac.abort();
      task?.cancel();
    };
  }, [doc, pageIndex, boxWidth]);

  // Read the page's text runs when the Edit-text tool needs them.
  useEffect(() => {
    if (tool !== "replace" || runs) return;
    let cancelled = false;
    extractTextRuns(doc, pageIndex + 1)
      .then((r) => {
        if (!cancelled) setRunsFor({ doc, page: pageIndex, runs: r });
      })
      .catch(() => {
        if (!cancelled) setRunsFor({ doc, page: pageIndex, runs: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [doc, pageIndex, tool, runs]);

  // ---- geometry helpers ----

  const toNorm = useCallback(
    (e: React.PointerEvent | React.MouseEvent): [number, number] => {
      const el = e.currentTarget as HTMLElement;
      const r = el.getBoundingClientRect();
      return [
        Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
        Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
      ];
    },
    [],
  );

  const setPageAnnotations = useCallback(
    (next: PdfAnnotation[]) => {
      onChange({ ...annotations, [pageIndex]: next });
    },
    [annotations, onChange, pageIndex],
  );

  const add = useCallback(
    (a: PdfAnnotation) => setPageAnnotations([...pageAnnotations, a]),
    [pageAnnotations, setPageAnnotations],
  );

  const removeSelected = useCallback(() => {
    if (selected === null) return;
    setPageAnnotations(pageAnnotations.filter((_, i) => i !== selected));
    setSelected(null);
  }, [selected, pageAnnotations, setPageAnnotations]);

  // ---- gestures ----

  // The text box is opened on `click`, not `pointerdown`: mounting an
  // autofocused textarea during pointerdown only to have mousedown's default
  // action move focus straight back off it would close the box immediately.
  function onClick(e: React.MouseEvent<HTMLDivElement>) {
    if (tool !== "text" || textDraft) return;
    if (Date.now() - committedAt.current < 300) return;
    const [x, y] = toNorm(e);
    setSelected(null);
    setTextDraft({ x, y, value: "" });
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (textDraft) return; // let the open text box commit first
    if (tool === "text") return; // handled in onClick
    const [x, y] = toNorm(e);
    if (tool === "highlight") {
      e.currentTarget.setPointerCapture(e.pointerId);
      setRectDraft({ x0: x, y0: y, x1: x, y1: y });
      return;
    }
    if (tool === "ink") {
      e.currentTarget.setPointerCapture(e.pointerId);
      setInkDraft([[x, y]]);
      return;
    }
    setSelected(null);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (rectDraft) {
      const [x, y] = toNorm(e);
      setRectDraft({ ...rectDraft, x1: x, y1: y });
    } else if (inkDraft) {
      const [x, y] = toNorm(e);
      const last = inkDraft[inkDraft.length - 1];
      // Thin the stream a little so a long stroke doesn't bloat the save.
      if (Math.hypot(x - last[0], y - last[1]) > 0.002) setInkDraft([...inkDraft, [x, y]]);
    }
  }

  function onPointerUp() {
    if (rectDraft) {
      const x = Math.min(rectDraft.x0, rectDraft.x1);
      const y = Math.min(rectDraft.y0, rectDraft.y1);
      const w = Math.abs(rectDraft.x1 - rectDraft.x0);
      const h = Math.abs(rectDraft.y1 - rectDraft.y0);
      setRectDraft(null);
      if (w > 0.004 && h > 0.004) add({ kind: "highlight", x, y, w, h, color });
    }
    if (inkDraft) {
      const points = inkDraft;
      setInkDraft(null);
      if (points.length > 1) add({ kind: "ink", points, color, width: stroke });
    }
  }

  function openRun(run: TextRun) {
    const pending = pageAnnotations.find(
      (a): a is ReplaceMark => a.kind === "replace" && a.runKey === run.key,
    );
    editDone.current = false;
    setSelected(null);
    setEditing({ run, value: pending ? pending.text : run.text });
  }

  function commitEdit() {
    if (!activeEdit || editDone.current) return;
    editDone.current = true;
    const { run, value } = activeEdit;
    setEditing(null);
    const others = pageAnnotations.filter((a) => !(a.kind === "replace" && a.runKey === run.key));
    if (value === run.text) {
      // Back to the original: drop any pending edit of this run.
      if (others.length !== pageAnnotations.length) setPageAnnotations(others);
      return;
    }
    const canvas = canvasRef.current;
    const { background, ink } = canvas
      ? sampleRunColors(canvas, run.box)
      : { background: "#ffffff", ink: "#000000" };
    setPageAnnotations([
      ...others,
      {
        kind: "replace",
        runKey: run.key,
        original: run.text,
        text: value,
        fontKind: run.kind,
        size: run.size,
        color: ink,
        background,
        box: run.box,
        rotate: run.rotate,
        pdf: run.pdf,
      },
    ]);
  }

  function cancelEdit() {
    editDone.current = true;
    setEditing(null);
  }

  function commitText() {
    if (!textDraft) return;
    const { x, y, value } = textDraft;
    committedAt.current = Date.now();
    setTextDraft(null);
    if (value.trim()) add({ kind: "text", x, y, size: fontSize, color, text: value });
  }

  // Delete the selected mark with the keyboard.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selected !== null) {
        e.preventDefault();
        removeSelected();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, removeSelected]);

  const cursor =
    tool === "text" ? "text" : tool === "select" || tool === "replace" ? "default" : "crosshair";
  const total = Object.values(annotations).reduce((n, list) => n + (list?.length ?? 0), 0);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Tools */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-rule bg-paper-deep/40 shrink-0 flex-wrap">
        <div className="flex items-center rounded-[1px] border border-rule overflow-hidden">
          {(
            [
              ["select", MousePointer2, "Select"],
              ["replace", Replace, "Edit text"],
              ["text", Type, "Text"],
              ["highlight", Highlighter, "Highlight"],
              ["ink", PenLine, "Draw"],
            ] as const
          ).map(([key, Icon, label], i) => (
            <button
              key={key}
              type="button"
              onClick={() => setTool(key)}
              title={label}
              aria-pressed={tool === key}
              className={`h-7 w-8 flex items-center justify-center transition-colors ${i > 0 ? "border-l border-rule" : ""} ${
                tool === key ? "bg-ink text-paper" : "text-ink-fade hover:text-ink hover:bg-paper-light"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 ml-1">
          {COLORS.map((c) => (
            <button
              key={c.hex}
              type="button"
              onClick={() => setColor(c.hex)}
              title={c.label}
              aria-pressed={color === c.hex}
              className={`h-5 w-5 rounded-[1px] border transition-transform ${
                color === c.hex ? "border-ink scale-110" : "border-rule"
              }`}
              style={{ background: c.hex }}
            />
          ))}
        </div>

        {tool === "replace" && (
          <span className="ml-2 font-mono text-[10px] tracking-[0.1em] uppercase text-ink-fade">
            {runs === null
              ? "Reading text…"
              : runs.length
                ? "Click a line to change it · Enter to keep · Esc to cancel"
                : "No editable text on this page (scanned pages have none)"}
          </span>
        )}
        {tool === "text" && (
          <label className="flex items-center gap-1.5 ml-2 font-mono text-[10px] tracking-[0.12em] uppercase text-ink-fade">
            Size
            <input
              type="number"
              min={6}
              max={72}
              value={fontSize}
              onChange={(e) => setFontSize(Math.max(6, Math.min(72, Number(e.target.value) || 14)))}
              className="w-12 h-7 px-1 text-center bg-vellum border border-rule rounded-[1px] font-mono text-[11px] text-ink focus:outline-none focus:border-ink"
            />
          </label>
        )}
        {tool === "ink" && (
          <label className="flex items-center gap-1.5 ml-2 font-mono text-[10px] tracking-[0.12em] uppercase text-ink-fade">
            Width
            <input
              type="number"
              min={1}
              max={12}
              value={stroke}
              onChange={(e) => setStroke(Math.max(1, Math.min(12, Number(e.target.value) || 2)))}
              className="w-12 h-7 px-1 text-center bg-vellum border border-rule rounded-[1px] font-mono text-[11px] text-ink focus:outline-none focus:border-ink"
            />
          </label>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 rounded-[1px] text-ink-fade hover:text-terracotta font-mono text-[10px] tracking-[0.12em] uppercase"
            onClick={removeSelected}
            disabled={selected === null}
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete mark
          </Button>
          <span className="font-mono text-[10px] tracking-[0.12em] uppercase text-ink-mute whitespace-nowrap">
            {total} pending
          </span>
        </div>
      </div>

      {/* Page picker */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-rule bg-vellum shrink-0 overflow-x-auto">
        <span className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-mute mr-1 shrink-0">Page</span>
        {Array.from({ length: doc.numPages }, (_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onPageIndex(i)}
            className={`shrink-0 min-w-7 h-6 px-1.5 rounded-[1px] border font-mono text-[10px] transition-colors ${
              i === pageIndex
                ? "bg-ink text-paper border-ink"
                : (annotations[i]?.length ?? 0) > 0
                  ? "border-terracotta text-terracotta hover:bg-paper-light"
                  : "border-rule text-ink-fade hover:text-ink hover:bg-paper-light"
            }`}
          >
            {i + 1}
          </button>
        ))}
      </div>

      {/* Canvas + overlay */}
      <div ref={wrapRef} className="flex-1 min-h-0 overflow-auto bg-paper-deep/60 p-6">
        <div
          className="relative mx-auto bg-white border border-ink shadow-[2px_2px_0_rgb(42_36_24_/_0.12)]"
          style={size ? { width: size.w, height: size.h } : undefined}
        >
          <canvas ref={canvasRef} className="block" />
          {!size && (
            <div className="flex items-center gap-2 text-ink-fade font-mono text-[11px] tracking-[0.1em] uppercase p-6">
              <Loader2 className="h-4 w-4 animate-spin" /> Rendering page…
            </div>
          )}
          {size && (
            <div
              className="absolute inset-0"
              style={{ cursor }}
              onClick={onClick}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {pageAnnotations.map((a, i) => {
                const isSel = selected === i;
                const ring = isSel ? "outline outline-2 outline-offset-1 outline-terracotta" : "";
                const pick = (e: React.MouseEvent) => {
                  if (tool !== "select") return;
                  e.stopPropagation();
                  setSelected(i);
                };
                if (a.kind === "highlight") {
                  return (
                    <div
                      key={i}
                      onMouseDown={pick}
                      className={`absolute ${ring}`}
                      style={{
                        left: `${a.x * 100}%`,
                        top: `${a.y * 100}%`,
                        width: `${a.w * 100}%`,
                        height: `${a.h * 100}%`,
                        background: a.color,
                        opacity: 0.35,
                        pointerEvents: tool === "select" ? "auto" : "none",
                      }}
                    />
                  );
                }
                if (a.kind === "replace") {
                  return (
                    <ReplacePreview
                      key={i}
                      a={a}
                      view={size}
                      ring={ring}
                      interactive={tool === "select"}
                      onPick={pick}
                    />
                  );
                }
                if (a.kind === "ink") {
                  return (
                    <svg
                      key={i}
                      onMouseDown={pick}
                      className={`absolute inset-0 w-full h-full ${ring}`}
                      style={{ pointerEvents: tool === "select" ? "auto" : "none" }}
                      viewBox="0 0 1 1"
                      preserveAspectRatio="none"
                    >
                      <polyline
                        points={a.points.map(([x, y]) => `${x},${y}`).join(" ")}
                        fill="none"
                        stroke={a.color}
                        strokeWidth={a.width * size.scale}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke"
                      />
                    </svg>
                  );
                }
                return (
                  <div
                    key={i}
                    onMouseDown={pick}
                    className={`absolute whitespace-pre ${ring}`}
                    style={{
                      left: `${a.x * 100}%`,
                      top: a.y * size.h - a.size * size.scale * ASCENT,
                      color: a.color,
                      fontFamily: "Helvetica, Arial, sans-serif",
                      fontSize: a.size * size.scale,
                      lineHeight: 1.2,
                      pointerEvents: tool === "select" ? "auto" : "none",
                    }}
                  >
                    {a.text}
                  </div>
                );
              })}

              {/* Edit text: every run on the page is a click target. */}
              {tool === "replace" &&
                runs?.map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    title={r.text}
                    aria-label={`Edit "${r.text}"`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      openRun(r);
                    }}
                    className={`absolute rounded-[1px] transition-colors hover:bg-sky/15 hover:outline hover:outline-1 hover:outline-sky ${
                      activeEdit?.run.key === r.key ? "outline outline-2 outline-terracotta" : ""
                    }`}
                    style={{
                      left: `${r.box.x * 100}%`,
                      top: `${r.box.y * 100}%`,
                      width: `${r.box.w * 100}%`,
                      height: `${r.box.h * 100}%`,
                      cursor: "text",
                    }}
                  />
                ))}
              {activeEdit && (
                <input
                  autoFocus
                  value={activeEdit.value}
                  onChange={(e) => setEditing({ run: activeEdit.run, value: e.target.value })}
                  onBlur={commitEdit}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitEdit();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      e.stopPropagation();
                      cancelEdit();
                    }
                  }}
                  className="absolute z-20 bg-vellum border border-ink rounded-[1px] px-1 text-ink shadow-[2px_2px_0_rgb(42_36_24_/_0.18)] focus:outline-none"
                  style={{
                    left: `${activeEdit.run.box.x * 100}%`,
                    top: activeEdit.run.box.y * size.h - 3,
                    width: Math.max(
                      activeEdit.run.box.w * size.w + 28,
                      measureTextPx(activeEdit.value, activeEdit.run.kind, activeEdit.run.size * size.scale) + 28,
                      140,
                    ),
                    height: Math.max(activeEdit.run.box.h * size.h + 6, 24),
                    fontFamily: FONT_STACK[activeEdit.run.kind],
                    fontSize: Math.max(activeEdit.run.size * size.scale, 11),
                  }}
                />
              )}

              {/* Live drafts */}
              {rectDraft && (
                <div
                  className="absolute border border-dashed border-ink"
                  style={{
                    left: `${Math.min(rectDraft.x0, rectDraft.x1) * 100}%`,
                    top: `${Math.min(rectDraft.y0, rectDraft.y1) * 100}%`,
                    width: `${Math.abs(rectDraft.x1 - rectDraft.x0) * 100}%`,
                    height: `${Math.abs(rectDraft.y1 - rectDraft.y0) * 100}%`,
                    background: color,
                    opacity: 0.3,
                    pointerEvents: "none",
                  }}
                />
              )}
              {inkDraft && inkDraft.length > 1 && (
                <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 1 1" preserveAspectRatio="none">
                  <polyline
                    points={inkDraft.map(([x, y]) => `${x},${y}`).join(" ")}
                    fill="none"
                    stroke={color}
                    strokeWidth={stroke * size.scale}
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
              )}
              {textDraft && (
                <textarea
                  autoFocus
                  value={textDraft.value}
                  onChange={(e) => setTextDraft({ ...textDraft, value: e.target.value })}
                  onBlur={commitText}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setTextDraft(null);
                    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      commitText();
                    }
                  }}
                  placeholder="Type, then click away. ⌘⏎ to finish."
                  className="absolute z-10 min-w-[12rem] bg-vellum/95 border border-ink rounded-[1px] px-1.5 py-1 font-sans text-ink shadow-[2px_2px_0_rgb(42_36_24_/_0.18)] focus:outline-none resize"
                  style={{
                    left: `${textDraft.x * 100}%`,
                    top: textDraft.y * size.h - fontSize * size.scale * ASCENT,
                    fontSize: fontSize * size.scale,
                    lineHeight: 1.2,
                  }}
                />
              )}
            </div>
          )}
        </div>
        <p className="mx-auto mt-3 max-w-prose text-center font-mono text-[10px] leading-relaxed tracking-[0.1em] uppercase text-ink-mute">
          Marks are flattened into the page when you apply them. Text outside Latin-1 (Chinese and other
          scripts) is drawn as an image. Edited text covers the original line — it reads as replaced,
          but search and copy still find the old words underneath.
        </p>
      </div>
    </div>
  );
}
