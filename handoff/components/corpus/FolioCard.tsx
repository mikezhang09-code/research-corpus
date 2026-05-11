"use client";

import type { ReactNode } from "react";
import { SourceThumb, type SourceKind } from "@/components/corpus/SourceThumb";

export type FolioCover = "stitch" | "manila" | "index" | "pinned" | "photo";
export type FolioStatus = "active" | "draft" | "archived";

export type FolioCardProps = {
  folio: string;            // "MR-002-蜻蜓"
  title: string;
  titleEn?: string;
  status: FolioStatus;
  cover: FolioCover;
  sources: { kind: SourceKind; name: string }[];
  excerpt: string;
  tags: string[];
  updated: string;
  accent?: string;
  onClick?: () => void;
};

export function FolioCard({
  folio, title, titleEn, status, cover, sources, excerpt, tags, updated, accent, onClick,
}: FolioCardProps) {
  // Up to 5 distinct kinds; rest as "+N"
  const distinct: SourceKind[] = [];
  for (const s of sources) {
    if (!distinct.includes(s.kind)) distinct.push(s.kind);
    if (distinct.length === 5) break;
  }
  const extra = sources.length - distinct.length;

  const tabLabel = `${folio} · ${status.toUpperCase()}`;
  const accentStyle = accent ? ({ "--accent": accent } as React.CSSProperties) : undefined;

  return (
    <article
      onClick={onClick}
      className="cursor-pointer transition-transform hover:-translate-y-px"
      style={accentStyle}
    >
      <div
        className={`cover-${cover}`}
        data-tab={cover === "manila" ? tabLabel : undefined}
      >
        {/* Header */}
        {cover !== "manila" && (
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-[10px] tracking-[0.16em] uppercase text-ink-mute">
              {folio}
            </span>
            <StatusChip status={status} />
          </div>
        )}
        {cover === "manila" && (
          <div className="flex justify-end mb-1">
            <StatusChip status={status} />
          </div>
        )}

        {/* Title */}
        <h3 className="font-serif-display text-[24px] leading-[1.1] tracking-tight text-ink mb-1 line-clamp-2">
          {title}
        </h3>
        {titleEn && (
          <div className="font-serif italic text-[13px] text-ink-fade leading-snug mb-2 line-clamp-1">
            {titleEn}
          </div>
        )}

        {/* Source thumbnails */}
        <div className="flex items-end gap-1.5 mt-3 mb-3">
          {distinct.map((kind, i) => (
            <SourceThumb key={`${kind}-${i}`} kind={kind} />
          ))}
          {extra > 0 && (
            <div className="src-thumb bg-paper-deep">
              <span className="src-thumb-glyph">+{extra}</span>
            </div>
          )}
        </div>

        {/* Excerpt */}
        <p className="font-serif text-[13.5px] leading-[1.5] text-ink-soft line-clamp-3 mb-3">
          {excerpt}
        </p>

        {/* Tags + meta */}
        <div className="pt-2.5 border-t border-rule-light flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            {tags.slice(0, 3).map((t) => (
              <span
                key={t}
                className="font-mono text-[9px] tracking-[0.14em] uppercase px-1.5 py-0.5 border border-rule text-ink-fade rounded-[1px]"
              >
                {t}
              </span>
            ))}
          </div>
          <span className="font-mono text-[9.5px] tracking-[0.14em] uppercase text-ink-mute whitespace-nowrap">
            {formatRelative(updated)}
          </span>
        </div>
      </div>
    </article>
  );
}

function StatusChip({ status }: { status: FolioStatus }) {
  const map: Record<FolioStatus, { label: string; cls: string }> = {
    active:   { label: "Active",   cls: "border-mint text-mint" },
    draft:    { label: "Draft",    cls: "border-ochre text-ochre" },
    archived: { label: "Archived", cls: "border-ink-mute text-ink-mute" },
  };
  const s = map[status];
  return (
    <span className={`font-mono text-[9px] tracking-[0.16em] uppercase px-1.5 py-0.5 border rounded-[1px] ${s.cls}`}>
      {s.label}
    </span>
  );
}

function formatRelative(s: string) {
  try {
    const d = new Date(s);
    const days = Math.round((Date.now() - d.getTime()) / 86_400_000);
    if (days < 1) return "today";
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.round(days / 7)}w ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch { return s; }
}

const COVERS: FolioCover[] = ["stitch", "manila", "index", "pinned", "photo"];
export function pickCover(id: string): FolioCover {
  let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return COVERS[Math.abs(h) % COVERS.length];
}
