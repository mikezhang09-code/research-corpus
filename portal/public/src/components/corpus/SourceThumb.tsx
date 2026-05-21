import { clsx } from "clsx";

export type SourceKind = "pdf" | "md" | "image" | "audio" | "html" | "pptx" | "url";

const LABEL: Record<SourceKind, string> = {
  pdf:   "PDF",
  md:    "MD",
  image: "IMG",
  audio: "WAV",
  html:  "HTM",
  pptx:  "PPT",
  url:   "URL",
};

export function SourceThumb({ kind, title }: { kind: SourceKind; title?: string }) {
  return (
    <div className={clsx("src-thumb", `src-thumb-${kind}`)} title={title ?? LABEL[kind]}>
      <span className="src-thumb-glyph">{LABEL[kind]}</span>
    </div>
  );
}
