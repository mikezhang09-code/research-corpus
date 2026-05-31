import type { ReactNode } from "react";

/**
 * Horizontal-scroll strip on mobile; wraps normally on desktop.
 * Use for tag bars and filter chips.
 */
export function ScrollStrip({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={[
        "flex gap-1.5 overflow-x-auto no-scrollbar py-3",
        "md:flex-wrap md:overflow-visible",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}
