"use client";

// Universal JSON viewer + editor. Fetches a .json file, detects whether it's
// naturally tabular and renders it as a sortable react-data-grid table;
// otherwise (or on toggle) shows the raw JSON. In edit mode, scalar cells edit
// inline (type-preserving), nested object/array cells edit as JSON in the
// detail panel, and rows can be added/removed; Save rebuilds the original JSON
// shape and PUTs it back. Non-round-trippable shapes edit as raw JSON text.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DataGrid, renderTextEditor, type Column, type SortColumn, type RowsChangeData } from "react-data-grid";
import "react-data-grid/lib/styles.css";
import { X, Loader2, AlertCircle, Table, Braces, Download, Pencil, Eye, Save, CheckCircle2, Plus, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExpandButton, EXPANDED_MODAL } from "@/components/corpus/Expandable";
import { getLibraryFileContent, replaceLibraryFileBytes } from "@/lib/api";
import { analyzeJson, toJson, coerceCell, cellText, isExpandable, type JsonAnalysis } from "@/lib/json-table";

type Row = Record<string, unknown> & { __key: number };

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return cellText(a).localeCompare(cellText(b), undefined, { numeric: true });
}

export function JsonModal({
  notebookId,
  fileId,
  title,
  onSaved,
  onClose,
}: {
  /** Folio id, or null for a free-form file. */
  notebookId: string | null;
  fileId: string;
  title: string;
  /** Called after a successful save so the parent can refresh its preview. */
  onSaved?: () => void;
  onClose: () => void;
}) {
  const [raw, setRaw] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<JsonAnalysis | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<"table" | "raw">("table");
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [rawDraft, setRawDraft] = useState("");
  const [sortColumns, setSortColumns] = useState<SortColumn[]>([]);
  const [detail, setDetail] = useState<{ key: number; col: string; value: unknown } | null>(null);
  const [detailDraft, setDetailDraft] = useState("");
  const [detailError, setDetailError] = useState<string | null>(null);
  const nextId = useRef(1_000_000);

  const isTable = analysis?.kind === "table";
  const editableTable = analysis?.kind === "table" && analysis.layout != null;

  const applyAnalysis = useCallback((a: JsonAnalysis) => {
    setAnalysis(a);
    setRows(a.kind === "table" ? a.rows.map((r, i) => ({ ...r, __key: i })) : []);
    nextId.current = 1_000_000;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const text = await getLibraryFileContent(notebookId, fileId);
        if (cancelled) return;
        setRaw(text);
        setRawDraft(text);
        try {
          const a = analyzeJson(JSON.parse(text));
          applyAnalysis(a);
          setMode(a.kind === "table" ? "table" : "raw");
        } catch {
          setAnalysis({ kind: "tree" });
          setMode("raw");
          setError("Not valid JSON — showing raw text.");
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [notebookId, fileId, applyAnalysis]);

  const columns = useMemo<Column<Row>[]>(() => {
    if (analysis?.kind !== "table") return [];
    const cols: Column<Row>[] = [
      { key: "__key", name: "#", frozen: true, width: 56, resizable: false, cellClass: "rdg-rownum", renderCell: ({ rowIdx }) => rowIdx + 1 },
    ];
    for (const key of analysis.columns) {
      cols.push({
        key,
        name: key,
        resizable: true,
        sortable: !editing,
        minWidth: 90,
        editable: (row) => editing && !isExpandable(row[key]),
        renderEditCell: renderTextEditor,
        renderCell: ({ row }) => {
          const v = row[key];
          if (isExpandable(v)) {
            return (
              <button
                type="button"
                className="text-left w-full truncate text-sage underline decoration-dotted underline-offset-2"
                onClick={() => {
                  setDetail({ key: row.__key, col: key, value: v });
                  setDetailDraft(JSON.stringify(v, null, 2));
                  setDetailError(null);
                }}
                title={editing ? "Click to edit" : "Click to expand"}
              >
                {cellText(v)}
              </button>
            );
          }
          return <span className={v == null ? "text-ink-mute/50 italic" : undefined}>{v == null ? "null" : String(v)}</span>;
        },
      });
    }
    return cols;
  }, [analysis, editing]);

  const sortedRows = useMemo(() => {
    if (editing || !sortColumns.length) return rows;
    const { columnKey, direction } = sortColumns[0];
    const sorted = [...rows].sort((a, b) => compareValues(a[columnKey], b[columnKey]));
    return direction === "DESC" ? sorted.reverse() : sorted;
  }, [rows, sortColumns, editing]);

  function onRowsChange(next: Row[], data: RowsChangeData<Row>) {
    const key = data.column.key;
    setRows((prev) => next.map((r, i) => {
      if (!data.indexes.includes(i)) return r;
      return { ...r, [key]: coerceCell(String(r[key] ?? ""), prev[i]?.[key]) };
    }));
    setDirty(true);
  }

  function addRow() {
    setRows((prev) => [...prev, { __key: nextId.current++ }]);
    setDirty(true);
  }
  function removeRow() {
    setRows((prev) => (prev.length ? prev.slice(0, -1) : prev));
    setDirty(true);
  }

  function startEditing() {
    setSortColumns([]);
    setEditing(true);
    setRawDraft(raw ?? "");
    if (!editableTable) setMode("raw");
  }
  function stopEditing() {
    setEditing(false);
    setDetail(null);
  }

  function applyDetail() {
    if (!detail) return;
    try {
      const parsed = JSON.parse(detailDraft);
      setRows((prev) => prev.map((r) => (r.__key === detail.key ? { ...r, [detail.col]: parsed } : r)));
      setDirty(true);
      setDetail(null);
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : String(e));
    }
  }

  async function persist(text: string) {
    setSaving(true);
    setError(null);
    try {
      const bytes = new TextEncoder().encode(text);
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      await replaceLibraryFileBytes(notebookId, fileId, buf, `${title || "data"}.json`, "application/json");
      setRaw(text);
      setRawDraft(text);
      try { applyAnalysis(analyzeJson(JSON.parse(text))); } catch { /* keep prior table */ }
      setDirty(false);
      setSavedAt(Date.now());
      onSaved?.();
    } catch (e) {
      setError(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  function save() {
    if (saving) return;
    if (mode === "raw") {
      try { JSON.parse(rawDraft); } catch (e) { setError(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`); return; }
      void persist(rawDraft);
    } else if (analysis?.kind === "table" && analysis.layout) {
      void persist(JSON.stringify(toJson(analysis.layout, analysis.columns, rows), null, 2));
    }
  }

  function download() {
    const text = editing && mode === "raw" ? rawDraft : raw;
    if (text == null) return;
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title || "data"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const showTable = mode === "table" && isTable;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={`bg-vellum rounded-[2px] border border-ink shadow-[4px_4px_0_rgb(42_36_24_/_0.18)] w-full ${expanded ? EXPANDED_MODAL : "max-w-6xl max-h-[90vh]"} flex flex-col overflow-hidden`}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule shrink-0">
          <div className="min-w-0">
            <h2 className="font-serif-display text-[22px] leading-tight tracking-tight text-ink line-clamp-1">{title}</h2>
            {showTable && (
              <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-ink-mute mt-1">
                {rows.length} row{rows.length !== 1 ? "s" : ""} · {columns.length - 1} column{columns.length - 1 !== 1 ? "s" : ""}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {isTable && !editing && (
              <Button variant="outline" size="sm" className="gap-1.5 h-8 rounded-[1px] mr-1" onClick={() => setMode((m) => (m === "table" ? "raw" : "table"))} title={mode === "table" ? "Show raw JSON" : "Show as a table"}>
                {mode === "table" ? (<><Braces className="h-3.5 w-3.5" /> Raw</>) : (<><Table className="h-3.5 w-3.5" /> Table</>)}
              </Button>
            )}
            <Button variant="outline" size="sm" className="gap-1.5 h-8 rounded-[1px] mr-1" onClick={() => (editing ? stopEditing() : startEditing())}>
              {editing ? (<><Eye className="h-3.5 w-3.5" /> View</>) : (<><Pencil className="h-3.5 w-3.5" /> Edit</>)}
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-ink-fade hover:text-ink" onClick={download} title="Download JSON">
              <Download className="h-4 w-4" />
            </Button>
            <ExpandButton expanded={expanded} onToggle={() => setExpanded(!expanded)} />
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-ink-fade hover:text-ink" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Edit toolbar */}
        {editing && (
          <div className="flex items-center gap-2 px-6 py-2 border-b border-rule shrink-0 flex-wrap bg-paper-light">
            <button type="button" disabled={saving || !dirty} onClick={save} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[1px] border border-ink bg-ink text-paper font-mono text-[10px] tracking-[0.14em] uppercase hover:bg-ink-soft disabled:opacity-50 transition-colors">
              {saving ? (<><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>) : savedAt && !dirty ? (<><CheckCircle2 className="h-3.5 w-3.5" /> Saved</>) : (<><Save className="h-3.5 w-3.5" /> Save</>)}
            </button>
            {showTable && editableTable && (
              <>
                <div className="h-5 w-px bg-rule mx-1" />
                <button type="button" onClick={addRow} className="inline-flex items-center gap-1 h-8 px-2.5 rounded-[1px] border border-rule hover:border-ink text-ink-fade hover:text-ink font-mono text-[10px] tracking-[0.14em] uppercase transition-colors"><Plus className="h-3.5 w-3.5" /> Row</button>
                <button type="button" onClick={removeRow} className="inline-flex items-center gap-1 h-8 px-2.5 rounded-[1px] border border-rule hover:border-ink text-ink-fade hover:text-ink font-mono text-[10px] tracking-[0.14em] uppercase transition-colors"><Minus className="h-3.5 w-3.5" /> Row</button>
              </>
            )}
            {mode === "raw" && !editableTable && isTable && (
              <span className="font-mono text-[10px] tracking-[0.1em] uppercase text-ink-mute">This shape edits as raw JSON</span>
            )}
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-terracotta font-mono text-[11px] tracking-[0.1em] uppercase px-6 py-2 border-b border-rule shrink-0">
            <AlertCircle className="h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        {/* Body */}
        {raw == null && !error ? (
          <div className="flex items-center gap-2 text-ink-fade font-mono text-[11px] tracking-[0.1em] uppercase p-6">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : showTable ? (
          <div className="json-table flex-1 min-h-0">
            <DataGrid
              className="rdg-light"
              columns={columns}
              rows={editing ? rows : sortedRows}
              rowKeyGetter={(r) => r.__key}
              onRowsChange={editing ? onRowsChange : undefined}
              sortColumns={sortColumns}
              onSortColumnsChange={setSortColumns}
              rowHeight={28}
              headerRowHeight={32}
              style={{ height: "100%" }}
            />
          </div>
        ) : editing ? (
          <textarea
            className="json-raw flex-1 min-h-0 m-0 p-6 text-[12px] leading-relaxed font-mono text-ink bg-vellum resize-none outline-none"
            value={rawDraft}
            spellCheck={false}
            onChange={(e) => { setRawDraft(e.target.value); setDirty(true); }}
          />
        ) : (
          <pre className="json-raw overflow-auto flex-1 m-0 p-6 text-[12px] leading-relaxed font-mono text-ink whitespace-pre">{raw}</pre>
        )}

        {/* Nested-value detail panel */}
        {detail && (
          <div className="border-t border-ink shrink-0 max-h-[40vh] flex flex-col bg-paper-light">
            <div className="flex items-center justify-between px-6 py-2 border-b border-rule shrink-0">
              <span className="font-mono text-[10px] tracking-[0.16em] uppercase text-ink-mute">{detail.col}</span>
              <div className="flex items-center gap-2">
                {editing && editableTable && (
                  <Button variant="outline" size="sm" className="h-7 rounded-[1px]" onClick={applyDetail}>Apply</Button>
                )}
                <button type="button" className="text-ink-fade hover:text-ink" onClick={() => setDetail(null)}><X className="h-3.5 w-3.5" /></button>
              </div>
            </div>
            {detailError && (
              <div className="flex items-center gap-2 text-terracotta font-mono text-[10px] tracking-[0.1em] uppercase px-6 py-1.5 shrink-0">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {detailError}
              </div>
            )}
            {editing && editableTable ? (
              <textarea
                className="flex-1 min-h-0 m-0 px-6 py-3 text-[11px] leading-relaxed font-mono text-ink bg-paper-light resize-none outline-none"
                value={detailDraft}
                spellCheck={false}
                onChange={(e) => setDetailDraft(e.target.value)}
              />
            ) : (
              <pre className="overflow-auto flex-1 m-0 px-6 py-3 text-[11px] leading-relaxed font-mono text-ink whitespace-pre">{JSON.stringify(detail.value, null, 2)}</pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
