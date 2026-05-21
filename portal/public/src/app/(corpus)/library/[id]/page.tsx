"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FileCard } from "@/components/library/FileCard";
import {
  getLibraryNotebook,
  getLibraryNotebookFiles,
  type LibraryNotebook,
  type LibraryFile,
} from "@/lib/api";

export default function FolioDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [folio, setFolio] = useState<LibraryNotebook | null>(null);
  const [files, setFiles] = useState<LibraryFile[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getLibraryNotebook(id)
      .then((d) => { if (!cancelled) setFolio(d); })
      .catch(() => {});
    getLibraryNotebookFiles(id)
      .then((d) => { if (!cancelled) setFiles(d); })
      .catch(() => { if (!cancelled) setFiles([]); });
    return () => { cancelled = true; };
  }, [id]);

  const loading = files === null;

  return (
    <div className="px-14 py-8 space-y-6 pb-16">
      <Button
        variant="ghost"
        size="sm"
        className="gap-2 -ml-2 font-mono text-[10px] tracking-[0.18em] uppercase text-ink-fade hover:text-ink"
        onClick={() => router.push("/library")}
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        My Research
      </Button>

      <div className="pb-4 border-b border-rule">
        <div className="flex items-start gap-3">
          {folio?.cover_emoji && (
            <span className="text-4xl leading-none select-none" aria-hidden="true">
              {folio.cover_emoji}
            </span>
          )}
          <div className="min-w-0">
            <h1 className="font-serif-display text-[32px] leading-[1.05] tracking-tight text-ink">
              {folio?.title ?? (loading ? "Loading…" : "Folio")}
            </h1>
            {folio?.description?.trim() && (
              <p className="font-serif text-[14px] text-ink-soft mt-2 max-w-2xl leading-relaxed">
                {folio.description}
              </p>
            )}
          </div>
        </div>

        {folio?.tags && folio.tags.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap mt-3">
            {folio.tags.map((t) => (
              <span
                key={t}
                className="font-mono text-[9px] tracking-[0.14em] uppercase px-1.5 py-0.5 border border-rule text-ink-fade rounded-[1px]"
              >
                {t}
              </span>
            ))}
          </div>
        )}

        {!loading && (
          <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-ink-mute mt-3">
            {files.length} file{files.length !== 1 ? "s" : ""} · view-only
          </p>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-56 rounded-[2px]" />
          ))}
        </div>
      ) : files.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-ink-mute gap-3">
          <FileText className="h-12 w-12 opacity-30" />
          <p className="font-serif-display text-[20px] tracking-tight text-ink">No files</p>
          <p className="font-serif text-[14px] text-center max-w-xs text-ink-soft">
            This folio has no files yet.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {files.map((f) => (
            <FileCard key={f.id} file={f} />
          ))}
        </div>
      )}
    </div>
  );
}
