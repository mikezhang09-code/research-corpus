"use client";

import { useEffect, useRef, useState } from "react";
import { Upload, Link2, Library, FileText, Music, Video, Image, Globe, Play, Folder } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { deleteLibraryItem, getCollections, getLibraryItems, type LibraryItem } from "@/lib/api";

const SOURCE_ICONS: Record<string, React.ElementType> = {
  upload: FileText,
  drive: FileText,
  youtube_link: Play,
  web_link: Globe,
};

const EXT_ICONS: Record<string, React.ElementType> = {
  ".mp3": Music,
  ".mp4": Video,
  ".png": Image,
  ".jpg": Image,
  ".jpeg": Image,
};

function LibraryCard({ item, onDelete }: { item: LibraryItem; onDelete: () => void }) {
  const Icon = EXT_ICONS[item.file_ext ?? ""] ?? SOURCE_ICONS[item.source_type] ?? FileText;
  const size = item.file_size_bytes
    ? item.file_size_bytes > 1_000_000
      ? `${(item.file_size_bytes / 1_000_000).toFixed(1)} MB`
      : `${Math.round(item.file_size_bytes / 1024)} KB`
    : null;

  return (
    <Card className="group hover:shadow-md transition-shadow border-border/60">
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <div className="shrink-0 rounded-md bg-violet-500/10 p-2">
            <Icon className="h-4 w-4 text-violet-600" />
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="text-sm font-medium truncate">{item.title || item.original_name}</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{item.original_name}</p>
          </div>
          <Badge
            variant="outline"
            className="shrink-0 text-xs capitalize border-violet-200 text-violet-600 bg-violet-500/5"
          >
            {item.source_type.replace("_", " ")}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {item.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">{item.description}</p>
        )}
        <div className="flex items-center justify-between">
          <div className="flex gap-1 flex-wrap items-center">
            {item.file_ext && (
              <Badge variant="outline" className="text-xs uppercase">{item.file_ext.slice(1)}</Badge>
            )}
            {size && <span className="text-xs text-muted-foreground">{size}</span>}
            {item.collection && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Folder className="h-3 w-3" />{item.collection}
              </span>
            )}
          </div>
          <div className="flex gap-1">
            {(item.r2_url || item.external_url) && (
              <a href={item.r2_url ?? item.external_url ?? "#"} target="_blank" rel="noopener noreferrer">
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">Open</Button>
              </a>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-destructive hover:text-destructive"
              onClick={async () => { await deleteLibraryItem(item.id); onDelete(); }}
            >
              Delete
            </Button>
          </div>
        </div>
        {item.tags.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {item.tags.map((t) => (
              <Badge key={t} variant="outline" className="text-xs text-muted-foreground">{t}</Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function LibraryPage() {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [collections, setCollections] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [activeCollection, setActiveCollection] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load(q = search, col = activeCollection) {
    setLoading(true);
    const params: Record<string, string> = {};
    if (q) params.search = q;
    if (col) params.collection = col;
    const [lib, cols] = await Promise.all([getLibraryItems(params), getCollections()]);
    setItems(lib.items);
    setTotal(lib.total);
    setCollections(cols);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const form = new FormData();
    form.append("file", file);
    form.append("title", file.name);
    await fetch("http://localhost:8000/api/library/upload", { method: "POST", body: form });
    await load();
    setUploading(false);
    e.target.value = "";
  }

  return (
    <div className="p-8 space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Library className="h-6 w-6 text-violet-600" />
            Library
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {total} item{total !== 1 ? "s" : ""} · {collections.length} collection{collections.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" className="hidden" onChange={handleUpload} />
          <Button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            size="sm"
            className="gap-2 bg-violet-600 hover:bg-violet-700 text-white"
          >
            <Upload className="h-4 w-4" />
            {uploading ? "Uploading…" : "Upload file"}
          </Button>
        </div>
      </div>

      <div className="flex gap-6">
        {/* Collections sidebar */}
        {collections.length > 0 && (
          <aside className="w-44 shrink-0 space-y-1">
            <p className="text-xs font-medium text-muted-foreground px-2 mb-2">Collections</p>
            <button
              onClick={() => { setActiveCollection(null); load(search, null); }}
              className={`w-full text-left px-2 py-1.5 rounded text-sm transition-colors ${!activeCollection ? "bg-accent font-medium" : "text-muted-foreground hover:text-foreground hover:bg-accent/50"}`}
            >
              All items
            </button>
            {collections.map((c) => (
              <button
                key={c}
                onClick={() => { setActiveCollection(c); load(search, c); }}
                className={`w-full text-left px-2 py-1.5 rounded text-sm flex items-center gap-2 transition-colors ${activeCollection === c ? "bg-accent font-medium" : "text-muted-foreground hover:text-foreground hover:bg-accent/50"}`}
              >
                <Folder className="h-3.5 w-3.5 shrink-0" />{c}
              </button>
            ))}
          </aside>
        )}

        <div className="flex-1 space-y-4 min-w-0">
          <Input
            placeholder="Search library…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); load(e.target.value, activeCollection); }}
            className="max-w-sm"
          />

          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-44 rounded-xl" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground">
              <Library className="h-10 w-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No items yet. Upload a file to get started.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {items.map((item) => (
                <LibraryCard key={item.id} item={item} onDelete={() => load()} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
