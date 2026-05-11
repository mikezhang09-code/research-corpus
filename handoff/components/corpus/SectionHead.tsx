export function SectionHead({
  eyebrow, title, count,
}: { eyebrow: string; title: string; count?: number }) {
  return (
    <div className="flex items-end justify-between px-14 pt-2 pb-6 border-b border-rule mb-8">
      <div>
        <div className="font-mono text-[10px] tracking-[0.2em] uppercase text-ink-mute mb-1">
          {eyebrow}
        </div>
        <h2 className="font-serif-display text-[34px] leading-[0.95] tracking-tight text-ink">
          {title}
        </h2>
      </div>
      {count !== undefined && (
        <span className="font-mono text-[10px] tracking-[0.18em] uppercase text-ink-fade pb-2">
          {count} entries
        </span>
      )}
    </div>
  );
}
