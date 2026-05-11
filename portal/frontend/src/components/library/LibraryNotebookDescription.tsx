"use client";

import { useState } from "react";
import { Sparkles, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { updateLibraryNotebook } from "@/lib/api";

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
  const isDirty = text !== initialDescription;

  async function handleSave() {
    setSaving(true);
    try {
      await updateLibraryNotebook(notebookId, { description: text });
      onSave(text);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="Add a description for this notebook…"
        className="w-full resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <div className="flex items-center gap-2">
        {isDirty && (
          <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5">
            <Save className="h-3.5 w-3.5" />
            {saving ? "Saving…" : "Save"}
          </Button>
        )}
        <Button variant="outline" size="sm" disabled className="gap-1.5 text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" />
          Generate with AI
        </Button>
      </div>
    </div>
  );
}
