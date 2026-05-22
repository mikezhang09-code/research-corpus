"use client";

import { useRef, useState } from "react";
import { X, Upload, Loader2, AlertCircle, FileText, Plus, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { uploadLibraryNotebookFile, type LibraryFile } from "@/lib/api";
import {
  CATEGORY_OPTIONS,
  categoryLabel,
  detectCategory,
  stripExt,
} from "./file-categories";

function formatBytes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  if (n >= 1_000) return `${Math.round(n / 1_000)} KB`;
  return `${n} B`;
}

type UploadStatus = "pending" | "uploading" | "done" | "error";

type Queued = {
  /** Stable key for React + remove. */
  key: string;
  file: File;
  /** Auto-detected from extension; editable only in single-file mode. */
  category: string;
  /** Defaults to filename without extension; editable only in single-file mode. */
  title: string;
  status: UploadStatus;
  /** Per-file error message if status === "error". */
  error?: string;
};

let _nextKey = 0;
function makeKey() { return `f-${++_nextKey}-${Date.now()}`; }

function makeQueued(file: File): Queued {
  return {
    key: makeKey(),
    file,
    category: detectCategory(file.name),
    title: stripExt(file.name),
    status: "pending",
  };
}

export function AddFileModal({
  notebookId,
  onClose,
  onUploaded,
}: {
  notebookId: string;
  onClose: () => void;
  onUploaded: (file: LibraryFile) => void;
}) {
  const [queued, setQueued] = useState<Queued[]>([]);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const total = queued.length;
  const single = total === 1;
  const doneCount = queued.filter((q) => q.status === "done").length;
  const errorCount = queued.filter((q) => q.status === "error").length;
  const allDone = total > 0 && doneCount + errorCount === total;
  const canUpload = total > 0 && !uploading && !allDone;

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const incoming = Array.from(list).map(makeQueued);
    setQueued((prev) => [...prev, ...incoming]);
  }

  function removeAt(key: string) {
    setQueued((prev) => prev.filter((q) => q.key !== key));
  }

  function patchAt(key: string, patch: Partial<Queued>) {
    setQueued((prev) => prev.map((q) => (q.key === key ? { ...q, ...patch } : q)));
  }

  async function handleUpload() {
    if (!canUpload) return;
    setUploading(true);
    // Sequential — keeps file order stable and avoids N concurrent multipart
    // streams against the backend.
    for (const item of queued) {
      if (item.status !== "pending") continue;
      patchAt(item.key, { status: "uploading", error: undefined });
      try {
        const title = item.title.trim() || stripExt(item.file.name);
        const result = await uploadLibraryNotebookFile(notebookId, item.file, item.category, title);
        onUploaded(result);
        patchAt(item.key, { status: "done" });
      } catch (e) {
        patchAt(item.key, {
          status: "error",
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    setUploading(false);
  }

  function handleClose() {
    if (uploading) return;
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div className="bg-vellum rounded-[2px] border border-ink shadow-[4px_4px_0_rgb(42_36_24_/_0.18)] w-full max-w-lg flex flex-col overflow-hidden max-h-[85vh]">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-rule shrink-0">
          <h2 className="font-serif-display text-[22px] leading-tight tracking-tight text-ink">
            {single ? "Add file" : "Add files"}
            {total > 1 && (
              <span className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-mute ml-2">
                {total} files
              </span>
            )}
          </h2>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-ink-fade hover:text-ink" onClick={handleClose} disabled={uploading}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files);
              if (e.target) e.target.value = "";
            }}
          />

          {/* Empty state */}
          {total === 0 && (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="w-full rounded-[2px] border border-dashed border-ink/40 bg-paper-light hover:border-ink hover:bg-paper-deep transition-colors flex flex-col items-center justify-center gap-2 py-8 text-ink-fade hover:text-ink"
            >
              <Upload className="h-8 w-8 opacity-60" />
              <span className="font-serif text-[14px]">Click to select file(s)</span>
              <span className="font-mono text-[9px] tracking-[0.18em] uppercase text-ink-mute">
                Single or multiple — title &amp; type are editable
              </span>
            </button>
          )}

          {/* Single-file mode: editable title + category */}
          {single && (() => {
            const item = queued[0];
            return (
              <>
                <SingleFilePicked
                  item={item}
                  onRemove={() => removeAt(item.key)}
                  disabled={uploading}
                />

                <div className="space-y-1.5">
                  <label className="font-mono text-[10px] tracking-[0.18em] uppercase text-ink-mute">
                    Title
                  </label>
                  <Input
                    value={item.title}
                    onChange={(e) => patchAt(item.key, { title: e.target.value })}
                    placeholder={stripExt(item.file.name)}
                    disabled={uploading}
                    autoFocus
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="font-mono text-[10px] tracking-[0.18em] uppercase text-ink-mute">
                    File type
                  </label>
                  <select
                    value={item.category}
                    onChange={(e) => patchAt(item.key, { category: e.target.value })}
                    disabled={uploading}
                    className="w-full rounded-[1px] border border-rule bg-vellum px-3 py-2 font-serif text-[14px] text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink focus-visible:border-ink"
                  >
                    {CATEGORY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>

                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  disabled={uploading}
                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded-[1px] border border-dashed border-rule hover:border-ink hover:bg-paper-deep font-mono text-[10px] tracking-[0.14em] uppercase text-ink-fade hover:text-ink transition-colors disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add more files
                </button>
              </>
            );
          })()}

          {/* Multi-file mode: per-file rows with auto-detected category + stripped title */}
          {total > 1 && (
            <>
              <div className="space-y-1.5">
                {queued.map((q) => (
                  <QueuedRow
                    key={q.key}
                    item={q}
                    onRemove={() => removeAt(q.key)}
                    disabled={uploading}
                  />
                ))}
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  disabled={uploading}
                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded-[1px] border border-dashed border-rule hover:border-ink hover:bg-paper-deep font-mono text-[10px] tracking-[0.14em] uppercase text-ink-fade hover:text-ink transition-colors disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add more
                </button>
              </div>
              <p className="font-serif italic text-[12.5px] text-ink-fade">
                Title defaults to the filename (without extension) and file type
                is auto-detected per file. You can edit either after upload via
                the file card&apos;s pencil button.
              </p>
            </>
          )}

          {/* Batch progress */}
          {uploading && (
            <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.14em] uppercase text-ink-fade bg-paper-light border border-rule rounded-[1px] p-2.5">
              <Loader2 className="h-4 w-4 animate-spin text-terracotta shrink-0" />
              <span>Uploading {Math.min(doneCount + errorCount + 1, total)} of {total}…</span>
            </div>
          )}

          {!uploading && allDone && errorCount === 0 && (
            <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.14em] uppercase text-mint bg-vellum border border-mint/40 rounded-[1px] p-2.5">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              {total === 1 ? "File uploaded" : `All ${total} files uploaded`}
            </div>
          )}

          {!uploading && allDone && errorCount > 0 && (
            <div className="flex items-start gap-2 font-mono text-[10px] tracking-[0.14em] uppercase text-terracotta bg-vellum border border-terracotta/40 rounded-[1px] p-2.5">
              <AlertCircle className="h-4 w-4 shrink-0 mt-px" />
              <span>
                {doneCount} uploaded · {errorCount} failed — hover individual rows for the reason.
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-rule bg-paper-light">
          <Button variant="ghost" size="sm" onClick={handleClose} disabled={uploading}>
            {allDone ? "Close" : "Cancel"}
          </Button>
          {!allDone && (
            <Button
              size="sm"
              onClick={handleUpload}
              disabled={!canUpload}
              className="gap-2 min-w-32 rounded-[1px]"
            >
              {uploading ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading…</>
              ) : (
                <><Upload className="h-3.5 w-3.5" /> Upload {total > 1 ? `(${total})` : ""}</>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function SingleFilePicked({
  item,
  onRemove,
  disabled,
}: {
  item: Queued;
  onRemove: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-[2px] border border-rule bg-paper-light px-4 py-3">
      <Upload className="h-5 w-5 text-ink-fade shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-serif text-[14px] text-ink truncate">{item.file.name}</p>
        <p className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-mute">{formatBytes(item.file.size)}</p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 text-ink-fade hover:text-terracotta"
        onClick={onRemove}
        disabled={disabled}
        title="Remove"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function QueuedRow({
  item,
  onRemove,
  disabled,
}: {
  item: Queued;
  onRemove: () => void;
  disabled: boolean;
}) {
  return (
    <div
      className="flex items-center gap-2.5 rounded-[1px] border border-rule bg-vellum px-3 py-2"
      title={item.error ?? undefined}
    >
      <FileText className="h-4 w-4 text-ink-fade shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-serif text-[13px] text-ink truncate">{item.title}</p>
        <p className="font-mono text-[9px] tracking-[0.14em] uppercase text-ink-mute">
          {formatBytes(item.file.size)} · {categoryLabel(item.category)}
        </p>
      </div>
      <span className="shrink-0 inline-flex items-center gap-1 font-mono text-[9px] tracking-[0.14em] uppercase">
        {item.status === "uploading" && (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin text-terracotta" />
            <span className="text-ink-fade">Uploading</span>
          </>
        )}
        {item.status === "done" && (
          <>
            <CheckCircle2 className="h-3.5 w-3.5 text-mint" />
            <span className="text-mint">Saved</span>
          </>
        )}
        {item.status === "error" && (
          <>
            <AlertCircle className="h-3.5 w-3.5 text-terracotta" />
            <span className="text-terracotta">Failed</span>
          </>
        )}
      </span>
      {item.status === "pending" && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-ink-fade hover:text-terracotta"
          onClick={onRemove}
          disabled={disabled}
          title="Remove from queue"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
