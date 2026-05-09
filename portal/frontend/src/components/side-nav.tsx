"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Library, LayoutDashboard } from "lucide-react";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/notebooklm", label: "NotebookLM", icon: BookOpen },
  { href: "/library", label: "Library", icon: Library },
];

export function SideNav() {
  const pathname = usePathname();
  return (
    <aside className="w-56 shrink-0 border-r bg-muted/30 flex flex-col py-6 gap-1 px-3">
      <div className="px-3 mb-6">
        <span className="text-sm font-semibold tracking-tight text-foreground/80">
          Research Portal
        </span>
      </div>
      {links.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className={cn(
            "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
            pathname === href
              ? "bg-background shadow-sm font-medium text-foreground"
              : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
          )}
        >
          <Icon className="h-4 w-4 shrink-0" />
          {label}
        </Link>
      ))}
    </aside>
  );
}
