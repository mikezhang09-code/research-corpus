import type { ReactNode } from "react";
import { Masthead } from "@/components/corpus/Masthead";

export default function CorpusLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen relative z-[1]">
      <Masthead />
      <main>{children}</main>
    </div>
  );
}
