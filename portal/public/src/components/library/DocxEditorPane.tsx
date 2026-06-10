"use client";

// In-app Word (.docx) editor — wraps @eigenpal/docx-editor-react (ProseMirror
// + OOXML round-trip). Loads the document bytes from the content endpoint,
// edits in place, and saves by PUT-ing the serialized .docx back over the
// same R2 object, so the file keeps its id/url and viewers stay valid.
//
// Heavy dependency — always load this module lazily (next/dynamic, ssr:false)
// so the main bundle stays lean.

import { useEffect, useRef, useState } from "react";
import { DocxEditor, type DocxEditorRef } from "@eigenpal/docx-editor-react";
import "@eigenpal/docx-editor-react/styles.css";
import { Loader2, AlertCircle, Save, CheckCircle2 } from "lucide-react";
import { getLibraryFileBlob, replaceLibraryFileBytes } from "@/lib/api";

export default function DocxEditorPane({
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
  const [buffer, setBuffer] = useState<ArrayBuffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const editorRef = useRef<DocxEditorRef>(null);

  // The pane is mounted fresh per file (the modal unmounts it on close), so
  // initial state covers the reset; the effect only fills in async results.
  useEffect(() => {
    let cancelled = false;
    getLibraryFileBlob(notebookId, fileId)
      .then((buf) => { if (!cancelled) setBuffer(buf); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [notebookId, fileId]);

  async function upload(data: ArrayBuffer) {
    setSaving(true);
    setError(null);
    try {
      await replaceLibraryFileBytes(notebookId, fileId, data, `${title || "document"}.docx`);
      setSavedAt(Date.now());
      onSaved?.();
    } catch (e) {
      setError(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    if (saving) return;
    const data = await editorRef.current?.save();
    if (!data) {
      setError("Nothing to save yet — the document is still loading.");
      return;
    }
    await upload(data);
  }

  if (error && !buffer) {
    return (
      <div className="flex items-center gap-2 text-terracotta font-mono text-[11px] tracking-[0.1em] uppercase p-6">
        <AlertCircle className="h-4 w-4 shrink-0" /> {error}
      </div>
    );
  }
  if (!buffer) {
    return (
      <div className="flex items-center gap-2 text-ink-fade font-mono text-[11px] tracking-[0.1em] uppercase p-6">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading document…
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      {error && (
        <div className="flex items-center gap-2 text-terracotta font-mono text-[11px] tracking-[0.1em] uppercase px-4 py-2 border-b border-rule shrink-0">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}
      <DocxEditor
        ref={editorRef}
        documentBuffer={buffer}
        mode="editing"
        documentName={title}
        documentNameEditable={false}
        onSave={(data) => void upload(data)}
        onError={(e) => setError(e.message)}
        style={{ flex: 1, minHeight: 0 }}
        toolbarExtra={
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="ml-2 inline-flex items-center gap-1.5 h-8 px-3 rounded-[1px] border border-ink bg-ink text-paper font-mono text-[10px] tracking-[0.14em] uppercase hover:bg-ink-soft disabled:opacity-60 transition-colors"
          >
            {saving ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>
            ) : savedAt ? (
              <><CheckCircle2 className="h-3.5 w-3.5" /> Saved — save again</>
            ) : (
              <><Save className="h-3.5 w-3.5" /> Save</>
            )}
          </button>
        }
      />
    </div>
  );
}
