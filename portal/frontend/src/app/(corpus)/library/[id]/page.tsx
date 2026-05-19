"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, MessageSquare, MoreVertical, Pencil, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getLibraryNotebook, updateLibraryNotebook, type LibraryNotebook } from "@/lib/api";
import { ChatPanel, type ChatPanelHandle } from "@/components/notebook/ChatPanel";
import { EmojiPicker } from "@/components/notebook/EmojiPicker";
import { emojiFromSeed } from "@/components/notebook/emoji";
import { LibraryNotebookDescription } from "@/components/library/LibraryNotebookDescription";
import { FilesPanel } from "@/components/library/FilesPanel";
import { TagInput } from "@/components/library/TagInput";
import { CollapsedRail, CollapseButton } from "@/components/corpus/CollapsiblePanel";
import { useIsMobile } from "@/hooks/use-mobile";

export default function LibraryNotebookDetailPage() {
  const params = useParams();
  const router = useRouter();
  const notebookId = params.id as string;
  const isMobile = useIsMobile();
  const chatRef = useRef<ChatPanelHandle | null>(null);

  const [notebook, setNotebook] = useState<LibraryNotebook | null>(null);
  const [loading, setLoading] = useState(true);
  const [showEdit, setShowEdit] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  useEffect(() => {
    getLibraryNotebook(notebookId)
      .then(setNotebook)
      .finally(() => setLoading(false));
  }, [notebookId]);

  if (loading) {
    return (
      <div className="flex h-full min-h-0">
        <div className="flex-1 p-10 space-y-6">
          <Skeleton className="h-6 w-40 rounded-[1px]" />
          <Skeleton className="h-10 w-64 rounded-[1px]" />
          <Skeleton className="h-20 w-full rounded-[1px]" />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-52 rounded-[2px]" />)}
          </div>
        </div>
      </div>
    );
  }

  if (!notebook) {
    return (
      <div className="p-10 font-serif italic text-ink-fade">Notebook not found.</div>
    );
  }

  const emoji = notebook.cover_emoji || emojiFromSeed(notebook.id);

  return (
    <div className="flex h-full min-h-0">
      {/* Left rail (collapsed) */}
      {leftCollapsed && (
        <CollapsedRail
          side="left"
          label="Folio"
          onExpand={() => setLeftCollapsed(false)}
        />
      )}

      {/* Left column */}
      {!leftCollapsed && (
      <div className="flex-1 min-w-0 overflow-auto px-10 py-8 space-y-6 border-r border-rule relative">
        {/* Back navigation */}
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 -ml-2 font-mono text-[10px] tracking-[0.18em] uppercase text-ink-fade hover:text-ink"
            onClick={() => router.push("/library")}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            My Research
          </Button>
        </div>

        {/* Header */}
        <div className="flex items-start gap-4 pb-4 border-b border-rule">
          <span className="text-4xl leading-none shrink-0 mt-1" aria-hidden="true">{emoji}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="font-serif-display text-[32px] leading-[1.05] tracking-tight text-ink truncate">{notebook.title}</h1>
              <DropdownMenu>
                <DropdownMenuTrigger className="h-7 w-7 shrink-0 inline-flex items-center justify-center rounded-[1px] text-ink-fade hover:text-ink hover:bg-paper-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink">
                  <MoreVertical className="h-4 w-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => setShowEdit(true)}>
                    <Pencil className="h-4 w-4" /> Edit (title &amp; emoji)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-ink-mute mt-2">
              {notebook.file_count} file{notebook.file_count !== 1 ? "s" : ""}
            </p>
          </div>
        </div>

        {/* Description */}
        <LibraryNotebookDescription
          notebookId={notebookId}
          initialDescription={notebook.description}
          onSave={(desc) => setNotebook((nb) => nb ? { ...nb, description: desc } : nb)}
        />

        {/* Tags */}
        <div>
          <label className="block font-mono text-[10px] tracking-[0.18em] uppercase text-ink-mute mb-2">Tags</label>
          <TagInput
            value={notebook.tags}
            onChange={async (next) => {
              setNotebook((nb) => nb ? { ...nb, tags: next } : nb);
              try {
                const updated = await updateLibraryNotebook(notebookId, { tags: next });
                setNotebook(updated);
              } catch {
                // Revert on failure by re-fetching the source of truth.
                getLibraryNotebook(notebookId).then(setNotebook).catch(() => {});
              }
            }}
          />
        </div>

        {/* Tabs */}
        <Tabs defaultValue="files">
          <TabsList>
            <TabsTrigger value="files">Files</TabsTrigger>
            {isMobile && (
              <TabsTrigger value="chat">
                <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
                Chat
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="files" className="mt-4">
            <FilesPanel notebookId={notebookId} />
          </TabsContent>

          {isMobile && (
            <TabsContent value="chat" className="mt-4">
              <div className="h-[calc(100vh-16rem)] rounded-[2px] overflow-hidden border border-rule bg-vellum">
                <ChatPanel
                  ref={chatRef}
                  notebookId={notebookId}
                  apiPrefix="/api/library-notebooks"
                />
              </div>
            </TabsContent>
          )}
        </Tabs>

        <CollapseButton side="left" onClick={() => setLeftCollapsed(true)} />
      </div>
      )}

      {/* Right column: chat panel (desktop only).
          Grows to fill freed space when the left panel is collapsed. */}
      {!isMobile && !rightCollapsed && (
        <div
          className={`${leftCollapsed ? "flex-1 min-w-0" : "w-[400px] shrink-0"} h-[calc(100dvh-7rem)] sticky top-0 bg-vellum relative`}
        >
          <ChatPanel
            ref={chatRef}
            notebookId={notebookId}
            apiPrefix="/api/library-notebooks"
          />
          <CollapseButton side="right" onClick={() => setRightCollapsed(true)} />
        </div>
      )}

      {/* Right rail (collapsed) */}
      {!isMobile && rightCollapsed && (
        <CollapsedRail
          side="right"
          label="Marginalia"
          onExpand={() => setRightCollapsed(false)}
        />
      )}

      {/* Edit dialog */}
      {showEdit && (
        <EditDialog
          notebook={notebook}
          onClose={() => setShowEdit(false)}
          onSaved={(updated) => { setNotebook(updated); setShowEdit(false); }}
        />
      )}
    </div>
  );
}

function EditDialog({ notebook, onClose, onSaved }: {
  notebook: LibraryNotebook;
  onClose: () => void;
  onSaved: (updated: LibraryNotebook) => void;
}) {
  const [title, setTitle] = useState(notebook.title);
  const [emoji, setEmoji] = useState<string>(notebook.cover_emoji || emojiFromSeed(notebook.id));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const titleChanged = title.trim() !== notebook.title;
  const emojiChanged = emoji !== (notebook.cover_emoji || emojiFromSeed(notebook.id));
  const dirty = titleChanged || emojiChanged;

  async function handleSave() {
    const t = title.trim();
    if (!t) return;
    if (!dirty) { onClose(); return; }
    setSaving(true);
    setError(null);
    try {
      const updated = await updateLibraryNotebook(notebook.id, {
        ...(titleChanged ? { title: t } : {}),
        ...(emojiChanged ? { cover_emoji: emoji } : {}),
      });
      onSaved(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-serif-display text-[22px] tracking-tight">Edit notebook</DialogTitle>
        </DialogHeader>
        <div className="flex items-start gap-2">
          <EmojiPicker value={emoji} onChange={setEmoji} />
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSave(); } }}
            autoFocus
            disabled={saving}
            className="h-12"
          />
        </div>
        {error && <p className="font-mono text-[11px] tracking-[0.1em] uppercase text-terracotta">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !title.trim() || !dirty}>
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
