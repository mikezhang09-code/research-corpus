import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * False on the server and during hydration, true right after. Use it for
 * values that legitimately differ between the server and the browser — local
 * dates above all: the server renders in UTC, the reader may be in UTC+8, and
 * a date near midnight would print as different days, which React reports as
 * a hydration error. Render the server-safe form until this flips.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
