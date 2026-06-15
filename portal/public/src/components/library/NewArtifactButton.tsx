"use client";

import { Brain, ChevronDown, Loader2, Network, NotebookPen, Sparkles, StickyNote, Wand2, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type ArtifactKind = "note" | "mindmap" | "quiz" | "flashcards" | "diagram";

// One row per creatable artifact type. Future kinds get an entry here
// plus a case in each panel's onCreate handler. `generatable: false` keeps a
// kind out of the AI "Generate" dropdown — the public viewer has no AI, and a
// diagram is authored by hand from a Mermaid template.
const ARTIFACT_TYPES: {
  kind: ArtifactKind;
  label: string;
  hint: string;
  icon: React.ElementType;
  generatable: boolean;
}[] = [
  { kind: "note", label: "Note", hint: "Markdown text", icon: NotebookPen, generatable: true },
  { kind: "mindmap", label: "Mind map", hint: "Topic tree", icon: Network, generatable: true },
  { kind: "quiz", label: "Quiz", hint: "Multiple choice", icon: Brain, generatable: true },
  { kind: "flashcards", label: "Flashcards", hint: "Study cards", icon: StickyNote, generatable: true },
  { kind: "diagram", label: "Diagram", hint: "Mermaid", icon: Workflow, generatable: false },
];

const GENERATABLE_TYPES = ARTIFACT_TYPES.filter((t) => t.generatable);

/** "Generate" dropdown — asks the AI to create an artifact of the chosen kind
 *  from the folio's existing artifacts. Disabled (with a spinner) while one
 *  generation is in flight. */
export function GenerateArtifactButton({
  generating,
  onGenerate,
}: {
  generating: ArtifactKind | null;
  onGenerate: (kind: ArtifactKind) => void;
}) {
  const busy = generating !== null;
  const busyLabel = ARTIFACT_TYPES.find((t) => t.kind === generating)?.label.toLowerCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={busy}
        render={<Button variant="outline" size="sm" className="gap-1.5 h-7 rounded-[1px]" />}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
        {busy ? `Generating ${busyLabel}…` : "Generate"}
        {!busy && <ChevronDown className="h-3 w-3 opacity-60" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[190px]">
        {GENERATABLE_TYPES.map(({ kind, label, hint, icon: Icon }) => (
          <DropdownMenuItem key={kind} onClick={() => onGenerate(kind)}>
            <Icon className="h-3.5 w-3.5 text-ink-fade" />
            <span className="flex-1">{label}</span>
            <span className="font-mono text-[9px] tracking-[0.12em] uppercase text-ink-mute">
              {hint}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** "New artifact" dropdown shared by the Free Forms and folio file panels. */
export function NewArtifactButton({ onCreate }: { onCreate: (kind: ArtifactKind) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="sm" className="gap-1.5 h-7 rounded-[1px]" />}
      >
        <Sparkles className="h-3.5 w-3.5" />
        New artifact
        <ChevronDown className="h-3 w-3 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[190px]">
        {ARTIFACT_TYPES.map(({ kind, label, hint, icon: Icon }) => (
          <DropdownMenuItem key={kind} onClick={() => onCreate(kind)}>
            <Icon className="h-3.5 w-3.5 text-ink-fade" />
            <span className="flex-1">{label}</span>
            <span className="font-mono text-[9px] tracking-[0.12em] uppercase text-ink-mute">
              {hint}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
