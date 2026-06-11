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
import { OPTION_LETTERS, parseQuizQuestions, type QuizQuestion } from "./QuizModal";

// Editing happens on a working copy where every question/option carries a
// stable runtime id (index keys would mis-key controlled inputs when rows are
// reordered or removed). Ids exist only in memory; saved JSON is the portal
// { questions: [...] } shape that parseQuizQuestions reads back.
type EditOption = { id: string; text: string; rationale: string; isCorrect: boolean };
type EditQuestion = { id: string; question: string; hint: string; options: EditOption[] };

let qzIdCounter = 0;
const newId = () => `qz${++qzIdCounter}`;

const newOption = (): EditOption => ({ id: newId(), text: "", rationale: "", isCorrect: false });
const newQuestion = (): EditQuestion => ({
  id: newId(),
  question: "",
  hint: "",
  options: [newOption(), newOption(), newOption(), newOption()],
});

function fromParsed(qs: QuizQuestion[]): EditQuestion[] {
  return qs.map((q) => ({
    id: newId(),
    question: q.question,
    hint: q.hint ?? "",
    options: q.answerOptions.map((o) => ({
      id: newId(),
      text: o.text,
      rationale: o.rationale,
      isCorrect: o.isCorrect,
    })),
  }));
}

// Blank option rows are scratch space — they are dropped on save so the
// stored file always round-trips through parseQuizQuestions.
function serialize(qs: EditQuestion[]): string {
  return JSON.stringify(
    {
      questions: qs.map((q) => ({
        question: q.question.trim(),
        ...(q.hint.trim() ? { hint: q.hint.trim() } : {}),
        answerOptions: q.options
          .filter((o) => o.text.trim())
          .map((o) => ({
            text: o.text.trim(),
            rationale: o.rationale.trim(),
            isCorrect: o.isCorrect,
          })),
      })),
    },
    null,
    2,
  );
}

function validate(qs: EditQuestion[]): string | null {
  if (qs.length === 0) return "Add at least one question";
  for (let i = 0; i < qs.length; i++) {
    const n = i + 1;
    if (!qs[i].question.trim()) return `Question ${n} needs text`;
    const opts = qs[i].options.filter((o) => o.text.trim());
    if (opts.length < 2) return `Question ${n} needs at least two answers`;
    if (!opts.some((o) => o.isCorrect)) return `Question ${n} needs a correct answer marked`;
  }
  return null;
}

// Create or edit a quiz with a structured form — no JSON typing anywhere.
// A quiz is a .json file (file_category "quiz") in the { questions } shape
// QuizModal plays. Create uploads a new file, edit overwrites the stored
// bytes. `notebookId: null` targets free-forms.
export function QuizEditorModal<T extends { id: string; title: string } = LibraryFile>({
  notebookId,
  file,
  onClose,
  onSaved,
}: {
  /** Folio id, or null for a free-form quiz. */
  notebookId: string | null;
  file?: T | null;
  onClose: () => void;
  onSaved: (file: T) => void;
}) {
  const isEdit = !!file;
  const [title, setTitle] = useState(file?.title ?? "");
  const [questions, setQuestions] = useState<EditQuestion[] | null>(
    isEdit ? null : [newQuestion()],
  );
  const [initialJson, setInitialJson] = useState<string | null>(
    isEdit ? null : serialize([newQuestion()]),
  );
  const [loading, setLoading] = useState(isEdit);
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edit mode: load the stored quiz through the same tolerant parser the
  // viewer uses, so NotebookLM exports open in the editor unchanged.
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    getLibraryFileContent(notebookId, file.id)
      .then((text) => {
        if (cancelled) return;
        const qs = fromParsed(parseQuizQuestions(text));
        setInitialJson(serialize(qs));
        setQuestions(qs);
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [file, notebookId]);

  const dirty =
    questions !== null &&
    (file
      ? title.trim() !== file.title || serialize(questions) !== initialJson
      : title.trim().length > 0 || serialize(questions) !== initialJson);

  function requestClose() {
    if (saving) return;
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    onClose();
  }

  // ---- mutations (all immutable map/filter over the questions array) ----

  function patchQuestion(qid: string, patch: Partial<Omit<EditQuestion, "id" | "options">>) {
    setQuestions((qs) => qs && qs.map((q) => (q.id === qid ? { ...q, ...patch } : q)));
  }

  function patchOption(qid: string, oid: string, patch: Partial<Omit<EditOption, "id">>) {
    setQuestions((qs) =>
      qs && qs.map((q) =>
        q.id === qid
          ? { ...q, options: q.options.map((o) => (o.id === oid ? { ...o, ...patch } : o)) }
          : q,
      ),
    );
  }

  function markCorrect(qid: string, oid: string) {
    setQuestions((qs) =>
      qs && qs.map((q) =>
        q.id === qid
          ? { ...q, options: q.options.map((o) => ({ ...o, isCorrect: o.id === oid })) }
          : q,
      ),
    );
  }

  function addOption(qid: string) {
    setQuestions((qs) =>
      qs && qs.map((q) =>
        q.id === qid && q.options.length < OPTION_LETTERS.length
          ? { ...q, options: [...q.options, newOption()] }
          : q,
      ),
    );
  }

  function removeOption(qid: string, oid: string) {
    setQuestions((qs) =>
      qs && qs.map((q) =>
        q.id === qid && q.options.length > 2
          ? { ...q, options: q.options.filter((o) => o.id !== oid) }
          : q,
      ),
    );
  }

  function addQuestion() {
    setQuestions((qs) => qs && [...qs, newQuestion()]);
  }

  function removeQuestion(qid: string) {
    const q = questions?.find((x) => x.id === qid);
    const hasContent = !!q && (q.question.trim() || q.options.some((o) => o.text.trim()));
    if (hasContent && !window.confirm("Delete this question?")) return;
    setQuestions((qs) => qs && qs.filter((x) => x.id !== qid));
  }

  function moveQuestion(qid: string, dir: -1 | 1) {
    setQuestions((qs) => {
      if (!qs) return qs;
      const idx = qs.findIndex((q) => q.id === qid);
      const j = idx + dir;
      if (idx < 0 || j < 0 || j >= qs.length) return qs;
      const next = [...qs];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  }

  // ---- save (same endpoints as the note/mindmap editors; quiz JSON) ----

  async function handleSave() {
    const t = title.trim();
    if (!t) { setError("Title is required"); return; }
    if (!questions) return;
    const problem = validate(questions);
    if (problem) { setError(problem); return; }
    setSaving(true);
    setError(null);
    try {
      const json = serialize(questions);
      let result: T;
      if (!file) {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const f = new File([json], `quiz-${stamp}.json`, { type: "application/json" });
        result = (notebookId
          ? await uploadLibraryNotebookFile(notebookId, f, "quiz", t)
          : await uploadFreeFormFile(f, "quiz", t)) as unknown as T;
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
            {isEdit ? "Edit quiz" : "New quiz"}
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
            placeholder="Quiz title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={saving || loading}
            autoFocus={!isEdit}
            className="h-11 shrink-0"
          />

          {error && !questions ? (
            <div className="flex items-center gap-2 text-terracotta font-mono text-[11px] tracking-[0.1em] uppercase py-4">
              <AlertCircle className="h-4 w-4 shrink-0" />
              Failed to load: {error}
            </div>
          ) : loading || !questions ? (
            <div className="flex items-center gap-2 text-ink-fade font-mono text-[11px] tracking-[0.1em] uppercase py-4">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <>
              {questions.map((q, qi) => (
                <div key={q.id} className="rounded-[2px] border border-rule bg-paper-light p-4 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] tracking-[0.18em] uppercase text-ink-mute">
                      Question {qi + 1}
                    </span>
                    <div className="flex items-center gap-0.5">
                      <IconBtn label="Move up" icon={ArrowUp} onClick={() => moveQuestion(q.id, -1)} disabled={saving || qi === 0} />
                      <IconBtn label="Move down" icon={ArrowDown} onClick={() => moveQuestion(q.id, 1)} disabled={saving || qi === questions.length - 1} />
                      <IconBtn label="Delete question" icon={Trash2} onClick={() => removeQuestion(q.id)} disabled={saving} danger />
                    </div>
                  </div>

                  <textarea
                    value={q.question}
                    onChange={(e) => patchQuestion(q.id, { question: e.target.value })}
                    disabled={saving}
                    rows={2}
                    placeholder="Question text"
                    className="w-full rounded-[1px] border border-rule bg-vellum px-3 py-2 font-serif text-[15px] text-ink placeholder:text-ink-mute/60 placeholder:italic resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink focus-visible:border-ink"
                  />

                  <div className="flex flex-col gap-2.5">
                    {q.options.map((o, oi) => (
                      <div key={o.id} className="flex flex-col gap-1">
                        <div className="flex items-center gap-2.5">
                          <input
                            type="radio"
                            name={`correct-${q.id}`}
                            checked={o.isCorrect}
                            onChange={() => markCorrect(q.id, o.id)}
                            disabled={saving}
                            title="Mark as the correct answer"
                            aria-label={`Mark answer ${OPTION_LETTERS[oi]} correct`}
                            className="h-4 w-4 shrink-0 cursor-pointer"
                            style={{ accentColor: "var(--color-sage)" }}
                          />
                          <span className="font-mono text-[13px] text-ink-fade w-4 shrink-0">{OPTION_LETTERS[oi]}.</span>
                          <Input
                            value={o.text}
                            onChange={(e) => patchOption(q.id, o.id, { text: e.target.value })}
                            disabled={saving}
                            placeholder={`Answer ${OPTION_LETTERS[oi]}`}
                            className="h-9 flex-1"
                          />
                          <IconBtn
                            label="Remove answer"
                            icon={Trash2}
                            onClick={() => removeOption(q.id, o.id)}
                            disabled={saving || q.options.length <= 2}
                          />
                        </div>
                        <Input
                          value={o.rationale}
                          onChange={(e) => patchOption(q.id, o.id, { rationale: e.target.value })}
                          disabled={saving}
                          placeholder="Why this is right / wrong (optional)"
                          className="h-8 ml-[3.4rem] mr-8 w-auto text-[13px] text-ink-soft"
                        />
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5 h-7 rounded-[1px] text-ink-fade hover:text-ink self-start"
                      onClick={() => addOption(q.id)}
                      disabled={saving || q.options.length >= OPTION_LETTERS.length}
                    >
                      <Plus className="h-3.5 w-3.5" /> Add answer
                    </Button>
                  </div>

                  <Input
                    value={q.hint}
                    onChange={(e) => patchQuestion(q.id, { hint: e.target.value })}
                    disabled={saving}
                    placeholder="Hint shown before answering (optional)"
                    className="h-9 text-[13px]"
                  />
                </div>
              ))}

              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 rounded-[1px] self-start shrink-0"
                onClick={addQuestion}
                disabled={saving}
              >
                <Plus className="h-3.5 w-3.5" /> Add question
              </Button>
            </>
          )}

          {error && questions && (
            <div className="flex items-start gap-2 font-mono text-[11px] tracking-[0.08em] text-terracotta bg-vellum border border-terracotta/40 rounded-[1px] p-2.5 shrink-0">
              <AlertCircle className="h-4 w-4 shrink-0 mt-px" />
              <span className="break-words">{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-rule bg-paper-light shrink-0">
          <span className="font-mono text-[9px] tracking-[0.1em] uppercase text-ink-mute hidden sm:block">
            Radio marks the correct answer · blank answers are dropped on save
          </span>
          <div className="flex items-center gap-2 ml-auto">
            <Button variant="ghost" size="sm" onClick={requestClose} disabled={saving}>Cancel</Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving || loading || !questions || !title.trim() || !dirty}
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
