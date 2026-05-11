"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X, Loader2, Plus, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createLibraryNotebook } from "@/lib/api";
import { EmojiPicker } from "@/components/notebook/EmojiPicker";
import { randomEmoji } from "@/components/notebook/emoji";

export function CreateLibraryNotebookModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [emoji, setEmoji] = useState<string>(() => randomEmoji());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (!title.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const nb = await createLibraryNotebook({ title: title.trim(), cover_emoji: emoji });
      router.push(`/library/${nb.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}
    >
      <div className="bg-background rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b shrink-0">
          <h2 className="font-semibold text-base">New library notebook</h2>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClose} disabled={submitting}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <label className="block text-xs font-medium mb-1.5">Cover &amp; title</label>
          <div className="flex items-start gap-2">
            <EmojiPicker value={emoji} onChange={setEmoji} />
            <Input
              autoFocus
              placeholder="Research for AI Development"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && title.trim()) handleCreate(); }}
              className="h-12"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 text-destructive text-xs bg-destructive/5 border border-destructive/20 rounded-md p-2.5">
              <AlertCircle className="h-4 w-4 shrink-0 mt-px" />
              <span className="break-words">{error}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t bg-muted/30">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button size="sm" onClick={handleCreate} disabled={!title.trim() || submitting} className="gap-2 min-w-24">
            {submitting ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Creating…</>
            ) : (
              <><Plus className="h-3.5 w-3.5" /> Create</>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
