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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}
    >
      <div className="bg-vellum rounded-[2px] border border-ink shadow-[4px_4px_0_rgb(42_36_24_/_0.18)] w-full max-w-md flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-rule shrink-0">
          <h2 className="font-serif-display text-[22px] leading-tight tracking-tight text-ink">New folio</h2>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-ink-fade hover:text-ink" onClick={onClose} disabled={submitting}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <label className="block font-mono text-[10px] tracking-[0.18em] uppercase text-ink-mute mb-2">Cover &amp; title</label>
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
            <div className="flex items-start gap-2 font-mono text-[11px] tracking-[0.08em] text-terracotta bg-vellum border border-terracotta/40 rounded-[1px] p-2.5">
              <AlertCircle className="h-4 w-4 shrink-0 mt-px" />
              <span className="break-words">{error}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-rule bg-paper-light">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button size="sm" onClick={handleCreate} disabled={!title.trim() || submitting} className="gap-2 min-w-24 rounded-[1px]">
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
