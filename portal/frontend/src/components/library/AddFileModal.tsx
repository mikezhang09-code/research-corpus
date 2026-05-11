"use client";

import { useRef, useState } from "react";
import { X, Upload, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { uploadLibraryNotebookFile, type LibraryFile } from "@/lib/api";

const CATEGORY_OPTIONS = [
  { value: "note",    label: "Note"     },
  { value: "report",  label: "Report"   },
  { value: "slide",   label: "Slide"    },
  { value: "audio",   label: "Audio"    },
  { value: "video",   label: "Video"    },
  { value: "mindmap", label: "Mind Map" },
  { value: "image",   label: "Image"    },
  { value: "other",   label: "Other"    },
];

const CATEGORY_MAP: Record<string, string> = {
  ".ppt": "slide", ".pptx": "slide", ".key": "slide", ".odp": "slide",
  ".txt": "note", ".md": "note",
  ".docx": "report", ".doc": "report", ".pdf": "report",
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !uploading) onClose(); }}
    >
      <div className="bg-background rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b shrink-0">
          <h2 className="font-semibold text-base">Add file</h2>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClose} disabled={uploading}>
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
                className="w-full rounded-xl border-2 border-dashed border-border hover:border-primary hover:bg-primary/5 transition-colors flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground"
              >
                <Upload className="h-8 w-8 opacity-50" />
                <span className="text-sm">Click to select a file</span>
              </button>
            ) : (
              <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-muted/30 px-4 py-3">
                <Upload className="h-5 w-5 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
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
                <label className="text-xs font-medium">Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  disabled={uploading}
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {CATEGORY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              {/* Optional title override */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Title <span className="text-muted-foreground font-normal">(optional — defaults to filename)</span></label>
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
            <div className="flex items-start gap-2 text-destructive text-xs bg-destructive/5 border border-destructive/20 rounded-md p-2.5">
              <AlertCircle className="h-4 w-4 shrink-0 mt-px" />
              <span className="break-words">{error}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t bg-muted/30">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={uploading}>Cancel</Button>
          <Button size="sm" onClick={handleUpload} disabled={!file || uploading} className="gap-2 min-w-24">
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
