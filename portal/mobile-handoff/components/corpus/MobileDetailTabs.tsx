"use client";

const TABS = [
  { id: "synopsis", label: "Synopsis" },
  { id: "artifacts", label: "Artifacts" },
  { id: "sources", label: "Sources" },
  { id: "marginalia", label: "Marginalia" },
] as const;

export type DetailTab = (typeof TABS)[number]["id"];

/**
 * Sticky, horizontally-scrollable tab bar for detail pages on mobile.
 * Hide on desktop with the `md:hidden` you apply at the call site.
 */
export function MobileDetailTabs({
  value,
  onChange,
}: {
  value: DetailTab;
  onChange: (t: DetailTab) => void;
}) {
  return (
    <div className="sticky top-0 z-10 flex gap-1 px-4 border-b border-rule bg-paper overflow-x-auto no-scrollbar">
      {TABS.map((t) => {
        const active = value === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={[
              "whitespace-nowrap px-3 py-3 -mb-px border-b-2 transition-colors",
              "font-serif-display italic text-[17px]",
              active
                ? "text-ink border-terracotta"
                : "text-ink-fade border-transparent",
            ].join(" ")}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
