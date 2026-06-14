"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Avoids the "useLayoutEffect does nothing on the server" warning while still
// measuring synchronously before paint on the client (no chip flicker).
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

const GAP = 8; // matches gap-2

const chipBase =
  "inline-flex shrink-0 items-center gap-1.5 font-mono text-[10px] tracking-[0.14em] uppercase px-2 py-1 rounded-[1px] border transition-colors";

function chipClass(active: boolean, dim: boolean): string {
  return (
    chipBase +
    " " +
    (active
      ? "border-ink bg-ink text-paper"
      : dim
        ? "border-rule/60 bg-vellum text-ink-mute opacity-50 hover:opacity-100 hover:border-ink hover:text-ink"
        : "border-rule bg-vellum text-ink-fade hover:border-ink hover:text-ink")
  );
}

type TagFilterBarProps = {
  /** Tags in display order (most-counted first). */
  tags: string[];
  /** Live count of currently-visible items carrying each tag. */
  counts: Map<string, number>;
  selected: Set<string>;
  onToggle: (tag: string) => void;
  onClear: () => void;
  label?: string;
};

function TagChip({
  tag,
  active,
  count,
  onToggle,
}: {
  tag: string;
  active: boolean;
  count: number;
  onToggle: (tag: string) => void;
}) {
  return (
    <button type="button" onClick={() => onToggle(tag)} className={chipClass(active, !active && count === 0)}>
      {tag}
      <span className={active ? "text-paper/70" : "text-ink-mute"}>{count}</span>
    </button>
  );
}

/**
 * Single-line tag filter row. Chips are ordered live by their current visible
 * count (highest first), so selecting a tag re-sorts the row to surface the
 * tags still relevant to the filtered result and sinks the now-empty ones into
 * the right-aligned dropdown. Recomputes on resize so it stays one line on
 * desktop and mobile alike.
 */
export function TagFilterBar({ tags, counts, selected, onToggle, onClear, label = "Tags" }: TagFilterBarProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(tags.length);
  const hasSelection = selected.size > 0;

  // Order by live visible count, highest first. Sort is stable, so ties keep
  // the incoming order (the parent's total-count order) and chips only move
  // when their counts actually change.
  const orderedTags = useMemo(
    () => [...tags].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0)),
    [tags, counts],
  );

  useIsoLayoutEffect(() => {
    const row = rowRef.current;
    const measure = measureRef.current;
    if (!row || !measure) return;

    const compute = () => {
      const available = row.clientWidth;
      // Measurement layer order: [label, ...chips, trigger, clear]
      const nodes = Array.from(measure.children) as HTMLElement[];
      if (nodes.length < 3) return;
      const labelW = nodes[0].offsetWidth;
      const clearW = nodes[nodes.length - 1].offsetWidth;
      const triggerW = nodes[nodes.length - 2].offsetWidth;
      const chipNodes = nodes.slice(1, nodes.length - 2);
      const clearReserve = hasSelection ? GAP + clearW : 0;

      let used = labelW;
      let fit = 0;
      for (let i = 0; i < chipNodes.length; i++) {
        const next = used + GAP + chipNodes[i].offsetWidth;
        const isLast = i === chipNodes.length - 1;
        // Keep room for the overflow trigger unless this chip is the last one.
        const reserve = (isLast ? 0 : GAP + triggerW) + clearReserve;
        if (next + reserve > available) break;
        used = next;
        fit++;
      }
      setVisibleCount(fit);
    };

    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(row);
    return () => ro.disconnect();
  }, [orderedTags, hasSelection]);

  if (orderedTags.length === 0) return null;

  const visible = orderedTags.slice(0, visibleCount);
  const hiddenCount = orderedTags.length - visible.length;

  return (
    <div className="relative">
      {/* Hidden measurement layer: label + every chip + trigger + clear, never wraps. */}
      <div ref={measureRef} aria-hidden className="pointer-events-none absolute -z-10 flex items-center gap-2 whitespace-nowrap opacity-0">
        <span className="font-mono text-[10px] tracking-[0.18em] uppercase text-ink-mute shrink-0">{label}</span>
        {orderedTags.map((tag) => (
          <span key={tag} className={chipClass(false, false)}>
            {tag}
            <span>{counts.get(tag) ?? 0}</span>
          </span>
        ))}
        <span className={chipBase + " border-rule bg-vellum text-ink-fade"}>
          <ChevronDown className="h-3 w-3" />+{orderedTags.length}
        </span>
        <span className="inline-flex items-center gap-1 font-mono text-[10px] tracking-[0.14em] uppercase ml-1">
          <X className="h-3 w-3" />
          Clear
        </span>
      </div>

      {/* Visible single-line row. */}
      <div ref={rowRef} className="flex items-center gap-2 flex-nowrap overflow-hidden">
        <span className="font-mono text-[10px] tracking-[0.18em] uppercase text-ink-mute shrink-0">{label}</span>
        {visible.map((tag) => (
          <TagChip key={tag} tag={tag} active={selected.has(tag)} count={counts.get(tag) ?? 0} onToggle={onToggle} />
        ))}

        {hiddenCount > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger
              className={
                chipBase +
                " border-rule bg-vellum text-ink-fade hover:border-ink hover:text-ink data-[state=open]:border-ink data-[state=open]:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
              }
              aria-label={`Show all ${orderedTags.length} tags`}
            >
              <ChevronDown className="h-3 w-3" />+{hiddenCount}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-[60vh] overflow-y-auto p-2">
              <div className="flex flex-wrap gap-1.5 max-w-[min(22rem,80vw)]">
                {orderedTags.map((tag) => (
                  <TagChip key={tag} tag={tag} active={selected.has(tag)} count={counts.get(tag) ?? 0} onToggle={onToggle} />
                ))}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {hasSelection && (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px] tracking-[0.14em] uppercase text-ink-fade hover:text-ink underline-offset-2 hover:underline ml-1"
          >
            <X className="h-3 w-3" />
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
