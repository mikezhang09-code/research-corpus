"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Role } from "@/lib/auth";

// The signed-in role, resolved server-side in the (corpus) layout. UI uses it
// to hide controls a viewer can't use; the middleware is what enforces access.
type RoleInfo = { role: Role; canLogout: boolean };

const RoleContext = createContext<RoleInfo>({ role: "admin", canLogout: false });

export function RoleProvider({ value, children }: { value: RoleInfo; children: ReactNode }) {
  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export const useRole = () => useContext(RoleContext);
export const useIsViewer = () => useContext(RoleContext).role === "viewer";
