"use client";

import { useState } from "react";
import { Loader2, X, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateArtifact, type GenerateRequest, type LiveArtifact } from "@/lib/api";
import { useLanguage } from "@/hooks/use-language";
import { findTypeDef, type FieldDef } from "./types";

export function GenerateModal({
  artifactType,
  notebookId,
  onClose,
  onGenerated,
}: {
  artifactType: string;
  notebookId: string;
  onClose: () => void;
  onGenerated: (artifact: LiveArtifact) => void;
}) {
  const def = findTypeDef(artifactType);
  const [preferredLang] = useLanguage();

  // Initialize form state with field defaults (hooks must run unconditionally).
  // Override the `language` field default with the user's global preference so
  // generated artifacts follow their chosen output language.
  const initial: Record<string, string> = {};
  if (def) {
    for (const f of def.fields) {
      if (f.default) initial[f.name as string] = f.default;
    }
    if (def.fields.some((f) => f.name === "language")) {
      initial.language = preferredLang === "zh" ? "zh" : "en";
    }
  }
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!def) return null;
  const Icon = def.icon;
  const descriptionRequired = !!def.descriptionRequired;

  async function handleSubmit() {
    if (descriptionRequired && !description.trim()) {
      setError(`${def!.descriptionLabel ?? "Description"} is required for ${def!.label}`);
      return;
    }
    setError(null);
    setSubmitting(true);
    const req: GenerateRequest = {
      artifact_type: def!.key,
      description: description.trim() || undefined,
      ...values,
    };
    // Types without a per-artifact language picker (quiz, flashcards) still need
    // to follow the global output language — the backend applies it as the
    // account-wide default since NotebookLM has no per-call language for them.
    if (!req.language) {
      req.language = preferredLang === "zh" ? "zh" : "en";
    }
    try {
      const artifact = await generateArtifact(notebookId, req);
      onGenerated(artifact);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-vellum rounded-[2px] border border-ink shadow-[4px_4px_0_rgb(42_36_24_/_0.18)] w-full max-w-md flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-rule shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className={`flex items-center justify-center h-8 w-8 rounded-[1px] border border-ink/20 ${def.bg} shrink-0`}>
              <Icon className={`h-4 w-4 ${def.iconColor}`} />
            </span>
            <h2 className="font-serif-display text-[22px] leading-tight tracking-tight text-ink">Generate {def.label}</h2>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-ink-fade hover:text-ink" onClick={onClose} disabled={submitting}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {def.fields.map((f) => (
            <FormField
              key={f.name as string}
              field={f}
              value={values[f.name as string] ?? ""}
              onChange={(v) => setValues((prev) => ({ ...prev, [f.name as string]: v }))}
            />
          ))}

          <div>
            <label className="block font-mono text-[10px] tracking-[0.18em] uppercase text-ink-mute mb-1.5">
              {def.descriptionLabel ?? "Description (optional)"}
              {descriptionRequired && <span className="text-terracotta ml-1">*</span>}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={def.descriptionPlaceholder ?? ""}
              rows={3}
              className="w-full rounded-[1px] border border-rule bg-paper-light px-3 py-2 font-serif text-[14px] text-ink placeholder:text-ink-mute placeholder:italic focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink focus-visible:border-ink resize-none"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 font-mono text-[11px] tracking-[0.08em] text-terracotta bg-vellum border border-terracotta/40 rounded-[1px] p-2.5">
              <AlertCircle className="h-4 w-4 shrink-0 mt-px" />
              <span className="break-words">{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-rule bg-paper-light">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={submitting} className="gap-2 min-w-24 rounded-[1px]">
            {submitting ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Starting…</>
            ) : (
              "Generate"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function FormField({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block font-mono text-[10px] tracking-[0.18em] uppercase text-ink-mute mb-1.5">{field.label}</label>
      {field.kind === "select" && field.options && (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-[1px] border border-rule bg-vellum px-3 py-2 font-serif text-[14px] text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink focus-visible:border-ink"
        >
          {field.options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      )}
    </div>
  );
}
