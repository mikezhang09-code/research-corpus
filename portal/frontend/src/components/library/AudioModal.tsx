"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AudioModal({
  src,
  title,
  onClose,
}: {
  src: string;
  title: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-vellum rounded-[2px] border border-ink shadow-[4px_4px_0_rgb(42_36_24_/_0.18)] w-full max-w-md flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule shrink-0">
          <h2 className="font-serif-display text-[22px] leading-tight tracking-tight text-ink line-clamp-1">{title}</h2>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-ink-fade hover:text-ink" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="p-6">
          <audio controls src={src} className="w-full">
            Your browser does not support the audio element.
          </audio>
        </div>
      </div>
    </div>
  );
}
