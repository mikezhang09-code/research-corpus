"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/notebooklm", label: "NotebookLM", sub: "Curated corpora" },
  { href: "/library",    label: "My Research", sub: "Free-form folios" },
];

export function SectionSwitch() {
  const pathname = usePathname() ?? "";
  return (
    <nav
      aria-label="Section"
      className="inline-flex items-stretch border border-ink rounded-[2px] bg-vellum overflow-hidden shadow-[2px_2px_0_rgb(42_36_24_/_0.08)]"
    >
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={[
              "group px-5 py-2.5 flex flex-col items-start gap-0.5 border-r border-ink last:border-r-0 transition-colors",
              active
                ? "bg-ink text-paper"
                : "text-ink-soft hover:bg-paper-deep",
            ].join(" ")}
            aria-current={active ? "page" : undefined}
          >
            <span className="font-serif-display text-[18px] leading-none">
              {tab.label}
            </span>
            <span
              className={[
                "font-mono text-[9.5px] tracking-[0.16em] uppercase",
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
