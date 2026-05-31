"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/notebooklm", label: "NotebookLM", sub: "Saved corpus" },
  { href: "/library",    label: "My Research", sub: "Free-form folios" },
];

/**
 * Responsive section switch.
 * - Mobile (<md): full-width segmented control, stacked label + sub.
 * - Desktop (md+): inline auto-width pills.
 */
export function SectionSwitch() {
  const pathname = usePathname() ?? "";
  return (
    <nav
      aria-label="Section"
      className="flex w-full md:w-auto md:inline-flex items-stretch border border-ink rounded-[3px] bg-vellum overflow-hidden shadow-[2px_2px_0_rgb(42_36_24_/_0.08)]"
    >
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={[
              "flex-1 md:flex-none flex flex-col items-center md:items-start gap-0.5",
              "px-3 md:px-5 py-2.5 border-r border-ink last:border-r-0 transition-colors",
              active ? "bg-ink text-paper" : "text-ink-soft hover:bg-paper-deep",
            ].join(" ")}
          >
            <span className="font-serif-display text-[15px] md:text-[18px] leading-none whitespace-nowrap">
              {tab.label}
            </span>
            <span
              className={[
                "font-mono text-[7.5px] md:text-[9.5px] tracking-[0.14em] uppercase",
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
