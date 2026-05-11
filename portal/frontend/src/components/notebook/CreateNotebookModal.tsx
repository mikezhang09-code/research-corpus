"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  X, Loader2, AlertCircle, Plus, Link2, FileText, Upload, Globe, Music,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createNotebook, addSourceUrl, addSourceText, addSourceFile,
} from "@/lib/api";
import { EmojiPicker } from "./EmojiPicker";
import { randomEmoji } from "./emoji";

type QueuedSource =
  | { kind: "url"; url: string }
  | { kind: "text"; title: string; content: string }
  | { kind: "file"; file: File };

type ActiveForm = null | "url" | "text" | "file";

function formatBytes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  if (n >= 1_000) return `${Math.round(n / 1_000)} KB`;
  return `${n} B`;
}

export function CreateNotebookModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [title, setTitle] = useState("");
  const [emoji, setEmoji] = useState<string>(() => randomEmoji());
  const [queued, setQueued] = useState<QueuedSource[]>([]);
  const [active, setActive] = useState<ActiveForm>(null);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<{ idx: number; total: number; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Inline form state
  const [urlInput, setUrlInput] = useState("");
  const [textTitle, setTextTitle] = useState("");
  const [textContent, setTextContent] = useState("");

  function resetActive() {
    setActive(null);
    setUrlInput("");
    setTextTitle("");
    setTextContent("");
  }

  function addUrl() {
    const u = urlInput.trim();
    if (!u) return;
    setQueued((q) => [...q, { kind: "url", url: u }]);
    resetActive();
  }
  function addText() {
    if (!textTitle.trim() || !textContent.trim()) return;
    setQueued((q) => [...q, { kind: "text", title: textTitle.trim(), content: textContent }]);
    resetActive();
  }
  function addFiles(files: FileList | null) {
    if (!files) return;
    const list = Array.from(files);
    setQueued((q) => [...q, ...list.map((f): QueuedSource => ({ kind: "file", file: f }))]);
    resetActive();
  }
  function removeAt(idx: number) {
    setQueued((q) => q.filter((_, i) => i !== idx));
  }

  async function handleCreate() {
    if (!title.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const nb = await createNotebook({ title: title.trim(), cover_emoji: emoji });
      for (let i = 0; i < queued.length; i++) {
        const s = queued[i];
        const label =
          s.kind === "url" ? s.url
          : s.kind === "text" ? s.title
          : s.file.name;
        setProgress({ idx: i + 1, total: queued.length, label });
        try {
          if (s.kind === "url") await addSourceUrl(nb.id, s.url);
          else if (s.kind === "text") await addSourceText(nb.id, s.title, s.content);
          else await addSourceFile(nb.id, s.file);
        } catch (e) {
          // Don't abort the whole flow on a single source failure
          console.error(`Failed to add source ${label}:`, e);
        }
      }
      router.push(`/notebooklm/${nb.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
      setProgress(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}
    >
      <div className="bg-vellum rounded-[2px] border border-ink shadow-[4px_4px_0_rgb(42_36_24_/_0.18)] w-full max-w-lg flex flex-col overflow-hidden max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-rule shrink-0">
          <h2 className="font-serif-display text-[22px] leading-tight tracking-tight text-ink">
            New notebook <span className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-mute ml-1">— {step}/2</span>
          </h2>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-ink-fade hover:text-ink" onClick={onClose} disabled={submitting}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
          {step === 1 && (
            <>
              <label className="block font-mono text-[10px] tracking-[0.18em] uppercase text-ink-mute mb-2">Cover &amp; title</label>
              <div className="flex items-start gap-2">
                <EmojiPicker value={emoji} onChange={setEmoji} />
                <Input
                  autoFocus
                  placeholder="My Research"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && title.trim()) setStep(2); }}
                  className="h-12"
                />
              </div>
            </>
          )}

          {step === 2 && (
            <>
              {/* Add buttons */}
              <div className="flex gap-2 flex-wrap">
                <Button
                  variant={active === "url" ? "default" : "outline"}
                  size="sm" className="gap-1.5"
                  onClick={() => setActive(active === "url" ? null : "url")}
                  disabled={submitting}
                >
                  <Link2 className="h-3.5 w-3.5" /> URL
                </Button>
                <Button
                  variant={active === "text" ? "default" : "outline"}
                  size="sm" className="gap-1.5"
                  onClick={() => setActive(active === "text" ? null : "text")}
                  disabled={submitting}
                >
                  <FileText className="h-3.5 w-3.5" /> Text
                </Button>
                <Button
                  variant={active === "file" ? "default" : "outline"}
                  size="sm" className="gap-1.5"
                  onClick={() => {
                    if (active === "file") setActive(null);
                    else {
                      setActive("file");
                      // Trigger native file picker once
                      const input = document.createElement("input");
                      input.type = "file";
                      input.multiple = true;
                      input.onchange = (e) => {
                        addFiles((e.target as HTMLInputElement).files);
                      };
                      input.click();
                    }
                  }}
                  disabled={submitting}
                >
                  <Upload className="h-3.5 w-3.5" /> File
                </Button>
              </div>

              {/* Inline forms */}
              {active === "url" && (
                <div className="space-y-2 rounded-[1px] border border-rule p-3 bg-paper-light">
                  <Input
                    placeholder="https://example.com or YouTube link"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") addUrl(); }}
                    autoFocus
                  />
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={resetActive}>Cancel</Button>
                    <Button size="sm" onClick={addUrl} disabled={!urlInput.trim()}>Add</Button>
                  </div>
                </div>
              )}

              {active === "text" && (
                <div className="space-y-2 rounded-[1px] border border-rule p-3 bg-paper-light">
                  <Input
                    placeholder="Title"
                    value={textTitle}
                    onChange={(e) => setTextTitle(e.target.value)}
                    autoFocus
                  />
                  <textarea
                    placeholder="Paste text content here…"
                    value={textContent}
                    onChange={(e) => setTextContent(e.target.value)}
                    rows={5}
                    className="w-full rounded-[1px] border border-rule bg-vellum px-3 py-2 font-serif text-[14px] text-ink placeholder:text-ink-mute placeholder:italic focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink focus-visible:border-ink resize-none"
                  />
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={resetActive}>Cancel</Button>
                    <Button size="sm" onClick={addText} disabled={!textTitle.trim() || !textContent.trim()}>Add</Button>
                  </div>
                </div>
              )}

              {/* Queue */}
              {queued.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-ink-mute">
                    {queued.length} source{queued.length !== 1 ? "s" : ""} queued
                  </p>
                  {queued.map((s, i) => (
                    <QueuedRow key={i} source={s} onRemove={() => removeAt(i)} disabled={submitting} />
                  ))}
                </div>
              ) : (
                <p className="font-serif italic text-center text-[13px] text-ink-fade py-4">
                  No sources yet. Add at least one URL, text snippet, or file.
                </p>
              )}

              {progress && (
                <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.14em] uppercase text-ink-fade bg-vellum border border-rule rounded-[1px] p-2.5">
                  <Loader2 className="h-4 w-4 animate-spin text-terracotta shrink-0" />
                  <span className="truncate">
                    Adding {progress.idx} of {progress.total}: {progress.label}
                  </span>
                </div>
              )}
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
          {step === 1 ? (
            <>
              <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
              <Button size="sm" onClick={() => setStep(2)} disabled={!title.trim()}>
                Next
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={() => setStep(1)} disabled={submitting}>
                Back
              </Button>
              <Button size="sm" onClick={handleCreate} disabled={submitting} className="gap-2 min-w-24">
                {submitting ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Creating…</>
                ) : (
                  <><Plus className="h-3.5 w-3.5" /> Create</>
                )}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function QueuedRow({ source, onRemove, disabled }: {
  source: QueuedSource; onRemove: () => void; disabled: boolean;
}) {
  let Icon = Globe;
  let primary = "";
  let meta = "";
  if (source.kind === "url") {
    const isYoutube = /youtu\.?be/.test(source.url);
    Icon = isYoutube ? Music : Globe;
    primary = source.url;
    meta = isYoutube ? "YouTube" : "URL";
  } else if (source.kind === "text") {
    Icon = FileText;
    primary = source.title;
    meta = `${source.content.length} chars`;
  } else {
    Icon = Upload;
    primary = source.file.name;
    meta = formatBytes(source.file.size);
  }
  return (
    <div className="flex items-center gap-2.5 rounded-[1px] border border-rule bg-vellum px-2.5 py-1.5">
      <Icon className="h-4 w-4 text-ink-fade shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-serif text-[13.5px] text-ink truncate">{primary}</p>
        <p className="font-mono text-[9px] tracking-[0.14em] uppercase text-ink-mute">{meta}</p>
      </div>
      <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-ink-fade hover:text-terracotta" onClick={onRemove} disabled={disabled}>
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
