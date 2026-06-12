"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next") ?? "/";
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    }).catch(() => null);
    if (res?.ok) {
      // Only follow same-origin paths from ?next= (no open redirect).
      router.replace(next.startsWith("/") && !next.startsWith("//") ? next : "/");
      return;
    }
    setBusy(false);
    setError(res?.status === 401 ? "Wrong password" : "Something went wrong — try again");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-paper border border-ink/15 bg-vellum p-8 shadow-sm"
      >
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <Lock className="h-5 w-5 text-ink-fade" />
          <h1 className="font-serif-display text-2xl font-semibold text-ink">
            Research Corpus
          </h1>
          <p className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-mute">
            Admin password required
          </p>
        </div>
        <Input
          type="password"
          autoFocus
          autoComplete="current-password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-[1px]"
        />
        {error && <p className="mt-2 text-xs text-terracotta">{error}</p>}
        <Button type="submit" disabled={!password || busy} className="mt-4 w-full rounded-[1px]">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {busy ? "Checking…" : "Enter"}
        </Button>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
