"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useParams, useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowLeft, Music, Video, FileText, Brain, StickyNote,
  Image, Layers, BarChart2, Database, CheckCircle2,
  Loader2, AlertCircle, ExternalLink, RefreshCw, X, Plus, Sparkles, MessageSquare, ChevronLeft, ChevronRight, Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { getLiveArtifacts, getArtifactContent, saveArtifact, deleteArtifact, type LiveArtifact } from "@/lib/api";
import { GenerateActionSheet } from "@/components/generate/GenerateActionSheet";
import { GenerateModal } from "@/components/generate/GenerateModal";
import { SourcesPanel } from "@/components/notebook/SourcesPanel";
import { ChatPanel, type ChatPanelHandle } from "@/components/notebook/ChatPanel";
import { NotebookDescription } from "@/components/notebook/NotebookDescription";
import { CollapsedRail, CollapseButton } from "@/components/corpus/CollapsiblePanel";
import { useIsMobile } from "@/hooks/use-mobile";

// ---- Artifact type config ----

type ArtifactConfig = {
  icon: React.ElementType;
  bg: string;          // hex color for paper-tint background
  iconColor: string;   // CSS var for icon/label
  label: string;
};

const TYPE_CONFIG: Record<string, ArtifactConfig> = {
  audio:      { icon: Music,      bg: "#dcd5e8", iconColor: "var(--color-lavender)",   label: "Audio Overview" },
  video:      { icon: Video,      bg: "#cfd9e3", iconColor: "var(--color-sky)",        label: "Video Overview" },
  report:     { icon: FileText,   bg: "#ece0c2", iconColor: "var(--color-ochre)",      label: "Report"         },
  quiz:       { icon: Brain,      bg: "#dde2cf", iconColor: "var(--color-sage)",       label: "Quiz"           },
  flashcards: { icon: StickyNote, bg: "#dde2cf", iconColor: "var(--color-mint)",       label: "Flashcards"     },
  infographic:{ icon: Image,      bg: "#ecd5d6", iconColor: "var(--color-blush)",      label: "Infographic"    },
  slide_deck: { icon: Layers,     bg: "#dcd5e8", iconColor: "var(--color-lavender)",   label: "Slide Deck"     },
  data_table: { icon: BarChart2,  bg: "#f5e2d4", iconColor: "var(--color-terracotta)", label: "Data Table"     },
  mind_map:   { icon: Database,   bg: "#cfd9e3", iconColor: "var(--color-sky)",        label: "Mind Map"       },
};

const DEFAULT_CONFIG: ArtifactConfig = {
  icon: FileText, bg: "var(--color-paper-deep)", iconColor: "var(--color-ink-fade)", label: "Artifact",
};

// ---- Modal portal helper ----
//
// Modals are rendered as siblings of the ArtifactCard inside a CSS grid; if
// any ancestor on the way up creates a containing block (transform, filter,
// will-change, contain, backdrop-filter, etc.), `position: fixed` resolves
// to that block instead of the viewport — the modal ends up tiny and the
// card grid bleeds through. Portaling to document.body sidesteps it.
function useModalPortal() {
  const [mounted, setMounted] = useState(false);
  // Intentional mount-once trigger so we can safely call createPortal(document.body).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true); }, []);
  return mounted;
}

// ---- Markdown viewer modal ----

function MarkdownModal({ portalId, title, onClose }: {
  portalId: string;
  title: string;
  onClose: () => void;
}) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useModalPortal();

  useEffect(() => {
    getArtifactContent(portalId)
      .then(setContent)
      .catch((e) => setError(e.message));
  }, [portalId]);

  if (!mounted) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-vellum rounded-[2px] border border-ink shadow-[4px_4px_0_rgb(42_36_24_/_0.18)] w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule shrink-0">
          <h2 className="font-serif-display text-[22px] leading-tight tracking-tight text-ink line-clamp-1">{title}</h2>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-ink-fade hover:text-ink" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1 px-8 py-6">
          {error ? (
            <div className="flex items-center gap-2 text-terracotta font-mono text-[11px] tracking-[0.1em] uppercase">
              <AlertCircle className="h-4 w-4 shrink-0" />
              Failed to load: {error}
            </div>
          ) : content === null ? (
            <div className="flex items-center gap-2 text-ink-fade font-mono text-[11px] tracking-[0.1em] uppercase">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <div className="prose prose-sm max-w-none font-serif
              prose-headings:font-serif-display prose-headings:tracking-tight prose-headings:text-ink
              prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg
              prose-p:leading-relaxed prose-p:text-ink-soft
              prose-strong:text-ink prose-strong:font-semibold
              prose-code:bg-paper-deep prose-code:px-1 prose-code:py-0.5 prose-code:rounded-[1px] prose-code:text-[13px] prose-code:font-mono prose-code:text-ink
              prose-pre:bg-paper-deep prose-pre:rounded-[2px] prose-pre:p-4 prose-pre:border prose-pre:border-rule
              prose-blockquote:border-l-2 prose-blockquote:border-terracotta prose-blockquote:pl-4 prose-blockquote:text-ink-fade prose-blockquote:italic
              prose-ul:list-disc prose-ol:list-decimal
              prose-li:text-ink-soft
              prose-table:text-sm prose-th:text-left prose-th:font-mono prose-th:uppercase prose-th:tracking-[0.1em] prose-th:text-ink
              prose-a:text-terracotta prose-a:underline prose-a:underline-offset-2">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {content}
              </ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ---- CSV table viewer modal ----

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cell += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { row.push(cell); cell = ""; }
      else if (ch === '\n') { row.push(cell); cell = ""; if (row.some(Boolean)) rows.push(row); row = []; }
      else if (ch !== '\r') cell += ch;
    }
  }
  if (cell || row.length > 0) { row.push(cell); if (row.some(Boolean)) rows.push(row); }
  return rows;
}

function CsvTableModal({ portalId, title, onClose }: {
  portalId: string;
  title: string;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<string[][] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useModalPortal();

  useEffect(() => {
    getArtifactContent(portalId)
      .then((text) => setRows(parseCsv(text)))
      .catch((e) => setError(e.message));
  }, [portalId]);

  const headers = rows?.[0] ?? [];
  const dataRows = rows?.slice(1) ?? [];

  if (!mounted) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-vellum rounded-[2px] border border-ink shadow-[4px_4px_0_rgb(42_36_24_/_0.18)] w-full max-w-6xl max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule shrink-0">
          <h2 className="font-serif-display text-[22px] leading-tight tracking-tight text-ink line-clamp-1">{title}</h2>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-ink-fade hover:text-ink" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="overflow-auto flex-1">
          {error ? (
            <div className="flex items-center gap-2 text-terracotta font-mono text-[11px] tracking-[0.1em] uppercase p-6">
              <AlertCircle className="h-4 w-4 shrink-0" />
              Failed to load: {error}
            </div>
          ) : rows === null ? (
            <div className="flex items-center gap-2 text-ink-fade font-mono text-[11px] tracking-[0.1em] uppercase p-6">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 z-10">
                <tr>
                  {headers.map((h, i) => (
                    <th
                      key={i}
                      className="px-4 py-3 text-left font-mono text-[10px] tracking-[0.16em] uppercase bg-paper-deep text-ink border-b border-ink whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dataRows.map((row, ri) => (
                  <tr key={ri} className={ri % 2 === 0 ? "bg-vellum" : "bg-paper-light"}>
                    {headers.map((_, ci) => (
                      <td
                        key={ci}
                        className="px-4 py-3 align-top border-b border-rule-light font-serif text-[13.5px] text-ink-soft leading-relaxed max-w-xs"
                      >
                        {row[ci] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-6 py-3 border-t border-rule shrink-0 flex items-center justify-between font-mono text-[10px] tracking-[0.14em] uppercase text-ink-mute">
          <span>{dataRows.length} row{dataRows.length !== 1 ? "s" : ""} · {headers.length} column{headers.length !== 1 ? "s" : ""}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ---- Mind map viewer ----

const MM_NW = 180;
const MM_NH = 44;
const MM_HG = 40;
const MM_VG = 8;
const MM_PAD = 20;

type MindNode = { name?: string; title?: string; children?: MindNode[] };
type MmNode = { id: string; label: string; x: number; y: number; depth: number; hasChildren: boolean };
type MmEdge = { x1: number; y1: number; x2: number; y2: number };
type MmLayout = { nodes: MmNode[]; edges: MmEdge[]; width: number; height: number };

function buildMindLayout(root: MindNode, collapsed: Set<string>): MmLayout {
  const nodes: MmNode[] = [];
  const edges: MmEdge[] = [];

  function subtreeH(node: MindNode, id: string): number {
    if (!node.children?.length || collapsed.has(id)) return MM_NH;
    let h = (node.children.length - 1) * MM_VG;
    node.children.forEach((c, i) => { h += subtreeH(c, `${id}-${i}`); });
    return h;
  }

  function visit(node: MindNode, id: string, depth: number, yOff: number) {
    const h = subtreeH(node, id);
    const nx = MM_PAD + depth * (MM_NW + MM_HG);
    const ny = MM_PAD + yOff + (h - MM_NH) / 2;
    const hasChildren = !!node.children?.length;
    nodes.push({ id, label: node.name ?? node.title ?? "", x: nx, y: ny, depth, hasChildren });

    if (hasChildren && !collapsed.has(id)) {
      let cy = yOff;
      node.children!.forEach((child, i) => {
        const cid = `${id}-${i}`;
        const ch = subtreeH(child, cid);
        const cnx = MM_PAD + (depth + 1) * (MM_NW + MM_HG);
        const cny = MM_PAD + cy + (ch - MM_NH) / 2;
        edges.push({ x1: nx + MM_NW, y1: ny + MM_NH / 2, x2: cnx, y2: cny + MM_NH / 2 });
        visit(child, cid, depth + 1, cy);
        cy += ch + MM_VG;
      });
    }
  }

  visit(root, "root", 0, 0);
  const w = nodes.reduce((m, n) => Math.max(m, n.x + MM_NW), 0) + MM_PAD;
  const h = nodes.reduce((m, n) => Math.max(m, n.y + MM_NH), 0) + MM_PAD;
  return { nodes, edges, width: w, height: h };
}

const MM_NODE_COLORS = [
  "bg-ink text-paper border-ink",
  "bg-terracotta text-paper border-terracotta",
  "bg-vellum border-ink text-ink",
  "bg-paper-deep border-rule text-ink-soft",
];

function MindMapModal({ portalId, title, onClose }: {
  portalId: string;
  title: string;
  onClose: () => void;
}) {
  const [root, setRoot] = useState<MindNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const mounted = useModalPortal();

  useEffect(() => {
    getArtifactContent(portalId)
      .then((text) => {
        try { setRoot(JSON.parse(text) as MindNode); }
        catch { setError("Invalid JSON"); }
      })
      .catch((e) => setError(e.message));
  }, [portalId]);

  const layout = useMemo(() => root ? buildMindLayout(root, collapsed) : null, [root, collapsed]);

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  if (!mounted) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-vellum rounded-[2px] border border-ink shadow-[4px_4px_0_rgb(42_36_24_/_0.18)] w-full max-w-7xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule shrink-0">
          <h2 className="font-serif-display text-[22px] leading-tight tracking-tight text-ink line-clamp-1">{title}</h2>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-ink-fade hover:text-ink" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="overflow-auto flex-1 bg-paper">
          {error ? (
            <div className="flex items-center gap-2 text-terracotta font-mono text-[11px] tracking-[0.1em] uppercase p-6">
              <AlertCircle className="h-4 w-4 shrink-0" />
              Failed to load: {error}
            </div>
          ) : !layout ? (
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
                const isCollapsed = collapsed.has(n.id);
                const color = MM_NODE_COLORS[Math.min(n.depth, 3)];
                return (
                  <div
                    key={n.id}
                    className={`absolute rounded-[2px] border px-3 flex items-center gap-1.5 shadow-[1px_1px_0_rgb(42_36_24_/_0.1)] leading-tight font-serif text-[13px] ${color} ${n.hasChildren ? "cursor-pointer hover:brightness-95 active:brightness-90" : ""}`}
                    style={{ left: n.x, top: n.y, width: MM_NW, height: MM_NH }}
                    onClick={() => n.hasChildren && toggle(n.id)}
                  >
                    <span className="flex-1 line-clamp-2">{n.label}</span>
                    {n.hasChildren && (
                      <ChevronRight
                        className={`h-3 w-3 shrink-0 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ---- Flashcard viewer ----

type Flashcard = { f: string; b: string };

function FlashcardsModal({ portalId, title, onClose }: {
  portalId: string;
  title: string;
  onClose: () => void;
}) {
  const [cards, setCards] = useState<Flashcard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [correct, setCorrect] = useState(0);
  const [incorrect, setIncorrect] = useState(0);
  const mounted = useModalPortal();

  useEffect(() => {
    getArtifactContent(portalId)
      .then((text) => {
        try {
          const parsed = JSON.parse(text);
          // Backend stores `{title, cards: [{front, back}, ...]}`; tolerate
          // a few other shapes seen in older exports / raw NotebookLM data.
          const raw: unknown =
            Array.isArray(parsed) ? parsed
            : Array.isArray(parsed?.cards) ? parsed.cards
            : Array.isArray(parsed?.flashcards) ? parsed.flashcards
            : Array.isArray(parsed?.questions) ? parsed.questions
            : null;
          if (!Array.isArray(raw)) throw new Error("Could not find a card list in the JSON");
          const normalized: Flashcard[] = raw
            .map((c: Record<string, unknown>) => ({
              f: String(c.f ?? c.front ?? c.question ?? ""),
              b: String(c.b ?? c.back ?? c.answer ?? ""),
            }))
            .filter((c) => c.f || c.b);
          if (normalized.length === 0) throw new Error("No cards found");
          setCards(normalized);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Invalid flashcard JSON");
        }
      })
      .catch((e) => setError(e.message));
  }, [portalId]);

  function go(delta: number) {
    if (!cards) return;
    const next = (index + delta + cards.length) % cards.length;
    setIndex(next);
    setFlipped(false);
  }

  function score(kind: "correct" | "incorrect") {
    if (kind === "correct") setCorrect((n) => n + 1);
    else setIncorrect((n) => n + 1);
    if (cards && index < cards.length - 1) go(1);
  }

  // Keyboard nav
  useEffect(() => {
    if (!cards) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
      else if (e.key === " " || e.key === "Enter") { e.preventDefault(); setFlipped((f) => !f); }
      else if (e.key === "Escape") { e.preventDefault(); onClose(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, index]);

  if (!mounted) return null;
  const current = cards?.[index];

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-vellum rounded-[2px] border border-ink shadow-[4px_4px_0_rgb(42_36_24_/_0.18)] w-full max-w-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule shrink-0">
          <div className="min-w-0">
            <h2 className="font-serif-display text-[22px] leading-tight tracking-tight text-ink line-clamp-1">{title}</h2>
            {cards && (
              <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-ink-mute mt-1">
                Based on {cards.length} card{cards.length !== 1 ? "s" : ""}
              </p>
            )}
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-ink-fade hover:text-ink" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="p-6">
          {error ? (
            <div className="flex items-center gap-2 text-terracotta font-mono text-[11px] tracking-[0.1em] uppercase">
              <AlertCircle className="h-4 w-4 shrink-0" />
              Failed to load: {error}
            </div>
          ) : !cards || !current ? (
            <div className="flex items-center gap-2 text-ink-fade font-mono text-[11px] tracking-[0.1em] uppercase">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <>
              {/* Card */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => setFlipped((f) => !f)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setFlipped((f) => !f); } }}
                className="relative cursor-pointer bg-ink text-paper rounded-[3px] border border-ink shadow-[3px_3px_0_rgb(42_36_24_/_0.18)] min-h-[280px] flex flex-col p-6 hover:-translate-y-px transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terracotta"
              >
                <span className="absolute top-3 left-4 font-mono text-[10px] tracking-[0.18em] uppercase text-paper/60">
                  {index + 1} / {cards.length}
                </span>
                <span className="absolute top-3 right-4 font-mono text-[10px] tracking-[0.18em] uppercase text-paper/60">
                  {flipped ? "Answer" : "Question"}
                </span>
                <div className="flex-1 flex items-center justify-center mt-6">
                  <p className="font-serif text-[20px] leading-[1.4] text-paper text-center max-w-[90%] whitespace-pre-wrap">
                    {flipped ? current.b : current.f}
                  </p>
                </div>
                <div className="text-center font-mono text-[10px] tracking-[0.18em] uppercase text-paper/50 mt-2">
                  {flipped ? "Tap to flip back" : "Tap to see answer"}
                </div>
              </div>

              {/* Controls */}
              <div className="flex items-center justify-between gap-3 mt-5">
                <button
                  type="button"
                  aria-label="Previous card"
                  onClick={() => go(-1)}
                  className="h-10 w-10 rounded-full border border-ink bg-vellum hover:bg-paper-deep flex items-center justify-center text-ink-fade hover:text-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => score("incorrect")}
                    className="inline-flex items-center gap-2 h-10 px-4 rounded-full border border-terracotta bg-vellum hover:bg-terracotta/10 text-terracotta font-mono text-[11px] tracking-[0.12em] uppercase transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terracotta"
                  >
                    <X className="h-3.5 w-3.5" />
                    {incorrect}
                  </button>
                  <button
                    type="button"
                    onClick={() => score("correct")}
                    className="inline-flex items-center gap-2 h-10 px-4 rounded-full border border-mint bg-vellum hover:bg-mint/10 text-mint font-mono text-[11px] tracking-[0.12em] uppercase transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint"
                  >
                    {correct}
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                <button
                  type="button"
                  aria-label="Next card"
                  onClick={() => go(1)}
                  className="h-10 w-10 rounded-full border border-ink bg-vellum hover:bg-paper-deep flex items-center justify-center text-ink-fade hover:text-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              <p className="font-mono text-[9px] tracking-[0.14em] uppercase text-ink-mute text-center mt-4">
                Space / Enter to flip · ← → to navigate · Esc to close
              </p>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ---- Artifact card ----

function ArtifactCard({
  artifact,
  notebookId,
  notebookTitle,
  onSaved,
  onDeleted,
}: {
  artifact: LiveArtifact;
  notebookId: string;
  notebookTitle: string | null;
  onSaved: (updated: Partial<LiveArtifact>) => void;
  onDeleted: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showMarkdown, setShowMarkdown] = useState(false);
  const [showCsv, setShowCsv] = useState(false);
  const [showMindMap, setShowMindMap] = useState(false);
  const [showFlashcards, setShowFlashcards] = useState(false);
  const cfg = TYPE_CONFIG[artifact.artifact_type] ?? DEFAULT_CONFIG;
  const Icon = cfg.icon;

  const created = artifact.created_at
    ? new Date(artifact.created_at).toLocaleDateString("en-US", {
        month: "short", day: "numeric", year: "numeric",
      })
    : null;

  const isMarkdown = artifact.file_format === "md";
  const isCsv = artifact.file_format === "csv";
  const isMindMap = artifact.artifact_type === "mind_map";
  const isFlashcards = artifact.artifact_type === "flashcards";

  async function handleSave() {
    setSaving(true);
    try {
      await saveArtifact({
        nlm_artifact_id: artifact.nlm_id,
        notebook_id: notebookId,
        notebook_title: notebookTitle,
        artifact_type: artifact.artifact_type,
        file_format: artifact.file_format,
        title: artifact.title,
        nlm_created_at: artifact.created_at,
      });
      onSaved({ download_status: "pending" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!artifact.portal_id) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteArtifact(artifact.portal_id);
      setConfirmDelete(false);
      onDeleted();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }

  const isSaved      = artifact.download_status !== null;
  const isDone       = artifact.download_status === "done";
  const isFailed     = artifact.download_status === "failed";
  const isGenerating = artifact.download_status === "generating";
  const isInProgress = artifact.download_status === "pending" || artifact.download_status === "downloading";

  return (
    <>
      {showMarkdown && artifact.portal_id && (
        <MarkdownModal
          portalId={artifact.portal_id}
          title={artifact.title}
          onClose={() => setShowMarkdown(false)}
        />
      )}
      {showCsv && artifact.portal_id && (
        <CsvTableModal
          portalId={artifact.portal_id}
          title={artifact.title}
          onClose={() => setShowCsv(false)}
        />
      )}
      {showMindMap && artifact.portal_id && (
        <MindMapModal
          portalId={artifact.portal_id}
          title={artifact.title}
          onClose={() => setShowMindMap(false)}
        />
      )}
      {showFlashcards && artifact.portal_id && (
        <FlashcardsModal
          portalId={artifact.portal_id}
          title={artifact.title}
          onClose={() => setShowFlashcards(false)}
        />
      )}

      <AlertDialog
        open={confirmDelete}
        onOpenChange={(open) => { if (!open) { setConfirmDelete(false); setDeleteError(null); } }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete artifact?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes &ldquo;{artifact.title}&rdquo; from the portal (R2 + database). The original
              in NotebookLM is unaffected — refresh the list to pull it back if you change your mind.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && (
            <p className="font-mono text-[11px] tracking-[0.08em] text-terracotta">{deleteError}</p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDelete(); }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <><Loader2 className="h-4 w-4 animate-spin" /> Deleting…</> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="relative rounded-[2px] overflow-hidden border border-ink bg-vellum shadow-[2px_2px_0_rgb(42_36_24_/_0.08)] hover:shadow-[3px_3px_0_rgb(42_36_24_/_0.14)] hover:-translate-y-px transition-all">
        {/* Type header */}
        <div
          className="flex flex-col items-center justify-center gap-2 py-8 border-b border-ink"
          style={{ background: cfg.bg, color: cfg.iconColor }}
        >
          <Icon className="h-12 w-12" style={{ color: cfg.iconColor }} />
          <span className="font-mono text-[10px] tracking-[0.18em] uppercase text-ink-soft">
            {cfg.label}
          </span>
        </div>

        {/* Delete affordance (only for saved/portal-stored artifacts) */}
        {artifact.portal_id && (
          <button
            type="button"
            aria-label="Delete artifact"
            title="Delete from portal"
            onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
            className="absolute top-2 right-2 h-7 w-7 rounded-[1px] bg-paper/90 hover:bg-paper border border-ink/40 hover:border-terracotta flex items-center justify-center text-ink-fade hover:text-terracotta transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}

        {/* Content */}
        <div className="px-4 py-3.5 flex flex-col gap-3">
          <div>
            <p className="font-serif-display text-[18px] leading-[1.15] tracking-tight text-ink line-clamp-2">{artifact.title}</p>
            {created && <p className="font-mono text-[10px] tracking-[0.12em] uppercase text-ink-mute mt-1.5">{created}</p>}
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline" className="font-mono text-[9px] tracking-[0.14em] uppercase rounded-[1px] border-rule text-ink-fade">{artifact.file_format}</Badge>
            {!artifact.is_completed && !artifact.only_in_portal && (
              <Badge variant="outline" className="font-mono text-[9px] tracking-[0.14em] uppercase rounded-[1px] border-ochre/60 text-ochre bg-vellum">
                Generating…
              </Badge>
            )}
            {artifact.only_in_portal && (
              <Badge variant="outline" className="font-mono text-[9px] tracking-[0.14em] uppercase rounded-[1px] border-ink-mute/50 text-ink-mute bg-vellum" title="Deleted in NotebookLM — preserved here in your portal">
                Only in portal
              </Badge>
            )}
          </div>

          {/* Action area */}
          <div className="mt-1">
            {!isSaved && artifact.is_completed && (
              <Button onClick={handleSave} disabled={saving} size="sm" className="w-full gap-2">
                {saving
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>
                  : "Save to database"}
              </Button>
            )}

            {isGenerating && (
              <div className="flex items-center justify-center gap-2 py-1.5 font-mono text-[10px] tracking-[0.14em] uppercase text-ink-fade">
                <Sparkles className="h-4 w-4 animate-pulse text-terracotta" />
                <span>Generating in NotebookLM…</span>
              </div>
            )}

            {isInProgress && (
              <div className="flex items-center justify-center gap-2 py-1.5 font-mono text-[10px] tracking-[0.14em] uppercase text-ink-fade">
                <Loader2 className="h-4 w-4 animate-spin text-terracotta" />
                <span>{artifact.download_status === "downloading" ? "Downloading…" : "Queued…"}</span>
              </div>
            )}

            {isDone && (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 text-mint font-mono text-[10px] tracking-[0.14em] uppercase flex-1">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  Saved
                </div>
                {isMarkdown ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 h-8 text-xs shrink-0"
                    onClick={() => setShowMarkdown(true)}
                  >
                    <FileText className="h-3 w-3" />
                    Read
                  </Button>
                ) : isCsv ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 h-8 text-xs shrink-0"
                    onClick={() => setShowCsv(true)}
                  >
                    <BarChart2 className="h-3 w-3" />
                    View
                  </Button>
                ) : isMindMap ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 h-8 text-xs shrink-0"
                    onClick={() => setShowMindMap(true)}
                  >
                    <Brain className="h-3 w-3" />
                    View
                  </Button>
                ) : isFlashcards ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 h-8 text-xs shrink-0"
                    onClick={() => setShowFlashcards(true)}
                  >
                    <StickyNote className="h-3 w-3" />
                    Study
                  </Button>
                ) : artifact.r2_url ? (
                  <a href={artifact.r2_url} target="_blank" rel="noopener noreferrer" className="shrink-0">
                    <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs">
                      <ExternalLink className="h-3 w-3" />
                      View
                    </Button>
                  </a>
                ) : null}
              </div>
            )}

            {isFailed && (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 text-terracotta font-mono text-[10px] tracking-[0.14em] uppercase flex-1 min-w-0">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span className="truncate" title={artifact.download_error ?? undefined}>Failed</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 h-8 text-xs shrink-0"
                  onClick={handleSave}
                  disabled={saving}
                >
                  <RefreshCw className="h-3 w-3" /> Retry
                </Button>
              </div>
            )}

            {!artifact.is_completed && !isSaved && (
              <p className="font-mono text-[10px] tracking-[0.14em] uppercase text-ink-mute text-center py-1">
                Waiting for NotebookLM to finish generating
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ---- Page ----

export default function NotebookDetailPage() {
  const params = useParams();
  const router = useRouter();
  const notebookId = params.id as string;

  const [artifacts, setArtifacts] = useState<LiveArtifact[]>([]);
  const [notebookTitle, setNotebookTitle] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [generateType, setGenerateType] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatRef = useRef<ChatPanelHandle | null>(null);

  function handleAskTopic(prompt: string) {
    chatRef.current?.send(prompt);
  }

  useEffect(() => {
    loadArtifacts();
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, []);

  async function loadArtifacts(silent = false) {
    if (!silent) setRefreshing(true);
    try {
      const data = await getLiveArtifacts(notebookId);
      setArtifacts(data.artifacts);
      setNotebookTitle(data.notebook_title);

      const hasPending = data.artifacts.some(
        (a) => a.download_status === "generating"
            || a.download_status === "pending"
            || a.download_status === "downloading"
      );
      if (pollRef.current) clearTimeout(pollRef.current);
      if (hasPending) {
        pollRef.current = setTimeout(() => loadArtifacts(true), 5000);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  function handleSaved(nlmId: string, update: Partial<LiveArtifact>) {
    setArtifacts((prev) =>
      prev.map((a) => (a.nlm_id === nlmId ? { ...a, ...update } : a))
    );
    if (pollRef.current) clearTimeout(pollRef.current);
    pollRef.current = setTimeout(() => loadArtifacts(true), 5000);
  }

  function handleDeleted(nlmId: string) {
    // Drop the row if it was a portal-only artifact (NotebookLM no longer
    // lists it). For ones still in NotebookLM, clear the saved bits so the
    // user can re-save; the next refresh will reconcile.
    setArtifacts((prev) =>
      prev
        .map((a) =>
          a.nlm_id === nlmId
            ? { ...a, portal_id: null, download_status: null, r2_url: null, download_error: null }
            : a,
        )
        .filter((a) => !(a.nlm_id === nlmId && a.only_in_portal))
    );
    if (pollRef.current) clearTimeout(pollRef.current);
    pollRef.current = setTimeout(() => loadArtifacts(true), 1500);
  }

  const savedCount = artifacts.filter((a) => a.download_status === "done").length;
  const isMobile = useIsMobile();
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  return (
    <div className="flex h-full min-h-0">
      {/* Left rail (collapsed state) */}
      {leftCollapsed && (
        <CollapsedRail
          side="left"
          label="Notebook"
          onExpand={() => setLeftCollapsed(false)}
        />
      )}

      {/* Left column */}
      {!leftCollapsed && (
      <div className="flex-1 min-w-0 overflow-auto px-10 py-8 space-y-6 border-r border-rule relative">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 -ml-2 font-mono text-[10px] tracking-[0.18em] uppercase text-ink-fade hover:text-ink"
            onClick={() => router.push("/notebooklm")}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            My Corpus
          </Button>
        </div>

        <div className="pb-4 border-b border-rule">
          <h1 className="font-serif-display text-[32px] leading-[1.05] tracking-tight text-ink">
            {notebookTitle ?? (loading ? "Loading…" : notebookId)}
          </h1>
          {!loading && (
            <p className="font-mono text-[10px] tracking-[0.16em] uppercase text-ink-mute mt-2">
              {artifacts.length} artifact{artifacts.length !== 1 ? "s" : ""}
              {savedCount > 0 && ` · ${savedCount} saved`}
            </p>
          )}
        </div>

        {sheetOpen && (
          <GenerateActionSheet
            onPick={(t) => { setSheetOpen(false); setGenerateType(t); }}
            onClose={() => setSheetOpen(false)}
          />
        )}
        {generateType && (
          <GenerateModal
            artifactType={generateType}
            notebookId={notebookId}
            onClose={() => setGenerateType(null)}
            onGenerated={(artifact) => {
              setGenerateType(null);
              // Optimistic insert + immediate refresh; polling takes over.
              setArtifacts((prev) => [artifact, ...prev.filter((a) => a.nlm_id !== artifact.nlm_id)]);
              if (pollRef.current) clearTimeout(pollRef.current);
              pollRef.current = setTimeout(() => loadArtifacts(true), 3000);
            }}
          />
        )}

        <NotebookDescription notebookId={notebookId} onAskTopic={handleAskTopic} />

        <Tabs defaultValue="artifacts">
          <TabsList>
            <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
            <TabsTrigger value="sources">Sources</TabsTrigger>
            {isMobile && (
              <TabsTrigger value="chat">
                <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
                Chat
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="artifacts" className="mt-4 space-y-4">
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => loadArtifacts()}
                disabled={refreshing}
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                Refresh
              </Button>
              <Button size="sm" className="gap-2" onClick={() => setSheetOpen(true)}>
                <Plus className="h-4 w-4" />
                Generate
              </Button>
            </div>
            {loading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-64 rounded-[2px]" />
                ))}
              </div>
            ) : artifacts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-ink-mute gap-3">
                <FileText className="h-12 w-12 opacity-30" />
                <p className="font-serif-display text-[20px] tracking-tight text-ink">No artifacts yet</p>
                <p className="font-serif text-[14px] text-center max-w-xs text-ink-soft">
                  Click <span className="italic">+ Generate</span> to create one, or generate one in NotebookLM and refresh.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {artifacts.map((a) => (
                  <ArtifactCard
                    key={a.nlm_id}
                    artifact={a}
                    notebookId={notebookId}
                    notebookTitle={notebookTitle}
                    onSaved={(update) => handleSaved(a.nlm_id, update)}
                    onDeleted={() => handleDeleted(a.nlm_id)}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="sources" className="mt-4">
            <SourcesPanel notebookId={notebookId} />
          </TabsContent>

          {isMobile && (
            <TabsContent value="chat" className="mt-4">
              <div className="h-[calc(100vh-16rem)] rounded-[2px] overflow-hidden border border-rule bg-vellum">
                <ChatPanel ref={chatRef} notebookId={notebookId} />
              </div>
            </TabsContent>
          )}
        </Tabs>

        <CollapseButton
          side="left"
          onClick={() => setLeftCollapsed(true)}
        />
      </div>
      )}

      {/* Right column: chat panel (desktop only).
          When the left panel is collapsed, the chat grows to fill the freed
          space; otherwise it sits at a fixed 400px on the right. */}
      {!isMobile && !rightCollapsed && (
        <div
          className={`${leftCollapsed ? "flex-1 min-w-0" : "w-[400px] shrink-0"} h-full sticky top-0 bg-vellum relative`}
        >
          <ChatPanel ref={chatRef} notebookId={notebookId} />
          <CollapseButton
            side="right"
            onClick={() => setRightCollapsed(true)}
          />
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
    </div>
  );
}

