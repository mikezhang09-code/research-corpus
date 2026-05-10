"use client";

import { useRef, useState } from "react";
import { X, Loader2, AlertCircle, Link2, FileText, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addSourceUrl, addSourceText, addSourceFile, type SourceRead } from "@/lib/api";

type Kind = "url" | "text" | "file";

export function AddSourceModal({
  notebookId,
  onClose,
  onAdded,
}: {
  notebookId: string;
  onClose: () => void;
  onAdded: (source: SourceRead) => void;
}) {
  const [kind, setKind] = useState<Kind>("url");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [url, setUrl] = useState("");
  const [textTitle, setTextTitle] = useState("");
  const [textContent, setTextContent] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pickedFile, setPickedFile] = useState<File | null>(null);

  function reset() {
    setUrl(""); setTextTitle(""); setTextContent(""); setPickedFile(null); setError(null);
  }

  async function handleAdd() {
    setSubmitting(true);
    setError(null);
    try {
      let s: SourceRead;
      if (kind === "url") {
        if (!url.trim()) throw new Error("URL is required");
        s = await addSourceUrl(notebookId, url.trim());
      } else if (kind === "text") {
        if (!textTitle.trim() || !textContent.trim()) throw new Error("Title and content are required");
        s = await addSourceText(notebookId, textTitle.trim(), textContent);
      } else {
        if (!pickedFile) throw new Error("Pick a file first");
        s = await addSourceFile(notebookId, pickedFile);
      }
      onAdded(s);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  const tabBtn = (k: Kind, Icon: React.ElementType, label: string) => (
    <button
      onClick={() => { setKind(k); reset(); }}
      className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
        kind === k ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
      disabled={submitting}
    >
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}
    >
      <div className="bg-background rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b shrink-0">
          <h2 className="font-semibold text-base">Add source</h2>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClose} disabled={submitting}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Tabs */}
        <div className="flex border-b shrink-0">
          {tabBtn("url", Link2, "URL")}
          {tabBtn("text", FileText, "Text")}
          {tabBtn("file", Upload, "File")}
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3 overflow-y-auto flex-1">
          {kind === "url" && (
            <div>
              <label className="block text-xs font-medium mb-1.5">URL</label>
              <Input
                autoFocus
                placeholder="https://example.com or YouTube link"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
              />
              <p className="text-xs text-muted-foreground mt-1.5">YouTube URLs are auto-detected.</p>
            </div>
          )}

          {kind === "text" && (
            <>
              <div>
                <label className="block text-xs font-medium mb-1.5">Title</label>
                <Input
                  autoFocus
                  placeholder="My notes"
                  value={textTitle}
                  onChange={(e) => setTextTitle(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5">Content</label>
                <textarea
                  placeholder="Paste text content…"
                  value={textContent}
                  onChange={(e) => setTextContent(e.target.value)}
                  rows={6}
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
                />
              </div>
            </>
          )}

          {kind === "file" && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={(e) => setPickedFile(e.target.files?.[0] ?? null)}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={submitting}
                className="w-full flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border py-8 px-4 text-muted-foreground hover:border-primary hover:text-primary transition-colors"
              >
                <Upload className="h-6 w-6" />
                <span className="text-sm font-medium">
                  {pickedFile ? pickedFile.name : "Click to pick a file"}
                </span>
                {pickedFile && (
                  <span className="text-xs">
                    {pickedFile.size > 1_000_000
                      ? `${(pickedFile.size / 1_000_000).toFixed(1)} MB`
                      : `${Math.round(pickedFile.size / 1000)} KB`}
                  </span>
                )}
              </button>
              <p className="text-xs text-muted-foreground">
                Supported: PDF, DOCX, MD, TXT, EPUB, audio, video, images.
              </p>
            </>
          )}

          {error && (
            <div className="flex items-start gap-2 text-destructive text-xs bg-destructive/5 border border-destructive/20 rounded-md p-2.5">
              <AlertCircle className="h-4 w-4 shrink-0 mt-px" />
              <span className="break-words">{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t bg-muted/30">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button size="sm" onClick={handleAdd} disabled={submitting} className="gap-2 min-w-20">
            {submitting ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Adding…</>
            ) : (
              "Add"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
