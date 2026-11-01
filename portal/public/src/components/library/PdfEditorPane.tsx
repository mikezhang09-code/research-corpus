"use client";

// In-app PDF editor. Three tabs over one working buffer:
//
//   Pages    — arrange, rotate, delete, duplicate, insert, merge, extract
//   Annotate — type / highlight / draw, then flatten onto the page
//   Document — title, author, subject, keywords
//
// Every operation produces a fresh set of bytes (see lib/pdf-edit), so undo is
// just a stack of buffers and the thumbnails are always rendered from exactly
// what a save would write. Saving PUTs over the same R2 object, which keeps the
// file's id, URL and category — cards and viewers stay valid.
//
// Heavy (pdf.js + pdf-lib) — always mount through `next/dynamic` with
// `ssr: false`.

import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import {
  AlertCircle, ArrowLeftToLine, ArrowRightToLine, CheckCircle2, CopyPlus, Download,
  FilePlus2, FileOutput, Loader2, Merge, RotateCcw, RotateCw, Save, Trash2, Undo2, Redo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getLibraryFileBlob, replaceLibraryFileBytes } from "@/lib/api";
import { downloadBytes, openPdf, PDF_MIME, pdfFilename, renderDpr } from "@/lib/pdf";
import {
  deletePages, duplicatePages, extractPages, flattenAnnotations, importPages,
  insertBlankPage, moveSelection, readMetadata, reorderPages, rotatePages, writeMetadata,
  type AnnotationsByPage, type PdfMetadata,
} from "@/lib/pdf-edit";
import PdfAnnotatePane from "./PdfAnnotatePane";

const UNDO_LIMIT = 20;
const EMPTY_META: PdfMetadata = {
  title: "", author: "", subject: "", keywords: "", creator: "", producer: "",
};

type Tab = "pages" | "annotate" | "document";

// ---- page thumbnail ----

function PageTile({
  doc,
  pageNumber,
  selected,
  onToggle,
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  selected: boolean;
  onToggle: (e: React.MouseEvent) => void;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let task: RenderTask | null = null;
    (async () => {
      try {
        const page = await doc.getPage(pageNumber);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1, rotation: page.rotate });
        const scale = 150 / base.width;
        const viewport = page.getViewport({ scale, rotation: page.rotate });
        const canvas = ref.current;
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
        if (!cancelled) setReady(true);
      } catch {
        /* a cancelled thumbnail needs no handling */
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
      onClick={onToggle}
      aria-pressed={selected}
      className="flex flex-col items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink rounded-[1px]"
    >
      <span
        className={`block bg-white border p-0.5 transition-colors ${
          selected ? "border-terracotta ring-2 ring-terracotta/30" : "border-rule hover:border-ink"
        }`}
      >
        <canvas ref={ref} className="block" style={{ opacity: ready ? 1 : 0.2 }} />
      </span>
      <span
        className={`font-mono text-[10px] tracking-[0.14em] uppercase ${
          selected ? "text-terracotta" : "text-ink-mute"
        }`}
      >
        {pageNumber}
      </span>
    </button>
  );
}

// ---- the pane ----

export default function PdfEditorPane({
  notebookId,
  fileId,
  title,
  onSaved,
}: {
  /** Folio id, or null for a free-form file. */
  notebookId: string | null;
  fileId: string;
  title: string;
  /** Called after a successful save so the parent can refresh its preview. */
  onSaved?: () => void;
}) {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [undo, setUndo] = useState<Uint8Array[]>([]);
  const [redo, setRedo] = useState<Uint8Array[]>([]);
  const [dirty, setDirty] = useState(false);

  const [tab, setTab] = useState<Tab>("pages");
  const [selected, setSelected] = useState<number[]>([]);
  const [annotations, setAnnotations] = useState<AnnotationsByPage>({});
  const [annotatePage, setAnnotatePage] = useState(0);
  const [meta, setMeta] = useState<PdfMetadata>(EMPTY_META);

  const [busy, setBusy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const importRef = useRef<HTMLInputElement | null>(null);
  const lastClickedRef = useRef<number | null>(null);

  const pendingMarks = Object.values(annotations).reduce((n, l) => n + (l?.length ?? 0), 0);
  const pageCount = doc?.numPages ?? 0;

  // ---- initial load ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const buf = await getLibraryFileBlob(notebookId, fileId);
        if (cancelled) return;
        setBytes(new Uint8Array(buf.slice(0)));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [notebookId, fileId]);

  // ---- keep a pdf.js handle on the working bytes (thumbnails + annotate) ----
  useEffect(() => {
    if (!bytes) return;
    let cancelled = false;
    let opened: PDFDocumentProxy | null = null;
    (async () => {
      try {
        const next = await openPdf(bytes);
        if (cancelled) {
          void next.loadingTask.destroy();
          return;
        }
        opened = next;
        setDoc(next);
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : String(e);
          setError(
            /password/i.test(msg)
              ? "This PDF is password-protected — the portal can't edit encrypted files."
              : msg,
          );
        }
      }
    })();
    return () => {
      cancelled = true;
      void opened?.loadingTask.destroy();
    };
  }, [bytes]);

  // ---- metadata follows the working bytes ----
  useEffect(() => {
    if (!bytes) return;
    let cancelled = false;
    readMetadata(bytes)
      .then((m) => { if (!cancelled) setMeta(m); })
      .catch(() => { /* a document with no info dict just shows blanks */ });
    return () => { cancelled = true; };
  }, [bytes]);

  // ---- operation runner ----

  /** Run an op over the current bytes, recording the previous state for undo. */
  const apply = useCallback(
    async (label: string, op: (current: Uint8Array) => Promise<Uint8Array>) => {
      if (!bytes || busy) return;
      setBusy(label);
      setError(null);
      setNotice(null);
      try {
        const next = await op(bytes);
        setUndo((stack) => [...stack, bytes].slice(-UNDO_LIMIT));
        setRedo([]);
        setBytes(next);
        setDirty(true);
      } catch (e) {
        setError(`${label} failed: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setBusy(null);
      }
    },
    [bytes, busy],
  );

  function stepBack() {
    if (!undo.length || !bytes) return;
    const prev = undo[undo.length - 1];
    setUndo(undo.slice(0, -1));
    setRedo((stack) => [...stack, bytes].slice(-UNDO_LIMIT));
    setBytes(prev);
    setSelected([]);
    setDirty(true);
  }

  function stepForward() {
    if (!redo.length || !bytes) return;
    const next = redo[redo.length - 1];
    setRedo(redo.slice(0, -1));
    setUndo((stack) => [...stack, bytes].slice(-UNDO_LIMIT));
    setBytes(next);
    setSelected([]);
    setDirty(true);
  }

  // ---- page operations ----

  const order = Array.from({ length: pageCount }, (_, i) => i);

  function toggle(index: number, e: React.MouseEvent) {
    const anchor = lastClickedRef.current;
    if (e.shiftKey && anchor !== null) {
      const [lo, hi] = anchor < index ? [anchor, index] : [index, anchor];
      const range = Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);
      setSelected((prev) => Array.from(new Set([...prev, ...range])).sort((a, b) => a - b));
      return;
    }
    lastClickedRef.current = index;
    setSelected((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index].sort((a, b) => a - b),
    );
  }

  /** For ops that change the page count: the old indices no longer refer to the
   *  same pages afterwards, so the selection is dropped rather than silently
   *  re-pointed at whatever moved into those slots. */
  async function applyAndDeselect(label: string, op: (b: Uint8Array) => Promise<Uint8Array>) {
    await apply(label, op);
    setSelected([]);
  }

  async function move(dir: -1 | 1) {
    if (!selected.length) return;
    const first = Math.min(...selected);
    const before = order.filter((i) => !selected.includes(i) && i < first).length;
    const at = before + dir;
    if (at < 0 || at > pageCount - selected.length) return;
    const next = moveSelection(order, selected, at);
    await apply(dir < 0 ? "Move left" : "Move right", (b) => reorderPages(b, next));
    setSelected(selected.map((old) => next.indexOf(old)).sort((a, b) => a - b));
  }

  async function onImportFile(file: File) {
    const at = selected.length ? Math.max(...selected) + 1 : pageCount;
    const other = new Uint8Array(await file.arrayBuffer());
    await applyAndDeselect("Merge", (b) => importPages(b, other, at));
  }

  async function extract() {
    if (!bytes || !selected.length) return;
    setBusy("Extract");
    setError(null);
    try {
      const out = await extractPages(bytes, selected);
      downloadBytes(out, pdfFilename(title, ` — pages ${selected.map((i) => i + 1).join(",")}`));
      setNotice(`Extracted ${selected.length} page${selected.length === 1 ? "" : "s"} to a download.`);
    } catch (e) {
      setError(`Extract failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function applyMarks() {
    if (!pendingMarks) return;
    const pending = annotations;
    await apply("Apply marks", async (b) => {
      const { bytes: out, droppedChars } = await flattenAnnotations(b, pending);
      if (droppedChars > 0) {
        setNotice(
          `${droppedChars} character${droppedChars === 1 ? "" : "s"} could not be written with Helvetica and became "?".`,
        );
      }
      return out;
    });
    setAnnotations({});
  }

  // ---- save ----

  async function save() {
    if (!bytes || saving) return;
    setSaving(true);
    setError(null);
    try {
      await replaceLibraryFileBytes(
        notebookId,
        fileId,
        bytes.slice().buffer as ArrayBuffer,
        pdfFilename(title),
        PDF_MIME,
      );
      setSavedAt(Date.now());
      setDirty(false);
      onSaved?.();
    } catch (e) {
      setError(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  // ---- render ----

  if (error && !bytes) {
    return (
      <div className="flex items-start gap-2 text-terracotta font-mono text-[11px] tracking-[0.1em] uppercase p-6">
        <AlertCircle className="h-4 w-4 shrink-0 mt-px" /> {error}
      </div>
    );
  }
  if (!bytes || !doc) {
    return (
      <div className="flex items-center gap-2 text-ink-fade font-mono text-[11px] tracking-[0.1em] uppercase p-6">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading document…
      </div>
    );
  }

  const locked = pendingMarks > 0;
  const working = busy !== null;
  const noSelection = selected.length === 0;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Tabs + save */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-rule bg-paper-deep/40 shrink-0 flex-wrap">
        <div className="flex items-center rounded-[1px] border border-rule overflow-hidden">
          {(
            [
              ["pages", "Pages"],
              ["annotate", "Annotate"],
              ["document", "Document"],
            ] as const
          ).map(([key, label], i) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              aria-pressed={tab === key}
              className={`h-7 px-3 font-mono text-[10px] tracking-[0.14em] uppercase transition-colors ${
                i > 0 ? "border-l border-rule" : ""
              } ${tab === key ? "bg-ink text-paper" : "text-ink-fade hover:text-ink hover:bg-paper-light"}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 ml-1">
          <Button
            variant="ghost" size="icon"
            className="h-7 w-7 text-ink-fade hover:text-ink"
            onClick={stepBack}
            disabled={!undo.length || working}
            title="Undo"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost" size="icon"
            className="h-7 w-7 text-ink-fade hover:text-ink"
            onClick={stepForward}
            disabled={!redo.length || working}
            title="Redo"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </Button>
        </div>

        <span className="font-mono text-[10px] tracking-[0.12em] uppercase text-ink-mute ml-2">
          {pageCount} page{pageCount === 1 ? "" : "s"}
          {dirty ? " · unsaved" : ""}
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant="outline" size="sm"
            className="h-7 gap-1.5 rounded-[1px] font-mono text-[10px] tracking-[0.12em] uppercase"
            onClick={() => downloadBytes(bytes, pdfFilename(title, " (edited)"))}
            disabled={working}
            title="Download a copy without saving"
          >
            <Download className="h-3.5 w-3.5" /> Copy
          </Button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || working}
            className="inline-flex items-center gap-1.5 h-7 px-3 rounded-[1px] border border-ink bg-ink text-paper font-mono text-[10px] tracking-[0.14em] uppercase hover:bg-ink-soft disabled:opacity-60 transition-colors"
          >
            {saving ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>
            ) : savedAt && !dirty ? (
              <><CheckCircle2 className="h-3.5 w-3.5" /> Saved</>
            ) : (
              <><Save className="h-3.5 w-3.5" /> Save</>
            )}
          </button>
        </div>
      </div>

      {(error || notice || busy) && (
        <div
          className={`flex items-start gap-2 px-3 py-2 border-b border-rule shrink-0 font-mono text-[10px] tracking-[0.1em] uppercase ${
            error ? "bg-paper-deep/60 text-terracotta" : "bg-vellum text-ink-fade"
          }`}
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          ) : (
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-px" />
          )}
          <span>{busy ? `${busy}…` : (error ?? notice)}</span>
        </div>
      )}

      {/* Tab bodies */}
      {tab === "pages" && (
        <>
          <div className="flex items-center gap-1 px-3 py-2 border-b border-rule bg-vellum shrink-0 flex-wrap">
            <Button
              variant="ghost" size="sm"
              className="h-7 rounded-[1px] font-mono text-[10px] tracking-[0.12em] uppercase text-ink-fade hover:text-ink"
              onClick={() => setSelected(noSelection ? order : [])}
            >
              {noSelection ? "Select all" : `${selected.length} selected — clear`}
            </Button>
            <div className="w-px h-5 bg-rule mx-1" />
            {(
              [
                [RotateCcw, "Rotate left", () => apply("Rotate left", (b) => rotatePages(b, selected, -90))],
                [RotateCw, "Rotate right", () => apply("Rotate right", (b) => rotatePages(b, selected, 90))],
                [ArrowLeftToLine, "Move left", () => move(-1)],
                [ArrowRightToLine, "Move right", () => move(1)],
                [CopyPlus, "Duplicate", () => applyAndDeselect("Duplicate", (b) => duplicatePages(b, selected))],
                [FileOutput, "Extract to a new PDF", () => extract()],
              ] as const
            ).map(([Icon, label, run]) => (
              <Button
                key={label}
                variant="ghost" size="icon"
                className="h-7 w-7 text-ink-fade hover:text-ink"
                onClick={() => void run()}
                disabled={noSelection || working || locked}
                title={locked ? "Apply or clear your marks first" : label}
              >
                <Icon className="h-3.5 w-3.5" />
              </Button>
            ))}
            <Button
              variant="ghost" size="icon"
              className="h-7 w-7 text-ink-fade hover:text-terracotta"
              onClick={() => void applyAndDeselect("Delete pages", (b) => deletePages(b, selected))}
              disabled={noSelection || working || locked || selected.length >= pageCount}
              title={locked ? "Apply or clear your marks first" : "Delete pages"}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
            <div className="w-px h-5 bg-rule mx-1" />
            <Button
              variant="ghost" size="icon"
              className="h-7 w-7 text-ink-fade hover:text-ink"
              onClick={() =>
                void applyAndDeselect("Insert blank page", (b) =>
                  insertBlankPage(
                    b,
                    selected.length ? Math.max(...selected) + 1 : pageCount,
                    selected.length ? Math.max(...selected) : pageCount - 1,
                  ),
                )
              }
              disabled={working || locked}
              title={locked ? "Apply or clear your marks first" : "Insert a blank page"}
            >
              <FilePlus2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost" size="icon"
              className="h-7 w-7 text-ink-fade hover:text-ink"
              onClick={() => importRef.current?.click()}
              disabled={working || locked}
              title={locked ? "Apply or clear your marks first" : "Merge another PDF in"}
            >
              <Merge className="h-3.5 w-3.5" />
            </Button>
            <input
              ref={importRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void onImportFile(file);
              }}
            />
            <span className="ml-auto font-mono text-[10px] tracking-[0.1em] uppercase text-ink-mute hidden sm:inline">
              Click to select · ⇧click for a range
            </span>
          </div>

          <div className="flex-1 min-h-0 overflow-auto bg-paper-deep/50 p-5">
            <div className="flex flex-wrap gap-5 justify-center">
              {order.map((i) => (
                <PageTile
                  key={`${i}-${pageCount}`}
                  doc={doc}
                  pageNumber={i + 1}
                  selected={selected.includes(i)}
                  onToggle={(e) => toggle(i, e)}
                />
              ))}
            </div>
          </div>
        </>
      )}

      {tab === "annotate" && (
        <>
          <div className="flex items-center gap-2 px-3 py-2 border-b border-rule bg-vellum shrink-0">
            <button
              type="button"
              onClick={() => void applyMarks()}
              disabled={!pendingMarks || working}
              className="inline-flex items-center gap-1.5 h-7 px-3 rounded-[1px] border border-ink bg-ink text-paper font-mono text-[10px] tracking-[0.14em] uppercase hover:bg-ink-soft disabled:opacity-50 transition-colors"
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> Apply marks
            </button>
            <Button
              variant="ghost" size="sm"
              className="h-7 rounded-[1px] font-mono text-[10px] tracking-[0.12em] uppercase text-ink-fade hover:text-terracotta"
              onClick={() => setAnnotations({})}
              disabled={!pendingMarks}
            >
              Clear all
            </Button>
            <span className="ml-auto font-mono text-[10px] tracking-[0.1em] uppercase text-ink-mute">
              Page edits are locked until marks are applied
            </span>
          </div>
          <div className="flex-1 min-h-0">
            <PdfAnnotatePane
              doc={doc}
              pageIndex={Math.min(annotatePage, Math.max(pageCount - 1, 0))}
              onPageIndex={setAnnotatePage}
              annotations={annotations}
              onChange={setAnnotations}
            />
          </div>
        </>
      )}

      {tab === "document" && (
        <div className="flex-1 min-h-0 overflow-auto bg-paper-light px-6 py-5">
          <div className="max-w-xl flex flex-col gap-3">
            {(
              [
                ["title", "Title"],
                ["author", "Author"],
                ["subject", "Subject"],
                ["keywords", "Keywords (comma separated)"],
                ["creator", "Creator"],
                ["producer", "Producer"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex flex-col gap-1">
                <span className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-mute">{label}</span>
                <input
                  value={meta[key]}
                  onChange={(e) => setMeta({ ...meta, [key]: e.target.value })}
                  className="h-8 px-2 bg-vellum border border-rule rounded-[1px] font-serif text-[14px] text-ink focus:outline-none focus:border-ink"
                />
              </label>
            ))}
            <div className="flex items-center gap-2 mt-2">
              <Button
                variant="outline" size="sm"
                className="h-8 gap-1.5 rounded-[1px] font-mono text-[10px] tracking-[0.12em] uppercase"
                onClick={() => void apply("Update metadata", (b) => writeMetadata(b, meta))}
                disabled={working}
              >
                <Save className="h-3.5 w-3.5" /> Stage metadata
              </Button>
              <span className="font-mono text-[10px] tracking-[0.1em] uppercase text-ink-mute">
                Then Save to write the file
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
