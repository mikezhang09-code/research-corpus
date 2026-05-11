"use client";

import { TYPE_DEFS } from "./types";

export function GenerateActionSheet({
  onPick,
  onClose,
}: {
  onPick: (typeKey: string) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-40 bg-ink/30"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="menu"
        aria-label="Generate artifact"
        className="absolute right-8 top-32 w-64 rounded-[2px] bg-vellum shadow-[4px_4px_0_rgb(42_36_24_/_0.18)] border border-ink p-1.5"
      >
        <p className="px-3 py-2 font-mono text-[10px] font-semibold text-ink-mute tracking-[0.2em] uppercase">
          Generate
        </p>
        {TYPE_DEFS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              role="menuitem"
              onClick={() => onPick(t.key)}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-[1px] font-serif text-[14px] text-ink-soft hover:bg-paper-deep hover:text-ink transition-colors text-left"
            >
              <span className={`flex items-center justify-center h-7 w-7 rounded-[1px] border border-ink/20 ${t.bg}`}>
                <Icon className={`h-4 w-4 ${t.iconColor}`} />
              </span>
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
