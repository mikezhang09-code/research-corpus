"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getLibraryNotebookFiles, type LibraryFile } from "@/lib/api";
import { FileCard } from "./FileCard";
import { AddFileModal } from "./AddFileModal";

const CATEGORIES = [
  { value: "",        label: "All"      },
  { value: "slide",   label: "Slides"   },
  { value: "note",    label: "Notes"    },
  { value: "report",  label: "Reports"  },
  { value: "audio",   label: "Audio"    },
  { value: "video",   label: "Video"    },
  { value: "mindmap", label: "Mindmap"  },
  { value: "image",   label: "Images"   },
];

export function FilesPanel({ notebookId }: { notebookId: string }) {
  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const loadFiles = useCallback(async (category: string) => {
    setLoading(true);
    try {
      const data = await getLibraryNotebookFiles(notebookId, { category: category || undefined });
      setFiles(data);
    } finally {
      setLoading(false);
    }
  }, [notebookId]);

  useEffect(() => {
    loadFiles(activeCategory);
  }, [activeCategory, loadFiles]);

  function handleCategoryChange(cat: string) {
    setActiveCategory(cat);
  }

  function handleFileDeleted(fileId: string) {
    setFiles((prev) => prev.filter((f) => f.id !== fileId));
  }

  return (
    <div className="space-y-4">
      {/* Category filter pills */}
      <div className="flex gap-2 flex-wrap">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.value}
            onClick={() => handleCategoryChange(cat.value)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              activeCategory === cat.value
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {cat.label}
          </button>
        ))}
        <Button
          size="sm"
          className="gap-1.5 h-7 text-xs rounded-full ml-auto"
          onClick={() => setShowAdd(true)}
        >
          <Plus className="h-3.5 w-3.5" />
          Add file
        </Button>
      </div>

      {/* File grid */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-2xl overflow-hidden border border-border/50">
              <Skeleton className="h-32 w-full" />
              <div className="p-4 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : files.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
          <Loader2 className="h-8 w-8 opacity-10" />
          <p className="text-sm font-medium">
            {activeCategory ? `No ${activeCategory} files yet` : "No files yet"}
          </p>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowAdd(true)}>
            <Plus className="h-3.5 w-3.5" />
            Add your first file
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {files.map((f) => (
            <FileCard
              key={f.id}
              file={f}
              onDeleted={() => handleFileDeleted(f.id)}
            />
          ))}
        </div>
      )}

      {showAdd && (
        <AddFileModal
          notebookId={notebookId}
          onClose={() => setShowAdd(false)}
          onUploaded={(newFile) => {
            setFiles((prev) => [newFile, ...prev]);
            setShowAdd(false);
          }}
        />
      )}
    </div>
  );
}
