"use client";

import { Languages, User } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LANGUAGES, useLanguage, type Language } from "@/hooks/use-language";
import { SectionSwitch } from "@/components/corpus/SectionSwitch";

export function Masthead() {
  return (
    <header className="px-14 pt-8 pb-5 border-b border-rule relative">
      <div className="flex items-end justify-between gap-6">
        <div className="flex items-baseline gap-5 shrink-0">
          <div className="font-mono text-[10px] tracking-[0.2em] uppercase text-ink-mute leading-none pb-1">
            Vol. XII · MMXXVI
          </div>
          <h1 className="font-serif-display text-[44px] leading-[0.95] tracking-tight">
            Research <span className="italic">Corpus</span>
          </h1>
          <div className="font-mono text-[10px] tracking-[0.2em] uppercase text-ink-mute pb-1">
            № 0042
          </div>
        </div>
        <div className="flex items-end justify-end gap-3 pb-1 flex-1 min-w-0">
          <SectionSwitch />
          <LanguagePill />
          <button
            aria-label="Account"
            className="w-8 h-8 rounded-full border border-ink bg-vellum flex items-center justify-center text-ink-soft hover:bg-paper-deep transition-colors"
          >
            <User size={14} />
          </button>
        </div>
      </div>
    </header>
  );
}

function LanguagePill() {
  const [lang, setLang] = useLanguage();
  const current = LANGUAGES.find((l) => l.value === lang) ?? LANGUAGES[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Output language"
        title="Output language for chat and generation"
        className="inline-flex items-center gap-1.5 px-2.5 py-1 border border-rule rounded-[1px] font-mono text-[10px] tracking-[0.14em] uppercase text-ink-fade hover:text-ink hover:border-ink transition-colors data-[state=open]:text-ink data-[state=open]:border-ink"
      >
        <Languages size={13} />
        {current.native}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[180px]">
        <div className="px-2 py-1.5 font-mono text-[9px] tracking-[0.2em] uppercase text-ink-mute">
          Output language
        </div>
        <DropdownMenuSeparator />
        {LANGUAGES.map((l) => (
          <DropdownMenuItem
            key={l.value}
            onClick={() => setLang(l.value as Language)}
            className={l.value === lang ? "font-semibold text-ink" : ""}
          >
            <span className="flex-1">{l.native}</span>
            {l.value === lang && (
              <span className="font-mono text-[9px] tracking-[0.1em] uppercase text-terracotta">
                Active
              </span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
