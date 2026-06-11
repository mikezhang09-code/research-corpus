"use client";

import { Brain, ChevronDown, Network, NotebookPen, Sparkles, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type ArtifactKind = "note" | "mindmap" | "quiz" | "flashcards";

// One row per creatable artifact type. Future kinds get an entry here
// plus a case in each panel's onCreate handler.
const ARTIFACT_TYPES: {
  kind: ArtifactKind;
  label: string;
  hint: string;
  icon: React.ElementType;
}[] = [
  { kind: "note", label: "Note", hint: "Markdown text", icon: NotebookPen },
  { kind: "mindmap", label: "Mind map", hint: "Topic tree", icon: Network },
  { kind: "quiz", label: "Quiz", hint: "Multiple choice", icon: Brain },
  { kind: "flashcards", label: "Flashcards", hint: "Study cards", icon: StickyNote },
];

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
