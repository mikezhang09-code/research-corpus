"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

export function CollapsedRail({
  side,
  label,
  onExpand,
}: {
  side: "left" | "right";
  label: string;
  onExpand: () => void;
}) {
  const Icon = side === "left" ? ChevronRight : ChevronLeft;
  const border = side === "left" ? "border-r" : "border-l";
  return (
    <div className={`w-11 shrink-0 ${border} border-rule bg-vellum flex flex-col items-center pt-4 pb-3 gap-3 sticky top-0 h-full`}>
      <button
        type="button"
        aria-label={`Expand ${label}`}
        onClick={onExpand}
        className="h-7 w-7 rounded-[1px] border border-rule hover:border-ink bg-paper-light hover:bg-paper-deep text-ink-fade hover:text-ink flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
      >
        <Icon className="h-3.5 w-3.5" />
      </button>
      <div
        className="font-mono text-[10px] tracking-[0.22em] uppercase text-ink-fade select-none"
        style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
      >
        {label}
      </div>
    </div>
  );
}

export function CollapseButton({
  side,
  onClick,
  title,
}: {
  side: "left" | "right";
  onClick: () => void;
  title?: string;
}) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  const positionClass = side === "left" ? "right-2" : "left-2";
  return (
    <button
      type="button"
      aria-label={title ?? (side === "left" ? "Collapse content" : "Collapse chat")}
      title={title ?? (side === "left" ? "Collapse content panel" : "Collapse chat panel")}
      onClick={onClick}
      className={`absolute top-3 ${positionClass} h-7 w-7 rounded-[1px] border border-rule hover:border-ink bg-paper-light/90 hover:bg-paper-deep text-ink-fade hover:text-ink flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink z-10`}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}
