"use client";

import { useEffect, useState } from "react";
import {
  X, Loader2, Save, AlertCircle, Plus, Trash2, ArrowUp, ArrowDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ExpandButton, EXPANDED_MODAL } from "@/components/corpus/Expandable";
import {
  uploadLibraryNotebookFile, updateLibraryNotebookFile, saveLibraryNoteContent,
  uploadFreeFormFile, updateFreeFormFile, saveFreeFormNoteContent,
  getLibraryFileContent, type LibraryFile,
} from "@/lib/api";
import { parseFlashcards, type Flashcard } from "./FlashcardsModal";

// Editing happens on a working copy where every card carries a stable runtime
// id (index keys would mis-key controlled inputs when rows are reordered or
// removed). Ids exist only in memory; saved JSON is the portal { cards: [...] }
// shape that parseFlashcards reads back.
type EditCard = { id: string; front: string; back: string };

let fcIdCounter = 0;
const newId = () => `fc${++fcIdCounter}`;

const newCard = (): EditCard => ({ id: newId(), front: "", back: "" });

function fromParsed(cards: Flashcard[]): EditCard[] {
  return cards.map((c) => ({ id: newId(), front: c.front, back: c.back }));
}

function serialize(cards: EditCard[]): string {
  return JSON.stringify(
    {
      cards: cards.map((c) => ({ front: c.front.trim(), back: c.back.trim() })),
    },
    null,
    2,
  );
}

function validate(cards: EditCard[]): string | null {
  if (cards.length === 0) return "Add at least one card";
  for (let i = 0; i < cards.length; i++) {
    const n = i + 1;
    if (!cards[i].front.trim()) return `Card ${n} needs front text`;
    if (!cards[i].back.trim()) return `Card ${n} needs back text`;
  }
  return null;
}

// Create or edit a flashcard deck with a structured form — no JSON typing
// anywhere. A deck is a .json file (file_category "flashcards") in the
// { cards } shape FlashcardsModal plays. Create uploads a new file, edit
// overwrites the stored bytes. `notebookId: null` targets free-forms.
export function FlashcardEditorModal<T extends { id: string; title: string } = LibraryFile>({
  notebookId,
  file,
  onClose,
  onSaved,
}: {
  /** Folio id, or null for a free-form deck. */
  notebookId: string | null;
  file?: T | null;
  onClose: () => void;
  onSaved: (file: T) => void;
}) {
  const isEdit = !!file;
  const [title, setTitle] = useState(file?.title ?? "");
  const [cards, setCards] = useState<EditCard[] | null>(
    isEdit ? null : [newCard()],
  );
  const [initialJson, setInitialJson] = useState<string | null>(
    isEdit ? null : serialize([newCard()]),
  );
  const [loading, setLoading] = useState(isEdit);
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edit mode: load the stored deck through the same tolerant parser the
  // viewer uses, so NotebookLM exports open in the editor unchanged.
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    getLibraryFileContent(notebookId, file.id)
      .then((text) => {
        if (cancelled) return;
        const cs = fromParsed(parseFlashcards(text));
        setInitialJson(serialize(cs));
        setCards(cs);
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [file, notebookId]);

  const dirty =
    cards !== null &&
    (file
      ? title.trim() !== file.title || serialize(cards) !== initialJson
      : title.trim().length > 0 || serialize(cards) !== initialJson);

  function requestClose() {
    if (saving) return;
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    onClose();
  }

  // ---- mutations (all immutable map/filter over the cards array) ----

  function patchCard(cid: string, patch: Partial<Omit<EditCard, "id">>) {
    setCards((cs) => cs && cs.map((c) => (c.id === cid ? { ...c, ...patch } : c)));
  }

  function addCard() {
    setCards((cs) => cs && [...cs, newCard()]);
  }

  function removeCard(cid: string) {
    const c = cards?.find((x) => x.id === cid);
    const hasContent = !!c && (c.front.trim() || c.back.trim());
    if (hasContent && !window.confirm("Delete this card?")) return;
    setCards((cs) => cs && cs.filter((x) => x.id !== cid));
  }

  function moveCard(cid: string, dir: -1 | 1) {
    setCards((cs) => {
      if (!cs) return cs;
      const idx = cs.findIndex((c) => c.id === cid);
      const j = idx + dir;
      if (idx < 0 || j < 0 || j >= cs.length) return cs;
      const next = [...cs];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  }

  // ---- save (same endpoints as the note/mindmap/quiz editors; deck JSON) ----

  async function handleSave() {
    const t = title.trim();
    if (!t) { setError("Title is required"); return; }
    if (!cards) return;
    const problem = validate(cards);
    if (problem) { setError(problem); return; }
    setSaving(true);
    setError(null);
    try {
      const json = serialize(cards);
      let result: T;
      if (!file) {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const f = new File([json], `flashcards-${stamp}.json`, { type: "application/json" });
        result = (notebookId
          ? await uploadLibraryNotebookFile(notebookId, f, "flashcards", t)
          : await uploadFreeFormFile(f, "flashcards", t)) as unknown as T;
      } else {
        result = file;
        if (t !== file.title) {
          result = (notebookId
            ? await updateLibraryNotebookFile(notebookId, file.id, { title: t })
            : await updateFreeFormFile(file.id, { title: t })) as unknown as T;
        }
        if (json !== initialJson) {
          result = (notebookId
            ? await saveLibraryNoteContent(notebookId, file.id, json)
            : await saveFreeFormNoteContent(file.id, json)) as unknown as T;
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
      <div className={`bg-vellum rounded-[2px] border border-ink shadow-[4px_4px_0_rgb(42_36_24_/_0.18)] w-full ${expanded ? EXPANDED_MODAL : "max-w-3xl max-h-[90vh]"} flex flex-col overflow-hidden`}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-rule shrink-0">
          <h2 className="font-serif-display text-[22px] leading-tight tracking-tight text-ink">
            {isEdit ? "Edit flashcards" : "New flashcards"}
          </h2>
          <div className="flex items-center gap-1 shrink-0">
            <ExpandButton expanded={expanded} onToggle={() => setExpanded(!expanded)} />
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-ink-fade hover:text-ink" onClick={requestClose} disabled={saving}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4 flex flex-col gap-4 flex-1 min-h-0 overflow-y-auto">
          <Input
            placeholder="Deck title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={saving || loading}
            autoFocus={!isEdit}
            className="h-11 shrink-0"
          />

          {error && !cards ? (
            <div className="flex items-center gap-2 text-terracotta font-mono text-[11px] tracking-[0.1em] uppercase py-4">
              <AlertCircle className="h-4 w-4 shrink-0" />
              Failed to load: {error}
            </div>
          ) : loading || !cards ? (
            <div className="flex items-center gap-2 text-ink-fade font-mono text-[11px] tracking-[0.1em] uppercase py-4">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <>
              {cards.map((c, ci) => (
                <div key={c.id} className="rounded-[2px] border border-rule bg-paper-light p-4 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] tracking-[0.18em] uppercase text-ink-mute">
                      Card {ci + 1}
                    </span>
                    <div className="flex items-center gap-0.5">
                      <IconBtn label="Move up" icon={ArrowUp} onClick={() => moveCard(c.id, -1)} disabled={saving || ci === 0} />
                      <IconBtn label="Move down" icon={ArrowDown} onClick={() => moveCard(c.id, 1)} disabled={saving || ci === cards.length - 1} />
                      <IconBtn label="Delete card" icon={Trash2} onClick={() => removeCard(c.id)} disabled={saving} danger />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <span className="font-mono text-[9px] tracking-[0.14em] uppercase text-ink-mute">Front</span>
                    <textarea
                      value={c.front}
                      onChange={(e) => patchCard(c.id, { front: e.target.value })}
                      disabled={saving}
                      rows={2}
                      placeholder="Question or prompt"
                      className="w-full rounded-[1px] border border-rule bg-vellum px-3 py-2 font-serif text-[15px] text-ink placeholder:text-ink-mute/60 placeholder:italic resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink focus-visible:border-ink"
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <span className="font-mono text-[9px] tracking-[0.14em] uppercase text-ink-mute">Back</span>
                    <textarea
                      value={c.back}
                      onChange={(e) => patchCard(c.id, { back: e.target.value })}
                      disabled={saving}
                      rows={2}
                      placeholder="Answer"
                      className="w-full rounded-[1px] border border-rule bg-vellum px-3 py-2 font-serif text-[15px] text-ink placeholder:text-ink-mute/60 placeholder:italic resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink focus-visible:border-ink"
                    />
                  </div>
                </div>
              ))}

              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 rounded-[1px] self-start shrink-0"
                onClick={addCard}
                disabled={saving}
              >
                <Plus className="h-3.5 w-3.5" /> Add card
              </Button>
            </>
          )}

          {error && cards && (
            <div className="flex items-start gap-2 font-mono text-[11px] tracking-[0.08em] text-terracotta bg-vellum border border-terracotta/40 rounded-[1px] p-2.5 shrink-0">
              <AlertCircle className="h-4 w-4 shrink-0 mt-px" />
              <span className="break-words">{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-rule bg-paper-light shrink-0">
          <span className="font-mono text-[9px] tracking-[0.1em] uppercase text-ink-mute hidden sm:block">
            Every card needs a front and a back
          </span>
          <div className="flex items-center gap-2 ml-auto">
            <Button variant="ghost" size="sm" onClick={requestClose} disabled={saving}>Cancel</Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving || loading || !cards || !title.trim() || !dirty}
              className="gap-2 min-w-24 rounded-[1px]"
            >
              {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</> : <><Save className="h-3.5 w-3.5" /> Save</>}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function IconBtn({ label, icon: Icon, onClick, disabled, danger }: {
  label: string; icon: React.ElementType; onClick: () => void; disabled?: boolean; danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`h-7 w-7 inline-flex items-center justify-center rounded-[1px] text-ink-fade transition-colors disabled:opacity-40 ${
        danger ? "hover:text-terracotta hover:bg-paper-deep" : "hover:text-ink hover:bg-paper-deep"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}
