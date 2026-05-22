"use client";

import { useEffect, useRef, useState } from "react";
import { X, Loader2, Save, AlertCircle, Eye, Pencil } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  uploadLibraryNotebookFile, updateLibraryNotebookFile, saveLibraryNoteContent,
  getLibraryFileContent, type LibraryFile,
} from "@/lib/api";

// Create or edit a folio note. A note is just a Markdown file (file_category
// "note"); create uploads a new .md, edit overwrites the existing object.
export function NoteEditorModal({
  notebookId,
  file,
  onClose,
  onSaved,
}: {
  notebookId: string;
  file?: LibraryFile | null;
  onClose: () => void;
  onSaved: (file: LibraryFile) => void;
}) {
  const isEdit = !!file;
  const [title, setTitle] = useState(file?.title ?? "");
  const [body, setBody] = useState("");
  const initialBody = useRef("");
  const [loading, setLoading] = useState(isEdit);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edit mode: load the note's current text.
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    getLibraryFileContent(notebookId, file.id)
      .then((text) => {
        if (cancelled) return;
        setBody(text);
        initialBody.current = text;
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [file, notebookId]);

  const dirty = file
    ? title.trim() !== file.title || body !== initialBody.current
    : title.trim().length > 0 || body.length > 0;

  async function handleSave() {
    const t = title.trim();
    if (!t) { setError("Title is required"); return; }
    setSaving(true);
    setError(null);
    try {
      let result: LibraryFile;
      if (!file) {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const f = new File([body], `note-${stamp}.md`, { type: "text/markdown" });
        result = await uploadLibraryNotebookFile(notebookId, f, "note", t);
      } else {
        result = file;
        if (t !== file.title) {
          result = await updateLibraryNotebookFile(notebookId, file.id, { title: t });
        }
        if (body !== initialBody.current) {
          result = await saveLibraryNoteContent(notebookId, file.id, body);
        }
      }
      onSaved(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}
    >
      <div className="bg-vellum rounded-[2px] border border-ink shadow-[4px_4px_0_rgb(42_36_24_/_0.18)] w-full max-w-3xl max-h-[88vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-rule shrink-0">
          <h2 className="font-serif-display text-[22px] leading-tight tracking-tight text-ink">
            {isEdit ? "Edit note" : "New note"}
          </h2>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-ink-fade hover:text-ink" onClick={onClose} disabled={saving}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 flex flex-col gap-3 flex-1 min-h-0">
          <Input
            placeholder="Note title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={saving || loading}
            autoFocus={!isEdit}
            className="h-11 shrink-0"
          />

          <div className="flex items-center gap-1 shrink-0">
            <ToggleBtn active={!preview} onClick={() => setPreview(false)} icon={Pencil} label="Write" />
            <ToggleBtn active={preview} onClick={() => setPreview(true)} icon={Eye} label="Preview" />
            <span className="ml-auto font-mono text-[9px] tracking-[0.14em] uppercase text-ink-mute">
              Markdown
            </span>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-ink-fade font-mono text-[11px] tracking-[0.1em] uppercase py-8">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading note…
            </div>
          ) : preview ? (
            <div className="flex-1 min-h-[300px] overflow-y-auto rounded-[1px] border border-rule bg-paper px-4 py-3">
              {body.trim() ? (
                <div className="prose prose-sm max-w-none font-serif
                  prose-headings:font-serif-display prose-headings:tracking-tight prose-headings:text-ink
                  prose-p:leading-relaxed prose-p:text-ink-soft
                  prose-strong:text-ink prose-strong:font-semibold
                  prose-code:bg-paper-deep prose-code:px-1 prose-code:rounded-[1px] prose-code:text-[13px] prose-code:font-mono prose-code:text-ink
                  prose-a:text-terracotta prose-a:underline prose-a:underline-offset-2
                  prose-blockquote:border-l-2 prose-blockquote:border-terracotta prose-blockquote:pl-4 prose-blockquote:text-ink-fade prose-blockquote:italic">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
                </div>
              ) : (
                <p className="font-serif italic text-[13px] text-ink-mute">Nothing to preview yet.</p>
              )}
            </div>
          ) : (
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={saving}
              placeholder="Write your note in Markdown…"
              className="flex-1 min-h-[300px] resize-none rounded-[1px] border border-rule bg-paper px-4 py-3 font-mono text-[13px] leading-relaxed text-ink placeholder:text-ink-mute placeholder:italic focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink focus-visible:border-ink disabled:opacity-60"
            />
          )}

          {error && (
            <div className="flex items-start gap-2 font-mono text-[11px] tracking-[0.08em] text-terracotta bg-vellum border border-terracotta/40 rounded-[1px] p-2.5 shrink-0">
              <AlertCircle className="h-4 w-4 shrink-0 mt-px" />
              <span className="break-words">{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-rule bg-paper-light shrink-0">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || loading || !title.trim() || !dirty}
            className="gap-2 min-w-24 rounded-[1px]"
          >
            {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</> : <><Save className="h-3.5 w-3.5" /> Save</>}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ToggleBtn({ active, onClick, icon: Icon, label }: {
  active: boolean; onClick: () => void; icon: React.ElementType; label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[1px] border font-mono text-[10px] tracking-[0.14em] uppercase transition-colors ${
        active
          ? "bg-ink text-paper border-ink"
          : "bg-vellum text-ink-fade border-rule hover:border-ink hover:text-ink"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
