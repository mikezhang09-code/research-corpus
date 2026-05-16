"use client";

import { useRef, useState } from "react";
import { X, Upload, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { uploadLibraryNotebookFile, type LibraryFile } from "@/lib/api";

const CATEGORY_OPTIONS = [
  { value: "note",        label: "Note"        },
  { value: "report",      label: "Report"      },
  { value: "slide",       label: "Slide"       },
  { value: "spreadsheet", label: "Spreadsheet" },
  { value: "audio",       label: "Audio"       },
  { value: "video",       label: "Video"       },
  { value: "mindmap",     label: "Mind Map"    },
  { value: "image",       label: "Image"       },
  { value: "other",       label: "Other"       },
];

const CATEGORY_MAP: Record<string, string> = {
  ".ppt": "slide", ".pptx": "slide", ".key": "slide", ".odp": "slide",
  ".txt": "note", ".md": "note",
  ".docx": "report", ".doc": "report", ".pdf": "report",
  ".xlsx": "spreadsheet", ".xls": "spreadsheet", ".xlsm": "spreadsheet",
  ".csv": "spreadsheet", ".ods": "spreadsheet",
  ".mp3": "audio", ".m4a": "audio", ".wav": "audio", ".ogg": "audio", ".aac": "audio",
  ".mp4": "video", ".mov": "video", ".avi": "video", ".mkv": "video", ".webm": "video",
  ".json": "mindmap",
  ".png": "image", ".jpg": "image", ".jpeg": "image",
  ".gif": "image", ".webp": "image", ".svg": "image",
};

function detectCategory(filename: string): string {
  const ext = "." + filename.split(".").pop()!.toLowerCase();
  return CATEGORY_MAP[ext] ?? "other";
}

function formatBytes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  if (n >= 1_000) return `${Math.round(n / 1_000)} KB`;
  return `${n} B`;
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
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState("other");
  const [title, setTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(f: File | null) {
    if (!f) return;
    setFile(f);
    setCategory(detectCategory(f.name));
    setTitle("");
  }

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const result = await uploadLibraryNotebookFile(notebookId, file, category, title || undefined);
      onUploaded(result);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setUploading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !uploading) onClose(); }}
    >
      <div className="bg-vellum rounded-[2px] border border-ink shadow-[4px_4px_0_rgb(42_36_24_/_0.18)] w-full max-w-md flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-rule shrink-0">
          <h2 className="font-serif-display text-[22px] leading-tight tracking-tight text-ink">Add file</h2>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-ink-fade hover:text-ink" onClick={onClose} disabled={uploading}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* File picker */}
          <div>
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
            />
            {!file ? (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="w-full rounded-[2px] border border-dashed border-ink/40 bg-paper-light hover:border-ink hover:bg-paper-deep transition-colors flex flex-col items-center justify-center gap-2 py-8 text-ink-fade hover:text-ink"
              >
                <Upload className="h-8 w-8 opacity-60" />
                <span className="font-serif text-[14px]">Click to select a file</span>
              </button>
            ) : (
              <div className="flex items-center gap-3 rounded-[2px] border border-rule bg-paper-light px-4 py-3">
                <Upload className="h-5 w-5 text-ink-fade shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-serif text-[14px] text-ink truncate">{file.name}</p>
                  <p className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-mute">{formatBytes(file.size)}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-ink-fade hover:text-terracotta"
                  onClick={() => { setFile(null); setCategory("other"); }}
                  disabled={uploading}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>

          {file && (
            <>
              {/* Category */}
              <div className="space-y-1.5">
                <label className="font-mono text-[10px] tracking-[0.18em] uppercase text-ink-mute">Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  disabled={uploading}
                  className="w-full rounded-[1px] border border-rule bg-vellum px-3 py-2 font-serif text-[14px] text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink focus-visible:border-ink"
                >
                  {CATEGORY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              {/* Optional title override */}
              <div className="space-y-1.5">
                <label className="font-mono text-[10px] tracking-[0.18em] uppercase text-ink-mute">Title <span className="normal-case tracking-normal text-ink-mute/70 italic">(optional — defaults to filename)</span></label>
                <Input
                  placeholder={file.name}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={uploading}
                />
              </div>
            </>
          )}

          {error && (
            <div className="flex items-start gap-2 font-mono text-[11px] tracking-[0.08em] text-terracotta bg-vellum border border-terracotta/40 rounded-[1px] p-2.5">
              <AlertCircle className="h-4 w-4 shrink-0 mt-px" />
              <span className="break-words">{error}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-rule bg-paper-light">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={uploading}>Cancel</Button>
          <Button size="sm" onClick={handleUpload} disabled={!file || uploading} className="gap-2 min-w-24 rounded-[1px]">
            {uploading ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading…</>
            ) : (
              <><Upload className="h-3.5 w-3.5" /> Upload</>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
