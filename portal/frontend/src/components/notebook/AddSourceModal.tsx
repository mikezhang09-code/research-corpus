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
      className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 font-mono text-[10px] tracking-[0.16em] uppercase border-b transition-colors ${
        kind === k ? "border-ink text-ink bg-paper-light" : "border-rule text-ink-fade hover:text-ink hover:bg-paper-light/50"
      }`}
      disabled={submitting}
    >
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}
    >
      <div className="bg-vellum rounded-[2px] border border-ink shadow-[4px_4px_0_rgb(42_36_24_/_0.18)] w-full max-w-md flex flex-col overflow-hidden max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-rule shrink-0">
          <h2 className="font-serif-display text-[22px] leading-tight tracking-tight text-ink">Add source</h2>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-ink-fade hover:text-ink" onClick={onClose} disabled={submitting}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Tabs */}
        <div className="flex shrink-0">
          {tabBtn("url", Link2, "URL")}
          {tabBtn("text", FileText, "Text")}
          {tabBtn("file", Upload, "File")}
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3 overflow-y-auto flex-1">
          {kind === "url" && (
            <div>
              <label className="block font-mono text-[10px] tracking-[0.18em] uppercase text-ink-mute mb-1.5">URL</label>
              <Input
                autoFocus
                placeholder="https://example.com or YouTube link"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
              />
              <p className="font-serif italic text-[12.5px] text-ink-fade mt-1.5">YouTube URLs are auto-detected.</p>
            </div>
          )}

          {kind === "text" && (
            <>
              <div>
                <label className="block font-mono text-[10px] tracking-[0.18em] uppercase text-ink-mute mb-1.5">Title</label>
                <Input
                  autoFocus
                  placeholder="My notes"
                  value={textTitle}
                  onChange={(e) => setTextTitle(e.target.value)}
                />
              </div>
              <div>
                <label className="block font-mono text-[10px] tracking-[0.18em] uppercase text-ink-mute mb-1.5">Content</label>
                <textarea
                  placeholder="Paste text content…"
                  value={textContent}
                  onChange={(e) => setTextContent(e.target.value)}
                  rows={6}
                  className="w-full rounded-[1px] border border-rule bg-paper-light px-3 py-2 font-serif text-[14px] text-ink placeholder:text-ink-mute placeholder:italic focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink focus-visible:border-ink resize-none"
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
                className="w-full flex flex-col items-center justify-center gap-2 rounded-[2px] border border-dashed border-ink/40 bg-paper-light py-8 px-4 text-ink-fade hover:border-ink hover:text-ink hover:bg-paper-deep transition-colors"
              >
                <Upload className="h-6 w-6" />
                <span className="font-serif text-[14px]">
                  {pickedFile ? pickedFile.name : "Click to pick a file"}
                </span>
                {pickedFile && (
                  <span className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-mute">
                    {pickedFile.size > 1_000_000
                      ? `${(pickedFile.size / 1_000_000).toFixed(1)} MB`
                      : `${Math.round(pickedFile.size / 1000)} KB`}
                  </span>
                )}
              </button>
              <p className="font-serif italic text-[12.5px] text-ink-fade">
                Supported: PDF, DOCX, MD, TXT, EPUB, audio, video, images.
              </p>
            </>
          )}

          {error && (
            <div className="flex items-start gap-2 font-mono text-[11px] tracking-[0.08em] text-terracotta bg-vellum border border-terracotta/40 rounded-[1px] p-2.5">
              <AlertCircle className="h-4 w-4 shrink-0 mt-px" />
              <span className="break-words">{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-rule bg-paper-light">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button size="sm" onClick={handleAdd} disabled={submitting} className="gap-2 min-w-20 rounded-[1px]">
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
