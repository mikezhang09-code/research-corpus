import type { ReactNode } from "react";
import { Masthead } from "@/components/corpus/Masthead";
import { SectionSwitch } from "@/components/corpus/SectionSwitch";

export default function CorpusLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen relative z-[1]">
      <Masthead />
      <div className="px-14 pt-2 pb-6">
        <SectionSwitch />
      </div>
      <main>{children}</main>
    </div>
  );
}
