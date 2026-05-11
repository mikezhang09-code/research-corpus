"use client";

import { useMemo } from "react";
import type { ReactNode } from "react";

export type CorpusCardProps = {
  number: number;
  domain: string;          // "Finance" | "Academic" | etc.
  title: string;
  titleEn?: string;
  date: string;            // ISO or formatted
  sources: number;
  swatch?: "terracotta" | "sage" | "lavender" | "ochre" | "blush" | "sky";
  glyph?: ReactNode;       // optional SVG glyph; falls back to abstract mark
  onClick?: () => void;
};

const SWATCHES: Record<NonNullable<CorpusCardProps["swatch"]>, { bg: string; fg: string }> = {
  terracotta: { bg: "#f5e2d4", fg: "var(--color-terracotta)" },
  sage:       { bg: "#dde2cf", fg: "var(--color-sage)" },
  lavender:   { bg: "#dcd5e8", fg: "var(--color-lavender)" },
  ochre:      { bg: "#ece0c2", fg: "var(--color-ochre)" },
  blush:      { bg: "#ecd5d6", fg: "var(--color-blush)" },
  sky:        { bg: "#cfd9e3", fg: "var(--color-sky)" },
};

export function CorpusCard({
  number, domain, title, titleEn, date, sources,
  swatch = "terracotta", glyph, onClick,
}: CorpusCardProps) {
  const sw = SWATCHES[swatch];
  const num = useMemo(() => String(number).padStart(3, "0"), [number]);

  return (
    <article
      onClick={onClick}
      className="group cursor-pointer bg-vellum border border-ink rounded-[2px] overflow-hidden shadow-[2px_2px_0_rgb(42_36_24_/_0.08)] hover:shadow-[3px_3px_0_rgb(42_36_24_/_0.14)] hover:-translate-y-px transition-all"
    >
      {/* Color block + glyph */}
      <div
        className="relative aspect-[5/3] flex items-center justify-center border-b border-ink"
        style={{ background: sw.bg, color: sw.fg }}
      >
        <div className="opacity-80 group-hover:opacity-100 transition-opacity">
          {glyph ?? <DefaultGlyph />}
        </div>
        <span className="absolute top-2.5 left-3 font-mono text-[10px] tracking-[0.18em] uppercase text-ink-soft">
          № {num}
        </span>
        <span className="absolute top-2.5 right-3 font-mono text-[10px] tracking-[0.18em] uppercase text-ink-soft">
          {domain}
        </span>
      </div>

      {/* Caption */}
      <div className="px-4 py-3.5">
        <h3 className="font-serif-display text-[20px] leading-[1.15] tracking-tight text-ink mb-0.5 line-clamp-2">
          {title}
        </h3>
        {titleEn && (
          <div className="font-serif italic text-[12.5px] text-ink-fade leading-snug line-clamp-1">
            {titleEn}
          </div>
        )}
        <div className="mt-3 pt-2.5 border-t border-rule-light flex items-center justify-between font-mono text-[10px] tracking-[0.12em] uppercase text-ink-mute">
          <span>{formatDate(date)}</span>
          <span>{sources} src</span>
        </div>
      </div>
    </article>
  );
}

function DefaultGlyph() {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
      <circle cx="32" cy="32" r="22" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="32" cy="32" r="10" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 32 H54 M32 10 V54" stroke="currentColor" strokeWidth="1" opacity="0.5" />
    </svg>
  );
}

function formatDate(s: string) {
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch { return s; }
}

/* ── Helpers for picking cards deterministically from your data ──────── */

const SWATCH_LIST = ["terracotta", "sage", "lavender", "ochre", "blush", "sky"] as const;
export function pickSwatch(nb: { id: string }): CorpusCardProps["swatch"] {
  let h = 0; for (const c of nb.id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return SWATCH_LIST[Math.abs(h) % SWATCH_LIST.length];
}

// You can extend pickGlyph with domain-specific SVGs from your icon library
export function pickGlyph(_nb: unknown): ReactNode {
  return <DefaultGlyph />;
}
