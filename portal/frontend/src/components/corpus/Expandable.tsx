"use client";

import { Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Maximize / restore toggle for artifact viewer modals.
 * Sits next to the X close button in the modal header.
 */
export function ExpandButton({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
}) {
  const Icon = expanded ? Minimize2 : Maximize2;
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8 shrink-0 text-ink-fade hover:text-ink"
      onClick={onToggle}
      aria-label={expanded ? "Restore" : "Expand"}
      title={expanded ? "Restore" : "Expand"}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}

/**
 * Tailwind classes to apply to a modal's inner container when expanded —
 * fills the viewport minus a small margin so the backdrop is still visible
 * around the edge for the click-outside-to-close affordance.
 */
export const EXPANDED_MODAL =
  "w-[calc(100vw-1rem)] h-[calc(100vh-1rem)] max-w-none max-h-none";
