"use client";

import { useEffect, useRef, useState } from "react";
import {
  X, Loader2, Save, AlertCircle, Eye, Pencil,
  Bold, Italic, Strikethrough, Heading2, TextQuote, List, ListTodo,
  Link, Code, SquareCode, Table, Sigma, Workflow,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import { markdownRemarkPlugins, markdownRehypePlugins, markdownCodeComponents } from "@/components/markdown/markdown-extras";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ExpandButton, EXPANDED_MODAL } from "@/components/corpus/Expandable";
import {
  uploadLibraryNotebookFile, updateLibraryNotebookFile, saveLibraryNoteContent,
  uploadFreeFormFile, updateFreeFormFile, saveFreeFormNoteContent,
  getLibraryFileContent, type LibraryFile,
} from "@/lib/api";

// Formatting toolbar: pure data, applied by applyTool inside the component.
// "wrap" surrounds the selection inline, "prefix" prepends each selected
// line, "block" inserts a snippet on its own lines built from the selection.
type ToolAction =
  | { kind: "wrap"; before: string; after: string; placeholder: string }
  | { kind: "prefix"; prefix: string; placeholder: string }
  | { kind: "block"; build: (selected: string) => string };

const TOOLBAR: ([string, React.ElementType, ToolAction] | "|")[] = [
  ["Bold", Bold, { kind: "wrap", before: "**", after: "**", placeholder: "bold" }],
  ["Italic", Italic, { kind: "wrap", before: "*", after: "*", placeholder: "italic" }],
  ["Strikethrough", Strikethrough, { kind: "wrap", before: "~~", after: "~~", placeholder: "deleted" }],
  "|",
  ["Heading", Heading2, { kind: "prefix", prefix: "## ", placeholder: "Heading" }],
  ["Quote", TextQuote, { kind: "prefix", prefix: "> ", placeholder: "quote" }],
  ["Bullet list", List, { kind: "prefix", prefix: "- ", placeholder: "item" }],
  ["Task list", ListTodo, { kind: "prefix", prefix: "- [ ] ", placeholder: "task" }],
  "|",
  ["Link", Link, { kind: "wrap", before: "[", after: "](url)", placeholder: "link text" }],
  ["Inline code", Code, { kind: "wrap", before: "`", after: "`", placeholder: "code" }],
  "|",
  ["Code block", SquareCode, { kind: "block", build: (sel) => "```python\n" + (sel || "code") + "\n```" }],
  ["Table", Table, { kind: "block", build: () => "| Column | Column |\n| --- | --- |\n| cell | cell |" }],
  ["Math (KaTeX)", Sigma, { kind: "block", build: (sel) => "$$\n" + (sel || "e = mc^2") + "\n$$" }],
  ["Mermaid diagram", Workflow, { kind: "block", build: () => "```mermaid\ngraph TD\n  A[Start] --> B[Finish]\n```" }],
];

// Create or edit a folio or free-form note. A note is just a Markdown file
// (file_category "note"); create uploads a new .md, edit overwrites the
// existing object. `notebookId: null` targets the free-forms endpoints.
export function NoteEditorModal<T extends { id: string; title: string } = LibraryFile>({
  notebookId,
  file,
  onClose,
  onSaved,
}: {
  /** Folio id, or null for a free-form note. */
  notebookId: string | null;
  file?: T | null;
  onClose: () => void;
  onSaved: (file: T) => void;
}) {
  const isEdit = !!file;
  const [title, setTitle] = useState(file?.title ?? "");
  const [body, setBody] = useState("");
  const initialBody = useRef("");
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [loading, setLoading] = useState(isEdit);
  const [preview, setPreview] = useState(false);
  const [expanded, setExpanded] = useState(false);
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

  // Closing must never silently discard typed work (backdrop clicks are easy
  // to hit by accident).
  function requestClose() {
    if (saving) return;
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    onClose();
  }

  // Applies a TOOLBAR action to the textarea at the current selection and
  // restores focus afterwards (toolbar buttons preventDefault on mousedown so
  // the selection survives the click). Event-handler only — never in render.
  function applyTool(action: ToolAction) {
    const ta = bodyRef.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e } = ta;
    const selected = body.slice(s, e);
    let insert: string;
    let selectFrom: number;
    let selectTo: number;
    if (action.kind === "wrap") {
      const inner = selected || action.placeholder;
      insert = action.before + inner + action.after;
      selectFrom = s + action.before.length;
      selectTo = selectFrom + inner.length;
    } else if (action.kind === "prefix") {
      insert = (selected || action.placeholder).split("\n").map((l) => action.prefix + l).join("\n");
      selectFrom = s;
      selectTo = s + insert.length;
    } else {
      insert = `${s > 0 && body[s - 1] !== "\n" ? "\n\n" : ""}${action.build(selected)}\n`;
      selectFrom = selectTo = s + insert.length;
    }
    setBody(body.slice(0, s) + insert + body.slice(e));
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(selectFrom, selectTo);
    });
  }

  async function handleSave() {
    const t = title.trim();
    if (!t) { setError("Title is required"); return; }
    setSaving(true);
    setError(null);
    try {
      let result: T;
      if (!file) {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const f = new File([body], `note-${stamp}.md`, { type: "text/markdown" });
        result = (notebookId
          ? await uploadLibraryNotebookFile(notebookId, f, "note", t)
          : await uploadFreeFormFile(f, "note", t)) as unknown as T;
      } else {
        result = file;
        if (t !== file.title) {
          result = (notebookId
            ? await updateLibraryNotebookFile(notebookId, file.id, { title: t })
            : await updateFreeFormFile(file.id, { title: t })) as unknown as T;
        }
        if (body !== initialBody.current) {
          result = (notebookId
            ? await saveLibraryNoteContent(notebookId, file.id, body)
            : await saveFreeFormNoteContent(file.id, body)) as unknown as T;
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
      onClick={(e) => { if (e.target === e.currentTarget) requestClose(); }}
    >
      <div className={`bg-vellum rounded-[2px] border border-ink shadow-[4px_4px_0_rgb(42_36_24_/_0.18)] w-full ${expanded ? EXPANDED_MODAL : "max-w-3xl max-h-[88vh]"} flex flex-col overflow-hidden`}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-rule shrink-0">
          <h2 className="font-serif-display text-[22px] leading-tight tracking-tight text-ink">
            {isEdit ? "Edit note" : "New note"}
          </h2>
          <div className="flex items-center gap-1 shrink-0">
            <ExpandButton expanded={expanded} onToggle={() => setExpanded(!expanded)} />
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-ink-fade hover:text-ink" onClick={requestClose} disabled={saving}>
              <X className="h-4 w-4" />
            </Button>
          </div>
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

          {!preview && !loading && (
            <div className="flex items-center gap-0.5 flex-wrap shrink-0 border border-rule rounded-[1px] bg-paper-light px-1.5 py-1">
              {TOOLBAR.map((entry, i) =>
                entry === "|" ? (
                  <span key={`sep-${i}`} className="w-px h-4 bg-rule mx-1" />
                ) : (
                  <ToolBtn key={entry[0]} label={entry[0]} icon={entry[1]} onClick={() => applyTool(entry[2])} disabled={saving} />
                )
              )}
            </div>
          )}

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
                  <ReactMarkdown
                    remarkPlugins={markdownRemarkPlugins}
                    rehypePlugins={markdownRehypePlugins}
                    components={markdownCodeComponents}
                  >
                    {body}
                  </ReactMarkdown>
                </div>
              ) : (
                <p className="font-serif italic text-[13px] text-ink-mute">Nothing to preview yet.</p>
              )}
            </div>
          ) : (
            <textarea
              ref={bodyRef}
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
          <Button variant="ghost" size="sm" onClick={requestClose} disabled={saving}>Cancel</Button>
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

function ToolBtn({ label, icon: Icon, onClick, disabled }: {
  label: string; icon: React.ElementType; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      // Keep the textarea's focus/selection through the click.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="h-7 w-7 inline-flex items-center justify-center rounded-[1px] text-ink-fade hover:text-ink hover:bg-paper-deep transition-colors disabled:opacity-40"
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
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
