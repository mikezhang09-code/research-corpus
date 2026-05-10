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
      className="fixed inset-0 z-40 bg-black/30"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="menu"
        aria-label="Generate artifact"
        className="absolute right-8 top-32 w-60 rounded-2xl bg-card shadow-2xl border border-border/50 p-1.5"
      >
        <p className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Generate
        </p>
        {TYPE_DEFS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              role="menuitem"
              onClick={() => onPick(t.key)}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm hover:bg-accent transition-colors text-left"
            >
              <span className={`flex items-center justify-center h-7 w-7 rounded-md ${t.bg}`}>
                <Icon className={`h-4 w-4 ${t.iconColor}`} />
              </span>
              <span className="font-medium">{t.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
