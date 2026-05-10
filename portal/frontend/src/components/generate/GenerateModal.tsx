"use client";

import { useState } from "react";
import { Loader2, X, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateArtifact, type GenerateRequest, type LiveArtifact } from "@/lib/api";
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

  // Initialize form state with field defaults (hooks must run unconditionally)
  const initial: Record<string, string> = {};
  if (def) {
    for (const f of def.fields) {
      if (f.default) initial[f.name as string] = f.default;
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-background rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className={`flex items-center justify-center h-8 w-8 rounded-md ${def.bg} shrink-0`}>
              <Icon className={`h-4 w-4 ${def.iconColor}`} />
            </span>
            <h2 className="font-semibold text-base">Generate {def.label}</h2>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClose} disabled={submitting}>
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
            <label className="block text-xs font-medium mb-1.5">
              {def.descriptionLabel ?? "Description (optional)"}
              {descriptionRequired && <span className="text-destructive ml-1">*</span>}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={def.descriptionPlaceholder ?? ""}
              rows={3}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 text-destructive text-xs bg-destructive/5 border border-destructive/20 rounded-md p-2.5">
              <AlertCircle className="h-4 w-4 shrink-0 mt-px" />
              <span className="break-words">{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t bg-muted/30">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={submitting} className="gap-2 min-w-24">
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
      <label className="block text-xs font-medium mb-1.5">{field.label}</label>
      {field.kind === "select" && field.options && (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {field.options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      )}
    </div>
  );
}
