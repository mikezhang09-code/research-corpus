"use client";

// Universal JSON viewer. Fetches a .json file, detects whether it's naturally
// tabular (array of objects, keyed records, …) and renders it as a sortable
// data table via react-data-grid; otherwise (or on toggle) shows pretty-printed
// raw JSON. Nested object/array cells show compact JSON and expand into a
// detail panel. Read-only.

import { useEffect, useMemo, useState } from "react";
import { DataGrid, type Column, type SortColumn } from "react-data-grid";
import "react-data-grid/lib/styles.css";
import { X, Loader2, AlertCircle, Table, Braces, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExpandButton, EXPANDED_MODAL } from "@/components/corpus/Expandable";
import { getLibraryFileContent } from "@/lib/api";
import { analyzeJson, cellText, isExpandable, type JsonAnalysis } from "@/lib/json-table";

type Row = Record<string, unknown> & { __key: number };

// Numbers compare numerically; everything else by its display text.
function compareValues(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return cellText(a).localeCompare(cellText(b), undefined, { numeric: true });
}

export function JsonModal({
  notebookId,
  fileId,
  title,
  onClose,
}: {
  /** Folio id, or null for a free-form file. */
  notebookId: string | null;
  fileId: string;
  title: string;
  onClose: () => void;
}) {
  const [raw, setRaw] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<JsonAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<"table" | "raw">("table");
  const [sortColumns, setSortColumns] = useState<SortColumn[]>([]);
  const [detail, setDetail] = useState<{ label: string; value: unknown } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const text = await getLibraryFileContent(notebookId, fileId);
        if (cancelled) return;
        setRaw(text);
        try {
          const parsed = JSON.parse(text);
          const a = analyzeJson(parsed);
          setAnalysis(a);
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
  }, [notebookId, fileId]);

  const isTable = analysis?.kind === "table";

  const rows = useMemo<Row[]>(
    () => (analysis?.kind === "table" ? analysis.rows.map((r, i) => ({ ...r, __key: i })) : []),
    [analysis],
  );

  const columns = useMemo<Column<Row>[]>(() => {
    if (analysis?.kind !== "table") return [];
    const cols: Column<Row>[] = [
      { key: "__key", name: "#", frozen: true, width: 56, resizable: false, cellClass: "rdg-rownum", renderCell: ({ row }) => row.__key + 1 },
    ];
    for (const key of analysis.columns) {
      cols.push({
        key,
        name: key,
        resizable: true,
        sortable: true,
        minWidth: 90,
        renderCell: ({ row }) => {
          const v = row[key];
          return isExpandable(v) ? (
            <button
              type="button"
              className="text-left w-full truncate text-sage underline decoration-dotted underline-offset-2"
              onClick={() => setDetail({ label: key, value: v })}
              title="Click to expand"
            >
              {cellText(v)}
            </button>
          ) : (
            <span className={v == null ? "text-ink-mute/50 italic" : undefined}>{v == null ? "null" : String(v)}</span>
          );
        },
      });
    }
    return cols;
  }, [analysis]);

  const sortedRows = useMemo(() => {
    if (!sortColumns.length) return rows;
    const { columnKey, direction } = sortColumns[0];
    const sorted = [...rows].sort((a, b) => compareValues(a[columnKey], b[columnKey]));
    return direction === "DESC" ? sorted.reverse() : sorted;
  }, [rows, sortColumns]);

  function download() {
    if (raw == null) return;
    const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
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
            {isTable && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 h-8 rounded-[1px] mr-1"
                onClick={() => setMode((m) => (m === "table" ? "raw" : "table"))}
                title={mode === "table" ? "Show raw JSON" : "Show as a table"}
              >
                {mode === "table" ? (<><Braces className="h-3.5 w-3.5" /> Raw</>) : (<><Table className="h-3.5 w-3.5" /> Table</>)}
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-ink-fade hover:text-ink" onClick={download} title="Download JSON">
              <Download className="h-4 w-4" />
            </Button>
            <ExpandButton expanded={expanded} onToggle={() => setExpanded(!expanded)} />
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-ink-fade hover:text-ink" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

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
              rows={sortedRows}
              rowKeyGetter={(r) => r.__key}
              sortColumns={sortColumns}
              onSortColumnsChange={setSortColumns}
              rowHeight={28}
              headerRowHeight={32}
              style={{ height: "100%" }}
            />
          </div>
        ) : (
          <pre className="json-raw overflow-auto flex-1 m-0 p-6 text-[12px] leading-relaxed font-mono text-ink whitespace-pre">
            {raw}
          </pre>
        )}

        {/* Nested-value detail panel */}
        {detail && (
          <div className="border-t border-ink shrink-0 max-h-[35vh] flex flex-col bg-paper-light">
            <div className="flex items-center justify-between px-6 py-2 border-b border-rule shrink-0">
              <span className="font-mono text-[10px] tracking-[0.16em] uppercase text-ink-mute">{detail.label}</span>
              <button type="button" className="text-ink-fade hover:text-ink" onClick={() => setDetail(null)}>
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <pre className="overflow-auto flex-1 m-0 px-6 py-3 text-[11px] leading-relaxed font-mono text-ink whitespace-pre">
              {JSON.stringify(detail.value, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
