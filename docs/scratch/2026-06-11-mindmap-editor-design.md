# Mindmap viewer review + visual editor design

Date: 2026-06-11
Status: **awaiting go** — no code written yet.

Goal: let Mike create and edit mindmaps **visually** (click/keyboard on the
canvas), never by typing JSON.

---

## Part 1 — Review of the existing mindmap viewer

### Where it lives (three copies)

| Copy | File | Used for |
|------|------|----------|
| Library viewer (main portal) | `portal/frontend/src/components/library/MindMapModal.tsx` | Folio files (`FileCard.tsx`) + Free Forms (`FreeFormsPanel.tsx`) |
| Library viewer (public Worker) | `portal/public/src/components/library/MindMapModal.tsx` | Same surfaces in the public viewer — **byte-identical** to the frontend copy today |
| NotebookLM artifact viewer | inline in `portal/frontend/src/app/(corpus)/notebooklm/[id]/page.tsx` (~line 507) | `mind_map` artifacts fetched via `getArtifactContent` |

All three share the same ~60-line layout engine (`subtreeH` + `buildMindLayout`)
copy-pasted.

### How it works

- **Data format**: plain JSON tree `{ name?: string, title?: string, children?: [...] }`.
  Accepts `name` or `title` per node (NotebookLM export compatibility).
  `.json` upload auto-categorises as `mindmap` (`file-categories.ts:28`).
- **Layout**: classic left-to-right tidy tree. Fixed node boxes (180×44 px),
  40 px horizontal / 8 px vertical gaps. Subtree height computed recursively;
  parent centred against its children. Output: absolute-positioned node divs +
  one SVG layer of cubic-bezier edges.
- **Interaction**: click a parent node toggles collapse (state keyed by
  positional path id `root-0-1`). Expand-to-fullscreen button. Overflow
  scrolling, no pan/zoom.
- **Styling**: depth-indexed palette (`ink` → `terracotta` → `vellum` →
  `paper-deep`), labels `line-clamp-2`.

### Assessment

Strengths worth keeping:

- Zero dependencies — no d3/reactflow; the whole thing is ~170 lines.
- Deterministic, readable layout that matches the portal aesthetic.
- Collapse + fullscreen are the right viewer affordances.

Limitations (relevant ones for the editor):

1. **Read-only** — no way to create or change a mindmap except uploading JSON.
2. **Positional node ids** (`root-0-1`) shift when siblings are inserted or
   deleted. Harmless in a viewer; in an editor it would corrupt
   selection/collapse state. The editor must assign **stable runtime ids**
   (serialisation stays pure `{name, children}`).
3. **Three duplicated copies** of the layout engine. The editor needs the same
   engine, which would make four — extract it once instead.
4. Fixed 180 px node width truncates long labels at 2 lines (acceptable; keep
   for editor v1 — predictable layout beats auto-sizing complexity).
5. Error reporting is just "Invalid JSON" (fine for now).

No bugs found; the viewer is sound for its job.

---

## Part 2 — Visual editor design (minimal scope)

### What gets built

One new component plus one small extraction, **main portal only**, **no backend
changes, no schema changes**.

```
portal/frontend/src/components/library/
├── mindmap-layout.ts        ← extracted: MindNode type, subtreeH, buildMindLayout,
│                               node-size constants, colour palette
├── MindMapModal.tsx         ← unchanged behaviour, now imports from mindmap-layout.ts
└── MindMapEditorModal.tsx   ← NEW: the visual editor
```

### Editing model — all visual, no JSON anywhere

Same canvas rendering as the viewer (reused layout engine), plus:

| Action | Mouse | Keyboard (node selected) |
|--------|-------|--------------------------|
| Select node | click | arrow keys navigate parent/child/siblings |
| Rename | double-click → inline `<input>` overlay on the node | `Enter` confirms, `Esc` cancels; `F2` starts rename |
| Add child | hover "+" button at node's right edge | `Tab` |
| Add sibling | — | `Enter` (matches XMind/MindNode muscle memory) |
| Delete node + subtree | hover trash button | `Delete` / `Backspace` (confirm dialog only if the node has children) |
| Reorder among siblings | ▲/▼ buttons in a small toolbar when selected | `Alt+↑` / `Alt+↓` |
| Collapse/expand | chevron, as in the viewer | `Space` |
| Undo / redo | toolbar buttons | `Ctrl+Z` / `Ctrl+Shift+Z` |

New nodes start in rename mode with placeholder text, so "Tab, type, Tab,
type…" builds a branch without touching the mouse.

State is a `MindNode` tree in React state with runtime-assigned stable ids and
a simple undo history stack (array of snapshots — trees are tiny, snapshotting
is fine). Dirty tracking + "Discard unsaved changes?" on close, same as
`NoteEditorModal`.

### Persistence — existing endpoints only

Mirrors the note editor exactly (`NoteEditorModal.tsx` pattern):

- **Create**: serialise tree → `new File([json], "mindmap-<stamp>.json")` →
  `uploadFreeFormFile(f, "mindmap", title)` (or
  `uploadLibraryNotebookFile(notebookId, …)` inside a folio).
- **Edit**: `saveFreeFormNoteContent` / `saveLibraryNoteContent` — the backend
  `PUT …/content` endpoint is a generic "overwrite text bytes in R2" call
  (`free_forms.py:136`), works for JSON as-is; mime type is preserved.
- **Format**: unchanged `{name, children}` JSON → stays readable by the public
  Worker viewer and compatible with NotebookLM exports.

### Entry points (3 small wiring diffs)

1. **Free Forms panel**: "New mindmap" button beside "New note"
   (`FreeFormsPanel.tsx`).
2. **Folio files panel**: same button in `FilesPanel.tsx`.
3. **Opening an existing mindmap file** in the main portal opens the
   **editor** directly (single-user portal — viewing and editing are the same
   surface, like notes). The NotebookLM artifact viewer and the public Worker
   keep the read-only `MindMapModal` untouched.

### Explicitly out of scope (v1)

- Drag-and-drop re-parenting (▲/▼ + delete/re-add covers reordering; DnD is a
  later nice-to-have)
- Pan/zoom canvas, node colours/icons/notes-on-nodes, image export
- Editor in the public Cloudflare Worker (My Research could get it later)
- Markdown-outline import
- Any backend or DB change

### Estimated size

- `mindmap-layout.ts` extraction: ~70 lines moved, viewer shrinks accordingly
- `MindMapEditorModal.tsx`: ~350–450 lines (canvas reuse + toolbar + keyboard
  handler + inline rename + undo stack + save flow)
- Wiring: ~10 lines each in `FreeFormsPanel.tsx` / `FilesPanel.tsx` /
  `FileCard.tsx`

One PR-sized change, main portal only.
