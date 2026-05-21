"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
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
import { getArtifacts, getLibraryNotebooks } from "@/lib/api";

export function Masthead() {
  return (
    <header className="px-14 pt-8 pb-5 border-b border-rule relative">
      <div className="flex items-end justify-between gap-6">
        <div className="flex items-baseline gap-5 shrink-0">
          <RomanDate />
          <h1 className="font-serif-display text-[44px] leading-[0.95] tracking-tight">
            Research <span className="italic">Corpus</span>
          </h1>
          <ArchiveCount />
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

/** Today in elegant Latin: <month> · <day> · <year>, all Roman numerals. */
function RomanDate() {
  // Mount-gated so SSR and the first client paint render the same placeholder
  // (otherwise hydration warns when the server's date differs by timezone).
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    // Tick at midnight so the date doesn't go stale if the tab is left open.
    const next = new Date();
    next.setHours(24, 0, 5, 0);
    const t = setTimeout(() => setNow(new Date()), next.getTime() - Date.now());
    return () => clearTimeout(t);
  }, []);

  const label = now
    ? `${toRoman(now.getMonth() + 1)} · ${toRoman(now.getDate())} · ${toRoman(now.getFullYear())}`
    : "— · — · —";
  return (
    <div
      className="font-mono text-[10px] tracking-[0.2em] uppercase text-ink-mute leading-none pb-1"
      title={now ? now.toDateString() : undefined}
    >
      {label}
    </div>
  );
}

/** Live total of NotebookLM corpora + library folios; refetches on route change. */
function ArchiveCount() {
  const pathname = usePathname();
  const [counts, setCounts] = useState<{ corpora: number; folios: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getArtifacts({ limit: 200 }).catch(() => ({ items: [], total: 0 })),
      getLibraryNotebooks().catch(() => ({ items: [], total: 0 })),
    ])
      .then(([arts, lib]) => {
        if (cancelled) return;
        // One "corpus" per distinct notebook that has saved artifacts.
        const corpora = new Set(
          arts.items
            .map((a) => a.notebook_id)
            .filter((id): id is string => !!id),
        ).size;
        const folios = lib.items.length;
        setCounts({ corpora, folios });
      });
    return () => { cancelled = true; };
  }, [pathname]);

  if (!counts) {
    return (
      <div className="font-mono text-[10px] tracking-[0.2em] uppercase text-ink-mute pb-1">
        — · —
      </div>
    );
  }
  const { corpora, folios } = counts;
  return (
    <div
      className="font-mono text-[10px] tracking-[0.2em] uppercase text-ink-mute pb-1"
      title="NotebookLM notebooks with saved artifacts · Personal folios in My Research"
    >
      {corpora} {corpora === 1 ? "corpus" : "corpora"} · {folios} {folios === 1 ? "folio" : "folios"}
    </div>
  );
}

function toRoman(n: number): string {
  if (n <= 0) return "—";
  const map: [number, string][] = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
    [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let out = "";
  for (const [v, sym] of map) {
    while (n >= v) { out += sym; n -= v; }
  }
  return out;
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
