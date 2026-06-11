"use client";

import { useEffect, useState } from "react";
import {
  X, Loader2, AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExpandButton, EXPANDED_MODAL } from "@/components/corpus/Expandable";

export type Flashcard = { front: string; back: string };

/** Tolerant flashcard JSON parser shared by the viewer and the editor.
 *  Accepts `{cards: [...]}` (portal / NotebookLM artifact), `{flashcards:
 *  [...]}`, or a bare array; card fields may be front/back, f/b, or
 *  question/answer. Throws when no cards can be extracted. */
export function parseFlashcards(text: string): Flashcard[] {
  const parsed = JSON.parse(text);
  const raw: unknown =
    Array.isArray(parsed) ? parsed
    : Array.isArray(parsed?.cards) ? parsed.cards
    : Array.isArray(parsed?.flashcards) ? parsed.flashcards
    : null;
  if (!Array.isArray(raw)) throw new Error("Could not find a card list in the JSON");
  const normalized: Flashcard[] = raw
    .map((c: Record<string, unknown>) => ({
      front: String(c.front ?? c.f ?? c.question ?? ""),
      back: String(c.back ?? c.b ?? c.answer ?? ""),
    }))
    .filter((c) => c.front || c.back);
  if (normalized.length === 0) throw new Error("No cards found");
  return normalized;
}

/** Flip-through flashcard viewer for library/free-form flashcard files. */
export function FlashcardsModal({
  title,
  fetchContent,
  onClose,
  onEdit,
}: {
  title: string;
  fetchContent: () => Promise<string>;
  onClose: () => void;
  /** When set, shows an Edit button that hands off to the flashcard editor (main portal only). */
  onEdit?: () => void;
}) {
  const [cards, setCards] = useState<Flashcard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [correct, setCorrect] = useState(0);
  const [incorrect, setIncorrect] = useState(0);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetchContent()
      .then((text) => {
        try { setCards(parseFlashcards(text)); }
        catch (e) { setError(e instanceof Error ? e.message : "Invalid flashcard JSON"); }
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function go(delta: number) {
    if (!cards) return;
    setIndex((index + delta + cards.length) % cards.length);
    setFlipped(false);
  }

  function score(kind: "correct" | "incorrect") {
    if (kind === "correct") setCorrect((n) => n + 1);
    else setIncorrect((n) => n + 1);
    if (cards && index < cards.length - 1) go(1);
  }

  // Keyboard nav
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      if (!cards) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
      else if (e.key === " " || e.key === "Enter") { e.preventDefault(); setFlipped((f) => !f); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, index, onClose]);

  const current = cards?.[index];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={`bg-vellum rounded-[2px] border border-ink shadow-[4px_4px_0_rgb(42_36_24_/_0.18)] w-full ${expanded ? EXPANDED_MODAL : "max-w-2xl"} flex flex-col overflow-hidden`}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule shrink-0">
          <div className="min-w-0">
            <h2 className="font-serif-display text-[22px] leading-tight tracking-tight text-ink line-clamp-1">{title}</h2>
            {cards && (
              <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-ink-mute mt-1">
                {cards.length} card{cards.length !== 1 ? "s" : ""}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {onEdit && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 h-7 rounded-[1px] mr-1"
                onClick={onEdit}
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </Button>
            )}
            <ExpandButton expanded={expanded} onToggle={() => setExpanded(!expanded)} />
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-ink-fade hover:text-ink" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto">
          {error ? (
            <div className="flex items-center gap-2 text-terracotta font-mono text-[11px] tracking-[0.1em] uppercase">
              <AlertCircle className="h-4 w-4 shrink-0" />
              Failed to load: {error}
            </div>
          ) : !cards || !current ? (
            <div className="flex items-center gap-2 text-ink-fade font-mono text-[11px] tracking-[0.1em] uppercase">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <>
              {/* Card */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => setFlipped((f) => !f)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setFlipped((f) => !f); } }}
                className="relative cursor-pointer bg-ink text-paper rounded-[3px] border border-ink shadow-[3px_3px_0_rgb(42_36_24_/_0.18)] min-h-[280px] flex flex-col p-6 hover:-translate-y-px transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terracotta"
              >
                <span className="absolute top-3 left-4 font-mono text-[10px] tracking-[0.18em] uppercase text-paper/60">
                  {index + 1} / {cards.length}
                </span>
                <span className="absolute top-3 right-4 font-mono text-[10px] tracking-[0.18em] uppercase text-paper/60">
                  {flipped ? "Answer" : "Question"}
                </span>
                <div className="flex-1 flex items-center justify-center mt-6">
                  <p className="font-serif text-[20px] leading-[1.4] text-paper text-center max-w-[90%] whitespace-pre-wrap">
                    {flipped ? current.back : current.front}
                  </p>
                </div>
                <div className="text-center font-mono text-[10px] tracking-[0.18em] uppercase text-paper/50 mt-2">
                  {flipped ? "Tap to flip back" : "Tap to see answer"}
                </div>
              </div>

              {/* Controls */}
              <div className="flex items-center justify-between gap-3 mt-5">
                <button
                  type="button"
                  aria-label="Previous card"
                  onClick={() => go(-1)}
                  className="h-10 w-10 rounded-full border border-ink bg-vellum hover:bg-paper-deep flex items-center justify-center text-ink-fade hover:text-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => score("incorrect")}
                    className="inline-flex items-center gap-2 h-10 px-4 rounded-full border border-terracotta bg-vellum hover:bg-terracotta/10 text-terracotta font-mono text-[11px] tracking-[0.12em] uppercase transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terracotta"
                  >
                    <X className="h-3.5 w-3.5" />
                    {incorrect}
                  </button>
                  <button
                    type="button"
                    onClick={() => score("correct")}
                    className="inline-flex items-center gap-2 h-10 px-4 rounded-full border border-mint bg-vellum hover:bg-mint/10 text-mint font-mono text-[11px] tracking-[0.12em] uppercase transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint"
                  >
                    {correct}
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                <button
                  type="button"
                  aria-label="Next card"
                  onClick={() => go(1)}
                  className="h-10 w-10 rounded-full border border-ink bg-vellum hover:bg-paper-deep flex items-center justify-center text-ink-fade hover:text-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              <p className="font-mono text-[9px] tracking-[0.14em] uppercase text-ink-mute text-center mt-4">
                Space / Enter to flip · ← → to navigate · Esc to close
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
