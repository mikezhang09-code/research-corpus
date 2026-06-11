"use client";

import { useEffect, useMemo, useState } from "react";
import {
  X, Loader2, AlertCircle, RefreshCw, CheckCircle2, XCircle,
  ChevronDown, ChevronLeft, ChevronRight, Lightbulb, Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExpandButton, EXPANDED_MODAL } from "@/components/corpus/Expandable";

export type QuizOption = { text: string; rationale: string; isCorrect: boolean };
export type QuizQuestion = { question: string; answerOptions: QuizOption[]; hint?: string };

export const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];

/** Tolerant quiz JSON parser shared by the viewer and the editor.
 *  Accepts `{questions: [...]}` (portal), `{quiz: [...]}` (raw NotebookLM
 *  exports), or a bare array; throws when no questions can be extracted. */
export function parseQuizQuestions(text: string): QuizQuestion[] {
  const parsed = JSON.parse(text);
  const raw: unknown =
    Array.isArray(parsed) ? parsed
    : Array.isArray(parsed?.questions) ? parsed.questions
    : Array.isArray(parsed?.quiz) ? parsed.quiz
    : null;
  if (!Array.isArray(raw)) throw new Error("Could not find a question list in the JSON");
  const normalized: QuizQuestion[] = raw
    .map((q: Record<string, unknown>) => {
      const optsRaw = q.answerOptions ?? q.options;
      const opts = Array.isArray(optsRaw) ? optsRaw : [];
      return {
        question: String(q.question ?? q.prompt ?? ""),
        hint: q.hint != null ? String(q.hint) : undefined,
        answerOptions: opts
          .map((o: Record<string, unknown>) => ({
            text: String(o.text ?? o.answer ?? ""),
            rationale: String(o.rationale ?? o.explanation ?? ""),
            isCorrect: Boolean(o.isCorrect ?? o.correct ?? false),
          }))
          .filter((o) => o.text),
      };
    })
    .filter((q) => q.question && q.answerOptions.length > 0);
  if (normalized.length === 0) throw new Error("No questions found");
  return normalized;
}

/** Interactive quiz viewer for library/free-form quiz files. */
export function QuizModal({
  title,
  fetchContent,
  onClose,
  onEdit,
}: {
  title: string;
  fetchContent: () => Promise<string>;
  onClose: () => void;
  /** When set, shows an Edit button that hands off to the quiz editor (main portal only). */
  onEdit?: () => void;
}) {
  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  // selected[i] = the option index the user picked for question i (absent = unanswered).
  const [selected, setSelected] = useState<Record<number, number>>({});
  const [showHint, setShowHint] = useState(false);
  const [finished, setFinished] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetchContent()
      .then((text) => {
        try { setQuestions(parseQuizQuestions(text)); }
        catch (e) { setError(e instanceof Error ? e.message : "Invalid quiz JSON"); }
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = questions?.length ?? 0;
  const current = questions?.[index];
  const picked = selected[index];
  const answered = picked !== undefined;

  const correctCount = useMemo(
    () =>
      questions
        ? Object.entries(selected).reduce(
            (n, [qi, oi]) => n + (questions[Number(qi)]?.answerOptions[oi]?.isCorrect ? 1 : 0),
            0,
          )
        : 0,
    [questions, selected],
  );

  function pick(optionIndex: number) {
    if (answered) return;
    setSelected((prev) => ({ ...prev, [index]: optionIndex }));
  }

  function goNext() {
    setShowHint(false);
    if (index < total - 1) setIndex(index + 1);
    else setFinished(true);
  }

  function goPrev() {
    setShowHint(false);
    if (index > 0) setIndex(index - 1);
  }

  function restart() {
    setSelected({});
    setIndex(0);
    setShowHint(false);
    setFinished(false);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={`bg-vellum rounded-[2px] border border-ink shadow-[4px_4px_0_rgb(42_36_24_/_0.18)] w-full ${expanded ? EXPANDED_MODAL : "max-w-2xl max-h-[88vh]"} flex flex-col overflow-hidden`}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule shrink-0">
          <div className="min-w-0">
            <h2 className="font-serif-display text-[22px] leading-tight tracking-tight text-ink line-clamp-1">{title}</h2>
            {questions && (
              <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-ink-mute mt-1">
                {finished ? `${total} question${total !== 1 ? "s" : ""}` : `Question ${index + 1} of ${total}`}
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
        <div className="overflow-y-auto flex-1 px-6 py-6">
          {error ? (
            <div className="flex items-center gap-2 text-terracotta font-mono text-[11px] tracking-[0.1em] uppercase">
              <AlertCircle className="h-4 w-4 shrink-0" />
              Failed to load: {error}
            </div>
          ) : !questions || !current ? (
            <div className="flex items-center gap-2 text-ink-fade font-mono text-[11px] tracking-[0.1em] uppercase">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : finished ? (
            <div className="flex flex-col items-center justify-center text-center py-10 gap-4">
              <p className="font-mono text-[10px] tracking-[0.18em] uppercase text-ink-mute">Your score</p>
              <p className="font-serif-display text-[56px] leading-none tracking-tight text-ink">
                {correctCount}<span className="text-ink-mute">/{total}</span>
              </p>
              <p className="font-serif text-[15px] text-ink-soft">
                {correctCount === total
                  ? "Perfect — every question correct."
                  : `${Math.round((correctCount / total) * 100)}% correct`}
              </p>
              <Button variant="outline" size="sm" className="mt-2 gap-1.5 rounded-[1px]" onClick={restart}>
                <RefreshCw className="h-3.5 w-3.5" /> Restart quiz
              </Button>
            </div>
          ) : (
            <>
              {/* Question */}
              <p className="font-serif text-[18px] leading-[1.45] text-ink mb-5">{current.question}</p>

              {/* Options */}
              <div className="flex flex-col gap-2.5">
                {current.answerOptions.map((o, oi) => {
                  const isPicked = picked === oi;
                  const reveal = answered;
                  const stateClass = !reveal
                    ? "border-rule bg-paper-deep/40 hover:bg-paper-deep hover:border-ink cursor-pointer"
                    : o.isCorrect
                      ? "border-mint bg-mint/10"
                      : isPicked
                        ? "border-terracotta bg-terracotta/[0.06]"
                        : "border-rule bg-paper-deep/20 opacity-70";
                  return (
                    <button
                      key={oi}
                      type="button"
                      disabled={reveal}
                      onClick={() => pick(oi)}
                      className={`w-full text-left rounded-[2px] border px-4 py-3.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink ${stateClass}`}
                    >
                      <div className="flex items-start gap-3">
                        <span className="font-mono text-[13px] text-ink-fade leading-[1.5] shrink-0 w-4">{OPTION_LETTERS[oi]}.</span>
                        <div className="flex-1 min-w-0">
                          <span className="font-serif text-[15px] leading-[1.5] text-ink">{o.text}</span>
                          {reveal && o.isCorrect && (
                            <span className="flex items-center gap-1.5 mt-1 font-mono text-[11px] tracking-[0.06em] text-mint">
                              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> <strong className="font-semibold">Right answer</strong>
                            </span>
                          )}
                          {reveal && !o.isCorrect && isPicked && (
                            <span className="flex items-center gap-1.5 mt-1 font-mono text-[11px] tracking-[0.06em] text-terracotta">
                              <XCircle className="h-3.5 w-3.5 shrink-0" /> Your answer
                            </span>
                          )}
                          {reveal && o.rationale && (
                            <p className="font-serif text-[13.5px] leading-[1.5] text-ink-soft mt-1.5">{o.rationale}</p>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Hint (pre-answer only) */}
              {!answered && current.hint && (
                <div className="mt-5 flex flex-col items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setShowHint((h) => !h)}
                    className="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-[0.12em] uppercase text-ink-fade hover:text-ink transition-colors"
                  >
                    Hint <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showHint ? "rotate-180" : ""}`} />
                  </button>
                  {showHint && (
                    <div className="w-full flex items-start gap-2.5 rounded-[2px] border border-rule bg-paper-deep/40 px-4 py-3">
                      <Lightbulb className="h-4 w-4 shrink-0 mt-0.5 text-ochre" />
                      <p className="font-serif text-[14px] leading-[1.5] text-ink-soft">{current.hint}</p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer nav */}
        {questions && current && !finished && (
          <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-rule shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-ink-fade hover:text-ink disabled:opacity-40"
              onClick={goPrev}
              disabled={index === 0}
            >
              <ChevronLeft className="h-4 w-4" /> Back
            </Button>
            <Button size="sm" className="gap-1.5 rounded-full px-5" onClick={goNext}>
              {index < total - 1 ? <>Next <ChevronRight className="h-4 w-4" /></> : "See results"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
