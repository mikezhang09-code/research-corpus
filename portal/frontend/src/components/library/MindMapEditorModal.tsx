"use client";

import { useEffect, useMemo, useState } from "react";
import {
  X, Loader2, Save, AlertCircle, ChevronRight, Plus, ListPlus, Pencil,
  Trash2, ArrowUp, ArrowDown, Undo2, Redo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ExpandButton, EXPANDED_MODAL } from "@/components/corpus/Expandable";
import {
  uploadLibraryNotebookFile, updateLibraryNotebookFile, saveLibraryNoteContent,
  uploadFreeFormFile, updateFreeFormFile, saveFreeFormNoteContent,
  getLibraryFileContent, type LibraryFile,
} from "@/lib/api";
import {
  MM_NW, MM_NH, MM_NODE_COLORS, buildMindLayout, type MindNode,
} from "./mindmap-layout";

// The editor works on a normalized tree where every node has a stable runtime
// id — the layout's positional ids ("root-0-1") shift when siblings are
// inserted or removed, which would corrupt selection/collapse state mid-edit.
// Ids exist only in memory; saved JSON is plain { name, children }.
type EditNode = { id: string; name: string; children: EditNode[] };

let mmIdCounter = 0;
const newId = () => `mm${++mmIdCounter}`;

function toEditNode(n: MindNode): EditNode {
  return {
    id: newId(),
    name: n.name ?? n.title ?? "",
    children: (n.children ?? []).map(toEditNode),
  };
}

function toPlain(n: EditNode): MindNode {
  return n.children.length
    ? { name: n.name, children: n.children.map(toPlain) }
    : { name: n.name };
}

const serialize = (root: EditNode) => JSON.stringify(toPlain(root), null, 2);

// ---- immutable tree operations ----

function updateName(node: EditNode, id: string, name: string): EditNode {
  if (node.id === id) return { ...node, name };
  return { ...node, children: node.children.map((c) => updateName(c, id, name)) };
}

function addChild(node: EditNode, parentId: string, child: EditNode): EditNode {
  if (node.id === parentId) return { ...node, children: [...node.children, child] };
  return { ...node, children: node.children.map((c) => addChild(c, parentId, child)) };
}

function addSiblingAfter(node: EditNode, id: string, sibling: EditNode): EditNode {
  const idx = node.children.findIndex((c) => c.id === id);
  if (idx >= 0) {
    const next = [...node.children];
    next.splice(idx + 1, 0, sibling);
    return { ...node, children: next };
  }
  return { ...node, children: node.children.map((c) => addSiblingAfter(c, id, sibling)) };
}

function removeNode(node: EditNode, id: string): EditNode {
  return {
    ...node,
    children: node.children.filter((c) => c.id !== id).map((c) => removeNode(c, id)),
  };
}

function moveSibling(node: EditNode, id: string, dir: -1 | 1): EditNode {
  const idx = node.children.findIndex((c) => c.id === id);
  if (idx >= 0) {
    const j = idx + dir;
    if (j < 0 || j >= node.children.length) return node;
    const next = [...node.children];
    [next[idx], next[j]] = [next[j], next[idx]];
    return { ...node, children: next };
  }
  return { ...node, children: node.children.map((c) => moveSibling(c, id, dir)) };
}

function findNode(node: EditNode, id: string): EditNode | null {
  if (node.id === id) return node;
  for (const c of node.children) {
    const hit = findNode(c, id);
    if (hit) return hit;
  }
  return null;
}

function findParent(node: EditNode, id: string): EditNode | null {
  if (node.children.some((c) => c.id === id)) return node;
  for (const c of node.children) {
    const hit = findParent(c, id);
    if (hit) return hit;
  }
  return null;
}

function countDescendants(node: EditNode): number {
  return node.children.reduce((sum, c) => sum + 1 + countDescendants(c), 0);
}

const seedRoot = (): EditNode => ({ id: newId(), name: "Central topic", children: [] });

// Create or edit a mindmap visually — no JSON typing anywhere. A mindmap is
// a .json file (file_category "mindmap") in the { name, children } shape the
// viewers already read. Mirrors NoteEditorModal: create uploads a new file,
// edit overwrites the stored bytes. `notebookId: null` targets free-forms.
export function MindMapEditorModal<T extends { id: string; title: string } = LibraryFile>({
  notebookId,
  file,
  onClose,
  onSaved,
}: {
  /** Folio id, or null for a free-form mindmap. */
  notebookId: string | null;
  file?: T | null;
  onClose: () => void;
  onSaved: (file: T) => void;
}) {
  const isEdit = !!file;
  const [title, setTitle] = useState(file?.title ?? "");
  const [root, setRoot] = useState<EditNode | null>(isEdit ? null : seedRoot());
  const [initialJson, setInitialJson] = useState<string | null>(
    isEdit ? null : serialize(seedRoot())
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [undoStack, setUndoStack] = useState<EditNode[]>([]);
  const [redoStack, setRedoStack] = useState<EditNode[]>([]);
  const [loading, setLoading] = useState(isEdit);
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Edit mode: load and normalize the stored tree.
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    getLibraryFileContent(notebookId, file.id)
      .then((text) => {
        if (cancelled) return;
        const parsed: unknown = JSON.parse(text);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          throw new Error("Not a mindmap: expected a JSON object with name/children");
        }
        const tree = toEditNode(parsed as MindNode);
        setInitialJson(serialize(tree));
        setRoot(tree);
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [file, notebookId]);

  const layout = useMemo(() => root ? buildMindLayout(root, collapsed) : null, [root, collapsed]);

  const dirty =
    root !== null &&
    (file
      ? title.trim() !== file.title || serialize(root) !== initialJson
      : title.trim().length > 0 || serialize(root) !== initialJson);

  function requestClose() {
    if (saving) return;
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    onClose();
  }

  // ---- mutation plumbing: every edit goes through apply() for undo ----

  function apply(next: EditNode) {
    if (!root) return;
    setUndoStack((s) => [...s.slice(-99), root]);
    setRedoStack([]);
    setRoot(next);
  }

  function undo() {
    if (!root || undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack((s) => s.slice(0, -1));
    setRedoStack((s) => [...s, root]);
    setRoot(prev);
    setEditingId(null);
  }

  function redo() {
    if (!root || redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((s) => s.slice(0, -1));
    setUndoStack((s) => [...s, root]);
    setRoot(next);
    setEditingId(null);
  }

  // ---- editing actions ----

  function startRename(id: string) {
    if (!root) return;
    const node = findNode(root, id);
    if (!node) return;
    setSelectedId(id);
    setEditingId(id);
    setEditText(node.name);
  }

  function commitRename() {
    if (!root || !editingId) return;
    const name = editText.trim() || "Untitled";
    const node = findNode(root, editingId);
    if (node && node.name !== name) apply(updateName(root, editingId, name));
    setEditingId(null);
  }

  function handleAddChild(parentId: string) {
    if (!root) return;
    const child: EditNode = { id: newId(), name: "New topic", children: [] };
    apply(addChild(root, parentId, child));
    setCollapsed((prev) => {
      if (!prev.has(parentId)) return prev;
      const next = new Set(prev);
      next.delete(parentId);
      return next;
    });
    setSelectedId(child.id);
    setEditingId(child.id);
    setEditText(child.name);
  }

  function handleAddSibling(id: string) {
    if (!root) return;
    if (id === root.id) { handleAddChild(id); return; }
    const sibling: EditNode = { id: newId(), name: "New topic", children: [] };
    apply(addSiblingAfter(root, id, sibling));
    setSelectedId(sibling.id);
    setEditingId(sibling.id);
    setEditText(sibling.name);
  }

  function handleDelete(id: string) {
    if (!root || id === root.id) return;
    const node = findNode(root, id);
    if (!node) return;
    const n = countDescendants(node);
    if (n > 0 && !window.confirm(`Delete this topic and its ${n} subtopic${n !== 1 ? "s" : ""}?`)) return;
    const parent = findParent(root, id);
    apply(removeNode(root, id));
    setSelectedId(parent?.id ?? null);
    if (editingId === id) setEditingId(null);
  }

  function handleMove(id: string, dir: -1 | 1) {
    if (!root || id === root.id) return;
    apply(moveSibling(root, id, dir));
  }

  function toggleCollapse(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // ---- keyboard shortcuts (canvas-level; inputs handle their own keys) ----

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!root || saving) return;
      const target = e.target as HTMLElement | null;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }

      if (!selectedId) return;
      const node = findNode(root, selectedId);
      if (!node) return;
      const parent = findParent(root, selectedId);

      switch (e.key) {
        case "Tab":
          e.preventDefault();
          handleAddChild(selectedId);
          break;
        case "Enter":
          e.preventDefault();
          handleAddSibling(selectedId);
          break;
        case "F2":
          e.preventDefault();
          startRename(selectedId);
          break;
        case "Delete":
        case "Backspace":
          e.preventDefault();
          handleDelete(selectedId);
          break;
        case " ":
          e.preventDefault();
          if (node.children.length) toggleCollapse(selectedId);
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (parent) setSelectedId(parent.id);
          break;
        case "ArrowRight":
          e.preventDefault();
          if (node.children.length) {
            setCollapsed((prev) => {
              if (!prev.has(selectedId)) return prev;
              const next = new Set(prev);
              next.delete(selectedId);
              return next;
            });
            setSelectedId(node.children[0].id);
          }
          break;
        case "ArrowUp":
        case "ArrowDown": {
          e.preventDefault();
          const dir = e.key === "ArrowUp" ? -1 : 1;
          if (e.altKey) { handleMove(selectedId, dir as -1 | 1); break; }
          if (!parent) break;
          const idx = parent.children.findIndex((c) => c.id === selectedId);
          const next = parent.children[idx + dir];
          if (next) setSelectedId(next.id);
          break;
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  // ---- save (same endpoints as the note editor; JSON instead of Markdown) ----

  async function handleSave() {
    const t = title.trim();
    if (!t) { setError("Title is required"); return; }
    if (!root) return;
    if (editingId) commitRename();
    setSaving(true);
    setError(null);
    try {
      const json = serialize(root);
      let result: T;
      if (!file) {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const f = new File([json], `mindmap-${stamp}.json`, { type: "application/json" });
        result = (notebookId
          ? await uploadLibraryNotebookFile(notebookId, f, "mindmap", t)
          : await uploadFreeFormFile(f, "mindmap", t)) as unknown as T;
      } else {
        result = file;
        if (t !== file.title) {
          result = (notebookId
            ? await updateLibraryNotebookFile(notebookId, file.id, { title: t })
            : await updateFreeFormFile(file.id, { title: t })) as unknown as T;
        }
        if (json !== initialJson) {
          result = (notebookId
            ? await saveLibraryNoteContent(notebookId, file.id, json)
            : await saveFreeFormNoteContent(file.id, json)) as unknown as T;
        }
      }
      onSaved(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  const selected = root && selectedId ? findNode(root, selectedId) : null;
  const canEditSelection = !!selected && !saving;
  const selectionIsRoot = !!selected && !!root && selected.id === root.id;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) requestClose(); }}
    >
      <div className={`bg-vellum rounded-[2px] border border-ink shadow-[4px_4px_0_rgb(42_36_24_/_0.18)] w-full ${expanded ? EXPANDED_MODAL : "max-w-7xl max-h-[90vh]"} flex flex-col overflow-hidden`}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-rule shrink-0">
          <h2 className="font-serif-display text-[22px] leading-tight tracking-tight text-ink">
            {isEdit ? "Edit mind map" : "New mind map"}
          </h2>
          <div className="flex items-center gap-1 shrink-0">
            <ExpandButton expanded={expanded} onToggle={() => setExpanded(!expanded)} />
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-ink-fade hover:text-ink" onClick={requestClose} disabled={saving}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4 flex flex-col gap-3 flex-1 min-h-0">
          <Input
            placeholder="Mind map title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={saving || loading}
            autoFocus={!isEdit}
            className="h-11 shrink-0"
          />

          {/* Toolbar — acts on the selected node */}
          <div className="flex items-center gap-0.5 flex-wrap shrink-0 border border-rule rounded-[1px] bg-paper-light px-1.5 py-1">
            <ToolBtn label="Add child (Tab)" icon={Plus} onClick={() => selectedId && handleAddChild(selectedId)} disabled={!canEditSelection} />
            <ToolBtn label="Add sibling (Enter)" icon={ListPlus} onClick={() => selectedId && handleAddSibling(selectedId)} disabled={!canEditSelection || selectionIsRoot} />
            <ToolBtn label="Rename (F2 or double-click)" icon={Pencil} onClick={() => selectedId && startRename(selectedId)} disabled={!canEditSelection} />
            <ToolBtn label="Delete (Del)" icon={Trash2} onClick={() => selectedId && handleDelete(selectedId)} disabled={!canEditSelection || selectionIsRoot} />
            <span className="w-px h-4 bg-rule mx-1" />
            <ToolBtn label="Move up (Alt+↑)" icon={ArrowUp} onClick={() => selectedId && handleMove(selectedId, -1)} disabled={!canEditSelection || selectionIsRoot} />
            <ToolBtn label="Move down (Alt+↓)" icon={ArrowDown} onClick={() => selectedId && handleMove(selectedId, 1)} disabled={!canEditSelection || selectionIsRoot} />
            <span className="w-px h-4 bg-rule mx-1" />
            <ToolBtn label="Undo (Ctrl+Z)" icon={Undo2} onClick={undo} disabled={undoStack.length === 0 || saving} />
            <ToolBtn label="Redo (Ctrl+Shift+Z)" icon={Redo2} onClick={redo} disabled={redoStack.length === 0 || saving} />
            <span className="ml-auto font-mono text-[9px] tracking-[0.1em] uppercase text-ink-mute hidden md:block pr-1">
              Tab child · Enter sibling · Dbl-click rename · Del delete
            </span>
          </div>

          {/* Canvas */}
          <div
            className="flex-1 min-h-[360px] overflow-auto rounded-[1px] border border-rule bg-paper"
            onClick={() => { if (editingId) commitRename(); setSelectedId(null); }}
          >
            {error && !root ? (
              <div className="flex items-center gap-2 text-terracotta font-mono text-[11px] tracking-[0.1em] uppercase p-6">
                <AlertCircle className="h-4 w-4 shrink-0" />
                Failed to load: {error}
              </div>
            ) : loading || !layout || !root ? (
              <div className="flex items-center gap-2 text-ink-fade font-mono text-[11px] tracking-[0.1em] uppercase p-6">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : (
              <div style={{ width: layout.width, height: layout.height, position: "relative" }}>
                <svg
                  style={{
                    position: "absolute", top: 0, left: 0,
                    width: layout.width, height: layout.height,
                    pointerEvents: "none", overflow: "visible",
                  }}
                >
                  {layout.edges.map((e, i) => {
                    const mx = (e.x1 + e.x2) / 2;
                    return (
                      <path
                        key={i}
                        d={`M ${e.x1} ${e.y1} C ${mx} ${e.y1} ${mx} ${e.y2} ${e.x2} ${e.y2}`}
                        fill="none"
                        stroke="var(--color-rule)"
                        strokeWidth={1.5}
                      />
                    );
                  })}
                </svg>

                {layout.nodes.map((n) => {
                  const isSelected = n.id === selectedId;
                  const isEditing = n.id === editingId;
                  const isCollapsed = collapsed.has(n.id);
                  const color = MM_NODE_COLORS[Math.min(n.depth, 3)];
                  return (
                    <div
                      key={n.id}
                      className={`group absolute rounded-[2px] border px-3 flex items-center gap-1.5 shadow-[1px_1px_0_rgb(42_36_24_/_0.1)] leading-tight font-serif text-[13px] cursor-pointer ${color} ${
                        isSelected ? "ring-2 ring-terracotta ring-offset-1 ring-offset-paper" : "hover:brightness-95"
                      }`}
                      style={{ left: n.x, top: n.y, width: MM_NW, height: MM_NH }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (editingId && editingId !== n.id) commitRename();
                        setSelectedId(n.id);
                      }}
                      onDoubleClick={(e) => { e.stopPropagation(); startRename(n.id); }}
                    >
                      {isEditing ? (
                        <input
                          autoFocus
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          onFocus={(e) => e.target.select()}
                          onBlur={commitRename}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); commitRename(); }
                            else if (e.key === "Escape") { e.preventDefault(); setEditingId(null); }
                          }}
                          className="w-full min-w-0 bg-transparent outline-none font-serif text-[13px] placeholder:italic"
                          placeholder="Topic"
                        />
                      ) : (
                        <span className="flex-1 line-clamp-2 select-none">{n.label}</span>
                      )}
                      {n.hasChildren && !isEditing && (
                        <ChevronRight
                          className={`h-3 w-3 shrink-0 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
                          onClick={(e) => { e.stopPropagation(); toggleCollapse(n.id); }}
                        />
                      )}
                      {/* Quick add-child on hover, in the gap before the next column */}
                      {!isEditing && !saving && (
                        <button
                          type="button"
                          title="Add child topic"
                          aria-label="Add child topic"
                          onClick={(e) => { e.stopPropagation(); handleAddChild(n.id); }}
                          className="absolute top-1/2 -translate-y-1/2 -right-[26px] h-[22px] w-[22px] items-center justify-center rounded-full border border-ink bg-vellum text-ink shadow-[1px_1px_0_rgb(42_36_24_/_0.15)] hidden group-hover:flex hover:bg-paper-deep"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {error && root && (
            <div className="flex items-start gap-2 font-mono text-[11px] tracking-[0.08em] text-terracotta bg-vellum border border-terracotta/40 rounded-[1px] p-2.5 shrink-0">
              <AlertCircle className="h-4 w-4 shrink-0 mt-px" />
              <span className="break-words">{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-rule bg-paper-light shrink-0">
          <Button variant="ghost" size="sm" onClick={requestClose} disabled={saving}>Cancel</Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || loading || !root || !title.trim() || !dirty}
            className="gap-2 min-w-24 rounded-[1px]"
          >
            {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</> : <><Save className="h-3.5 w-3.5" /> Save</>}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ToolBtn({ label, icon: Icon, onClick, disabled }: {
  label: string; icon: React.ElementType; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="h-7 w-7 inline-flex items-center justify-center rounded-[1px] text-ink-fade hover:text-ink hover:bg-paper-deep transition-colors disabled:opacity-40"
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}
