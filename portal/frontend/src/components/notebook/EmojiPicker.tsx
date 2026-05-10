"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { EMOJI_PALETTE } from "./emoji";

/** Inline picker — renders a current-emoji button that toggles a 6-column grid below.
 *  The picker is anchored above its parent (no portal); use within modal forms. */
export function EmojiPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen((v) => !v)}
        className="h-12 w-12 text-2xl p-0 shrink-0"
        aria-label="Pick cover emoji"
      >
        {value}
      </Button>
      {open && (
        <div className="absolute z-50 top-full left-0 mt-2 grid grid-cols-6 gap-1 p-2 rounded-lg border bg-popover shadow-lg">
          {EMOJI_PALETTE.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => { onChange(e); setOpen(false); }}
              className={`h-9 w-9 text-xl rounded hover:bg-accent transition-colors flex items-center justify-center ${e === value ? "bg-primary/10 ring-1 ring-primary" : ""}`}
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
