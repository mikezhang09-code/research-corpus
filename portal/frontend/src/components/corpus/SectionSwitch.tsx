"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/notebooklm", label: "NotebookLM", sub: "Curated corpora" },
  { href: "/library",    label: "My Research", sub: "Free-form folios" },
];

/**
 * Section switch.
 * - Mobile (<md): full-width segmented control, label + sub stacked.
 * - Desktop (md+): inline auto-width pills, label + sub on one baseline.
 */
export function SectionSwitch() {
  const pathname = usePathname() ?? "";
  return (
    <nav
      aria-label="Section"
      className="flex w-full md:w-auto md:inline-flex items-stretch border border-ink rounded-[2px] bg-vellum overflow-hidden shadow-[2px_2px_0_rgb(42_36_24_/_0.08)]"
    >
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={[
              "group flex-1 md:flex-none flex flex-col md:flex-row items-center md:items-baseline justify-center md:justify-start gap-0.5 md:gap-2",
              "px-3.5 py-1.5 border-r border-ink last:border-r-0 transition-colors",
              active
                ? "bg-ink text-paper"
                : "text-ink-soft hover:bg-paper-deep",
            ].join(" ")}
            aria-current={active ? "page" : undefined}
          >
            <span className="font-serif-display text-[15px] leading-none whitespace-nowrap">
              {tab.label}
            </span>
            <span
              className={[
                "font-mono text-[8.5px] tracking-[0.16em] uppercase",
                active ? "text-paper/70" : "text-ink-mute",
              ].join(" ")}
            >
              {tab.sub}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
