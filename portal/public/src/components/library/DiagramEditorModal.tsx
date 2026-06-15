"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  X, Loader2, Save, AlertCircle, Copy, Download,
  Image as ImageIcon, TriangleAlert, ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ExpandButton, EXPANDED_MODAL } from "@/components/corpus/Expandable";
import { loadMermaid } from "@/lib/mermaid";
import { copyTextToClipboard } from "@/lib/clipboard";
import {
  uploadLibraryNotebookFile, updateLibraryNotebookFile, saveLibraryNoteContent,
  uploadFreeFormFile, updateFreeFormFile, saveFreeFormNoteContent,
  getLibraryFileContent, type LibraryFile,
} from "@/lib/api";

const STARTER = `flowchart TD
    A[Start] --> B{Decision?}
    B -->|yes| C[Do thing]
    B -->|no| D[Other thing]
    C --> E[End]
    D --> E`;

const TEMPLATES: { label: string; code: string }[] = [
  { label: "Flowchart", code: STARTER },
  {
    label: "Sequence",
    code: `sequenceDiagram
    participant U as User
    participant API
    participant DB
    U->>API: request
    API->>DB: query
    DB-->>API: rows
    API-->>U: response`,
  },
  {
    label: "State",
    code: `stateDiagram-v2
    [*] --> Draft
    Draft --> Review: submit
    Review --> Draft: changes
    Review --> Published: approve
    Published --> [*]`,
  },
  {
    label: "Class",
    code: `classDiagram
    class Item {
      +string id
      +string title
    }
    class Tag
    Item "1" --> "*" Tag`,
  },
];

// Create or edit a folio or free-form diagram. A diagram is a raw Mermaid file
// (file_category "diagram", .mmd). `notebookId: null` targets free-forms.
// The public viewer has no AI assistant, so this is a plain text-first editor.
export function DiagramEditorModal<T extends { id: string; title: string } = LibraryFile>({
  notebookId,
  file,
  onClose,
  onSaved,
}: {
  notebookId: string | null;
  file?: T | null;
  onClose: () => void;
  onSaved: (file: T) => void;
}) {
  const isEdit = !!file;
  const [title, setTitle] = useState(file?.title ?? "");
  const [code, setCode] = useState(isEdit ? "" : STARTER);
  const [initialCode, setInitialCode] = useState(isEdit ? "" : STARTER);
  const [loading, setLoading] = useState(isEdit);
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [svg, setSvg] = useState("");
  const [renderError, setRenderError] = useState<string | null>(null);
  const renderSeq = useRef(0);

  const [copied, setCopied] = useState(false);

  // Edit mode: load the diagram's current source.
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    getLibraryFileContent(notebookId, file.id)
      .then((text) => {
        if (cancelled) return;
        setCode(text);
        setInitialCode(text);
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [file, notebookId]);

  // Debounced live render.
  useEffect(() => {
    if (loading) return;
    const handle = setTimeout(async () => {
      const seq = ++renderSeq.current;
      const trimmed = code.trim();
      if (!trimmed) { setSvg(""); setRenderError(null); return; }
      try {
        const mermaid = await loadMermaid();
        await mermaid.parse(trimmed);
        const { svg: out } = await mermaid.render(`dgm-edit-${seq}`, trimmed);
        if (seq === renderSeq.current) { setSvg(out); setRenderError(null); }
      } catch (err) {
        if (seq === renderSeq.current) setRenderError(err instanceof Error ? err.message : String(err));
        document.getElementById(`dgm-edit-${seq}`)?.remove();
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [code, loading]);

  const dirty = file
    ? title.trim() !== file.title || code !== initialCode
    : title.trim().length > 0 || code !== STARTER;

  function requestClose() {
    if (saving) return;
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    onClose();
  }

  const copyCode = useCallback(async () => {
    if (await copyTextToClipboard(code)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [code]);

  function download(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  }
  function downloadSvg() {
    if (svg) download(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), "diagram.svg");
  }
  function downloadPng() {
    if (!svg) return;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = (img.naturalWidth || 800) * scale;
      canvas.height = (img.naturalHeight || 600) * scale;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((b) => b && download(b, "diagram.png"), "image/png");
      }
      URL.revokeObjectURL(url);
    };
    img.src = url;
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
        const f = new File([code], `diagram-${stamp}.mmd`, { type: "text/vnd.mermaid" });
        result = (notebookId
          ? await uploadLibraryNotebookFile(notebookId, f, "diagram", t)
          : await uploadFreeFormFile(f, "diagram", t)) as unknown as T;
      } else {
        result = file;
        if (t !== file.title) {
          result = (notebookId
            ? await updateLibraryNotebookFile(notebookId, file.id, { title: t })
            : await updateFreeFormFile(file.id, { title: t })) as unknown as T;
        }
        if (code !== initialCode) {
          result = (notebookId
            ? await saveLibraryNoteContent(notebookId, file.id, code)
            : await saveFreeFormNoteContent(file.id, code)) as unknown as T;
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
      <div className={`bg-vellum rounded-[2px] border border-ink shadow-[4px_4px_0_rgb(42_36_24_/_0.18)] w-full ${expanded ? EXPANDED_MODAL : "max-w-5xl max-h-[90vh]"} flex flex-col overflow-hidden`}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-rule shrink-0">
          <h2 className="font-serif-display text-[22px] leading-tight tracking-tight text-ink">
            {isEdit ? "Edit diagram" : "New diagram"}
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
            placeholder="Diagram title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={saving || loading}
            autoFocus={!isEdit}
            className="h-11 shrink-0"
          />

          {loading ? (
            <div className="flex items-center gap-2 text-ink-fade font-mono text-[11px] tracking-[0.1em] uppercase py-8">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading diagram…
            </div>
          ) : (
            <div className="grid gap-3 flex-1 min-h-0 md:grid-cols-2">
              {/* Source */}
              <div className="flex flex-col min-h-[280px]">
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-mono text-[9px] tracking-[0.14em] uppercase text-ink-mute">Mermaid source</span>
                  <div className="flex items-center gap-1">
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button variant="ghost" size="xs" className="gap-1 rounded-[1px]" />}>
                        Template <ChevronDown className="h-3 w-3 opacity-60" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {TEMPLATES.map((t) => (
                          <DropdownMenuItem key={t.label} onClick={() => setCode(t.code)}>{t.label}</DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Button variant="ghost" size="xs" className="gap-1 rounded-[1px]" onClick={copyCode}>
                      <Copy className="h-3 w-3" /> {copied ? "Copied" : "Copy"}
                    </Button>
                  </div>
                </div>
                <textarea
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  spellCheck={false}
                  disabled={saving}
                  className="flex-1 min-h-[240px] resize-none rounded-[1px] border border-rule bg-paper px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink"
                />
              </div>

              {/* Preview */}
              <div className="flex flex-col min-h-[280px]">
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-mono text-[9px] tracking-[0.14em] uppercase text-ink-mute">Preview</span>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="xs" className="gap-1 rounded-[1px]" onClick={downloadSvg} disabled={!svg}>
                      <Download className="h-3 w-3" /> SVG
                    </Button>
                    <Button variant="ghost" size="xs" className="gap-1 rounded-[1px]" onClick={downloadPng} disabled={!svg}>
                      <ImageIcon className="h-3 w-3" /> PNG
                    </Button>
                  </div>
                </div>
                <div className="relative flex-1 min-h-[240px] overflow-auto rounded-[1px] border border-rule bg-white p-3">
                  {renderError && (
                    <div className="absolute inset-x-0 top-0 z-10 flex items-start gap-1.5 border-b border-terracotta/30 bg-terracotta/10 px-2.5 py-1.5 font-mono text-[10px] text-terracotta">
                      <TriangleAlert className="mt-px h-3 w-3 shrink-0" />
                      <span className="break-words">{renderError}</span>
                    </div>
                  )}
                  {svg ? (
                    <div className="[&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />
                  ) : (
                    !renderError && <p className="pt-8 text-center font-serif italic text-[13px] text-ink-mute">Diagram preview</p>
                  )}
                </div>
              </div>
            </div>
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
