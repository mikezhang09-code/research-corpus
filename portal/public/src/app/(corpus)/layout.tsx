import type { ReactNode } from "react";
import { cookies, headers } from "next/headers";
import { Masthead } from "@/components/corpus/Masthead";
import { RoleProvider } from "@/hooks/use-role";
import { AUTH_COOKIE, isAccessProtectedHost, requestRole } from "@/lib/auth";

export default async function CorpusLayout({ children }: { children: ReactNode }) {
  const host = (await headers()).get("host");
  const cookie = (await cookies()).get(AUTH_COOKIE)?.value;
  // The middleware already rejected unauthenticated requests; a null role here
  // only happens under `next dev` without passwords, which runs as admin.
  const role = (await requestRole(host, cookie)) ?? "admin";
  const canLogout = !isAccessProtectedHost(host) && !!cookie;

  return (
    <RoleProvider value={{ role, canLogout }}>
      <div className="min-h-screen relative z-[1]">
        <Masthead />
        <main>{children}</main>
      </div>
    </RoleProvider>
  );
}
