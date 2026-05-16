"use client";

import { useState } from "react";
import { Sparkles, Save, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateLibraryNotebookDescription, updateLibraryNotebook } from "@/lib/api";
import { useLanguage } from "@/hooks/use-language";

export function LibraryNotebookDescription({
  notebookId,
  initialDescription,
  onSave,
}: {
  notebookId: string;
  initialDescription: string;
  onSave: (desc: string) => void;
}) {
  const [text, setText] = useState(initialDescription);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [language] = useLanguage();
  const isDirty = text !== initialDescription;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await updateLibraryNotebook(notebookId, { description: text });
      onSave(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await generateLibraryNotebookDescription(notebookId, language);
      // Fill the textarea so the user can review and edit, then click Save.
      setText(res.description);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="Add a description for this folio…"
        disabled={generating}
        className="w-full resize-none rounded-[1px] border border-rule bg-vellum px-3 py-2 font-serif text-[14px] text-ink-soft placeholder:text-ink-mute placeholder:italic focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink focus-visible:border-ink disabled:opacity-60"
      />
      <div className="flex items-center gap-2">
        {isDirty && (
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || generating}
            className="gap-1.5 rounded-[1px]"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {saving ? "Saving…" : "Save"}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={handleGenerate}
          disabled={generating || saving}
          className="gap-1.5 rounded-[1px]"
          title="Draft a 2–3 sentence description from the folio's files. You can edit before saving."
        >
          {generating
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <Sparkles className="h-3.5 w-3.5" />}
          {generating ? "Generating…" : "Generate with AI"}
        </Button>
        {error && (
          <span className="inline-flex items-center gap-1 font-mono text-[10px] tracking-[0.1em] text-terracotta">
            <AlertCircle className="h-3 w-3" />
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
