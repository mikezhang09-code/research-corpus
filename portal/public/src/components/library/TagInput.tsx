"use client";

import { useMemo, useRef, useState } from "react";
import { X } from "lucide-react";

export type TagInputProps = {
  value: string[];
  onChange: (next: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
  disabled?: boolean;
};

function normalize(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "-");
}

export function TagInput({
  value, onChange, suggestions = [], placeholder = "Add tag…", disabled,
}: TagInputProps) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const q = draft.trim().toLowerCase();
    if (!q) return [];
    return suggestions
      .filter((s) => !value.includes(s) && s.toLowerCase().includes(q))
      .slice(0, 8);
  }, [draft, suggestions, value]);

  function addTag(raw: string) {
    const t = normalize(raw);
    if (!t) return;
    if (value.includes(t)) {
      setDraft("");
      return;
    }
    onChange([...value, t]);
    setDraft("");
  }

  function removeTag(tag: string) {
    onChange(value.filter((t) => t !== tag));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (draft.trim()) addTag(draft);
    } else if (e.key === "Backspace" && !draft && value.length > 0) {
      removeTag(value[value.length - 1]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <div
        className="flex flex-wrap items-center gap-1.5 rounded-[1px] border border-rule bg-paper px-2 py-1.5 focus-within:border-ink transition-colors min-h-[36px]"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 font-mono text-[10px] tracking-[0.14em] uppercase px-1.5 py-0.5 border border-rule bg-vellum text-ink rounded-[1px]"
          >
            {tag}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removeTag(tag); }}
              disabled={disabled}
              aria-label={`Remove ${tag}`}
              className="text-ink-fade hover:text-terracotta disabled:opacity-50"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setOpen(true); }}
          onKeyDown={handleKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          placeholder={value.length === 0 ? placeholder : ""}
          disabled={disabled}
          className="flex-1 min-w-[6rem] bg-transparent border-none outline-none font-mono text-[11px] tracking-[0.06em] text-ink placeholder:text-ink-mute disabled:opacity-50"
        />
      </div>
      {open && matches.length > 0 && (
        <div className="absolute z-20 left-0 right-0 mt-1 rounded-[1px] border border-rule bg-paper shadow-sm max-h-48 overflow-auto">
          {matches.map((s) => (
            <button
              key={s}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); addTag(s); }}
              className="w-full text-left px-2 py-1.5 font-mono text-[10px] tracking-[0.14em] uppercase text-ink-fade hover:text-ink hover:bg-paper-deep"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
