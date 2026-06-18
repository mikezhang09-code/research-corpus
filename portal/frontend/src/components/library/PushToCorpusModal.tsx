"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowUpRight, Check, Loader2, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  getNotebooks, pushFolioToCorpus,
  type LibraryFile, type Notebook, type PushFileResult,
} from "@/lib/api";

// Folio categories NotebookLM accepts as sources. Mirrors the backend
// `_NLM_SOURCE_CATEGORIES` so we can warn before the round-trip. Keep in sync.
const TRANSFERABLE = new Set(["report", "note", "slide", "image", "audio"]);

type Target = "new" | "existing";

export function PushToCorpusModal({
  notebookId,
  files,
  onClose,
  onPushed,
}: {
  notebookId: string;
  files: LibraryFile[];
  onClose: () => void;
  onPushed?: () => void;
}) {
  const router = useRouter();
  const [target, setTarget] = useState<Target>("new");
  const [title, setTitle] = useState("");
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [existingId, setExistingId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<PushFileResult[] | null>(null);
  const [pushedNotebookId, setPushedNotebookId] = useState<string | null>(null);

  const transferable = useMemo(
    () => files.filter((f) => TRANSFERABLE.has(f.file_category)).length,
    [files],
  );
  const skipped = files.length - transferable;

  useEffect(() => {
    void getNotebooks().then((nbs) => {
      setNotebooks(nbs);
      if (nbs.length > 0) setExistingId(nbs[0].id);
    }).catch(() => { /* target picker just stays empty; "New" still works */ });
  }, []);

  const canSubmit =
    !submitting &&
    files.length > 0 &&
    (target === "new" ? title.trim().length > 0 : existingId.length > 0);

  async function handlePush() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await pushFolioToCorpus(notebookId, {
        file_ids: files.map((f) => f.id),
        target_notebook_id: target === "existing" ? existingId : null,
        new_title: target === "new" ? title.trim() : null,
      });
      setResults(res.results);
      setPushedNotebookId(res.notebook_id);
      onPushed?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  const pushedCount = results?.filter((r) => r.status === "pushed").length ?? 0;
  const errorCount = results?.filter((r) => r.status === "error").length ?? 0;

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !submitting) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-serif-display text-[22px] tracking-tight">
            Push to NotebookLM
          </DialogTitle>
        </DialogHeader>

        {results ? (
          // ---- Results view ----
          <div className="space-y-3">
            <p className="font-mono text-[11px] tracking-[0.10em] uppercase text-ink-fade">
              {pushedCount} pushed · {skippedLabel(results)} skipped
              {errorCount > 0 ? ` · ${errorCount} failed` : ""}
            </p>
            <ul className="max-h-64 overflow-y-auto space-y-1.5 border border-rule rounded-[2px] p-2 bg-paper-light">
              {results.map((r) => (
                <li key={r.file_id} className="flex items-start gap-2 text-[12px]">
                  <ResultIcon status={r.status} />
                  <span className="flex-1 min-w-0">
                    <span className="font-medium text-ink break-words">{r.title}</span>
                    {r.reason && (
                      <span className="block font-mono text-[10px] tracking-[0.06em] text-ink-mute break-words">
                        {r.reason}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <DialogFooter>
              {pushedNotebookId && pushedCount > 0 && (
                <Button
                  variant="outline"
                  onClick={() => router.push(`/notebooklm/${pushedNotebookId}`)}
                  className="gap-1.5"
                >
                  <ArrowUpRight className="h-4 w-4" />
                  Open notebook
                </Button>
              )}
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          // ---- Setup view ----
          <div className="space-y-4">
            <p className="font-mono text-[10px] tracking-[0.12em] uppercase text-ink-mute">
              {transferable} of {files.length} file{files.length !== 1 ? "s" : ""} will transfer
              {skipped > 0 ? ` · ${skipped} unsupported (skipped)` : ""}.
            </p>

            <div className="flex gap-2">
              {(["new", "existing"] as Target[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTarget(t)}
                  disabled={t === "existing" && notebooks.length === 0}
                  className={`flex-1 px-3 py-2 rounded-[1px] font-mono text-[10px] tracking-[0.14em] uppercase border transition-colors disabled:opacity-40 ${
                    target === t
                      ? "bg-ink text-paper border-ink"
                      : "bg-vellum text-ink-fade border-rule hover:border-ink hover:text-ink"
                  }`}
                >
                  {t === "new" ? "New notebook" : "Existing notebook"}
                </button>
              ))}
            </div>

            {target === "new" ? (
              <div className="space-y-2">
                <label className="font-mono text-[10px] tracking-[0.18em] uppercase text-ink-mute">
                  Notebook title
                </label>
                <Input
                  autoFocus
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handlePush(); } }}
                  placeholder="Research notebook"
                  disabled={submitting}
                  className="h-11"
                />
              </div>
            ) : (
              <div className="space-y-2">
                <label className="font-mono text-[10px] tracking-[0.18em] uppercase text-ink-mute">
                  Target notebook
                </label>
                <select
                  value={existingId}
                  onChange={(e) => setExistingId(e.target.value)}
                  disabled={submitting}
                  className="h-11 w-full rounded-[1px] border border-rule bg-vellum px-3 text-[13px] text-ink focus:border-ink focus:outline-none"
                >
                  {notebooks.map((nb) => (
                    <option key={nb.id} value={nb.id}>
                      {nb.title} ({nb.sources_count} source{nb.sources_count !== 1 ? "s" : ""})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 font-mono text-[11px] tracking-[0.08em] text-terracotta bg-vellum border border-terracotta/40 rounded-[1px] p-2.5">
                <AlertCircle className="h-4 w-4 shrink-0 mt-px" />
                <span className="break-words">{error}</span>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
              <Button onClick={handlePush} disabled={!canSubmit} className="gap-1.5">
                {submitting
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Pushing…</>
                  : <><ArrowUpRight className="h-4 w-4" /> Push {transferable} file{transferable !== 1 ? "s" : ""}</>}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function skippedLabel(results: PushFileResult[]): number {
  return results.filter((r) => r.status === "skipped").length;
}

function ResultIcon({ status }: { status: PushFileResult["status"] }) {
  if (status === "pushed") return <Check className="h-4 w-4 shrink-0 mt-px text-sage" />;
  if (status === "error") return <AlertCircle className="h-4 w-4 shrink-0 mt-px text-terracotta" />;
  return <Minus className="h-4 w-4 shrink-0 mt-px text-ink-mute" />;
}
