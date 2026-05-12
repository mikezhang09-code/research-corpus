"use client";

import { useEffect, useRef, useState } from "react";
import { X, Search, Loader2, AlertCircle, Globe, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  startResearch,
  getResearchStatus,
  importResearchSources,
  type ResearchSource,
} from "@/lib/api";

const POLL_INTERVAL_MS = 2500;
const MAX_POLL_ATTEMPTS = 120; // 5 min for fast, longer for deep

type Phase = "input" | "searching" | "results" | "importing" | "done";

export function DiscoverSourcesModal({
  notebookId,
  onClose,
  onImported,
}: {
  notebookId: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("input");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"fast" | "deep">("fast");
  const [error, setError] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [foundQuery, setFoundQuery] = useState("");
  const [sources, setSources] = useState<ResearchSource[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importedCount, setImportedCount] = useState(0);
  const cancelRef = useRef(false);

  // Poll loop while searching
  useEffect(() => {
    if (phase !== "searching") return;
    cancelRef.current = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelRef.current) return;
      attempts++;
      try {
        const status = await getResearchStatus(notebookId);
        if (cancelRef.current) return;

        if (status.status === "completed" && status.task_id === taskId) {
          setSources(status.sources);
          setFoundQuery(status.query);
          // Default-select all results, like NotebookLM
          setSelected(new Set(status.sources.map((s) => s.url || s.title)));
          setPhase("results");
          return;
        }

        if (attempts >= MAX_POLL_ATTEMPTS) {
          setError("Research timed out. Try a simpler query or use fast mode.");
          setPhase("input");
          return;
        }
        timer = setTimeout(tick, POLL_INTERVAL_MS);
      } catch (e) {
        if (cancelRef.current) return;
        setError(e instanceof Error ? e.message : String(e));
        setPhase("input");
      }
    };
    tick();
    return () => {
      cancelRef.current = true;
      if (timer) clearTimeout(timer);
    };
  }, [phase, notebookId, taskId]);

  async function handleSearch() {
    const q = query.trim();
    if (!q) return;
    setError(null);
    setPhase("searching");
    try {
      const res = await startResearch(notebookId, { query: q, mode });
      setTaskId(res.task_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("input");
    }
  }

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(sources.map((s) => s.url || s.title)));
  }

  function selectNone() {
    setSelected(new Set());
  }

  async function handleImport() {
    if (!taskId) return;
    const picks = sources.filter((s) => selected.has(s.url || s.title));
    if (picks.length === 0) return;
    setPhase("importing");
    setError(null);
    try {
      await importResearchSources(notebookId, { task_id: taskId, sources: picks });
      setImportedCount(picks.length);
      setPhase("done");
      onImported();
      // Auto-close after a brief success state
      setTimeout(onClose, 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("results");
    }
  }

  const closable = phase !== "importing";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget && closable) onClose(); }}
    >
      <div className="bg-vellum rounded-[2px] border border-ink shadow-[4px_4px_0_rgb(42_36_24_/_0.18)] w-full max-w-2xl flex flex-col overflow-hidden max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-rule shrink-0">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-terracotta" />
            <h2 className="font-serif-display text-[22px] leading-tight tracking-tight text-ink">Discover sources</h2>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-ink-fade hover:text-ink" onClick={onClose} disabled={!closable}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
          {/* Query input — visible in input + searching phases */}
          {(phase === "input" || phase === "searching") && (
            <>
              <p className="font-serif italic text-[13.5px] text-ink-fade">
                Describe a topic and we&apos;ll search the web for sources to add to this notebook.
              </p>
              <Input
                placeholder="e.g. Liu Bang's leadership style"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && query.trim() && phase === "input") handleSearch(); }}
                disabled={phase === "searching"}
                autoFocus
              />
              <div className="flex items-center gap-3 font-mono text-[10px] tracking-[0.14em] uppercase">
                <span className="text-ink-mute">Mode:</span>
                <label className="inline-flex items-center gap-1.5 cursor-pointer text-ink-fade">
                  <input
                    type="radio"
                    checked={mode === "fast"}
                    onChange={() => setMode("fast")}
                    disabled={phase === "searching"}
                    className="h-3.5 w-3.5"
                  />
                  Fast (~10–30 s)
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer text-ink-fade">
                  <input
                    type="radio"
                    checked={mode === "deep"}
                    onChange={() => setMode("deep")}
                    disabled={phase === "searching"}
                    className="h-3.5 w-3.5"
                  />
                  Deep (~2–5 min)
                </label>
              </div>
              {phase === "searching" && (
                <div className="flex items-center gap-2 font-mono text-[11px] tracking-[0.1em] text-ink-fade bg-paper-light border border-rule rounded-[1px] p-3">
                  <Loader2 className="h-4 w-4 animate-spin text-terracotta shrink-0" />
                  <span>
                    Searching the web for &ldquo;{query.trim()}&rdquo;…
                    {mode === "deep" && " This can take a few minutes."}
                  </span>
                </div>
              )}
            </>
          )}

          {/* Results */}
          {(phase === "results" || phase === "importing") && (
            <>
              <div className="flex items-center justify-between">
                <p className="font-serif text-[13.5px] text-ink-soft">
                  Found <span className="text-ink font-semibold">{sources.length}</span> source{sources.length !== 1 ? "s" : ""} for <span className="italic">&ldquo;{foundQuery}&rdquo;</span>
                </p>
                <div className="flex gap-1.5">
                  <Button variant="ghost" size="sm" className="h-7 font-mono text-[10px] tracking-[0.14em] uppercase" onClick={selectAll} disabled={phase === "importing"}>
                    Select all
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 font-mono text-[10px] tracking-[0.14em] uppercase" onClick={selectNone} disabled={phase === "importing"}>
                    None
                  </Button>
                </div>
              </div>
              <div className="space-y-1.5">
                {sources.map((s, i) => {
                  const key = s.url || s.title;
                  const isChecked = selected.has(key);
                  return (
                    <label
                      key={i}
                      className={`flex items-start gap-3 rounded-[1px] border p-2.5 cursor-pointer transition-colors ${
                        isChecked ? "border-ink bg-paper-light" : "border-rule bg-vellum hover:bg-paper-light"
                      } ${phase === "importing" ? "opacity-60 pointer-events-none" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggle(key)}
                        className="mt-1 h-4 w-4 shrink-0"
                      />
                      <Globe className="h-4 w-4 text-ink-fade shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <p className="font-serif text-[14px] text-ink leading-tight truncate">{s.title || s.url}</p>
                        {s.url && (
                          <p className="font-mono text-[10px] tracking-[0.08em] text-ink-mute truncate mt-0.5">{s.url}</p>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            </>
          )}

          {/* Done */}
          {phase === "done" && (
            <div className="flex flex-col items-center justify-center py-8 gap-3 text-mint">
              <CheckCircle2 className="h-10 w-10" />
              <p className="font-serif-display text-[20px] tracking-tight">
                Imported {importedCount} source{importedCount !== 1 ? "s" : ""}
              </p>
            </div>
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
          {phase === "input" && (
            <>
              <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
              <Button size="sm" onClick={handleSearch} disabled={!query.trim()} className="gap-2 rounded-[1px]">
                <Search className="h-3.5 w-3.5" />
                Search
              </Button>
            </>
          )}
          {phase === "searching" && (
            <Button variant="outline" size="sm" onClick={() => { cancelRef.current = true; setPhase("input"); }} className="rounded-[1px]">
              Cancel search
            </Button>
          )}
          {phase === "results" && (
            <>
              <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
              <Button
                size="sm"
                onClick={handleImport}
                disabled={selected.size === 0}
                className="gap-2 rounded-[1px]"
              >
                Add {selected.size} source{selected.size !== 1 ? "s" : ""}
              </Button>
            </>
          )}
          {phase === "importing" && (
            <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.14em] uppercase text-ink-fade">
              <Loader2 className="h-4 w-4 animate-spin text-terracotta" />
              Importing…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
