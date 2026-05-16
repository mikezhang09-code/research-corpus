"use client";

import { useEffect, useMemo, useState } from "react";
import { X, ChevronRight, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExpandButton, EXPANDED_MODAL } from "@/components/corpus/Expandable";

// ---- layout constants ----
const MM_NW = 180;
const MM_NH = 44;
const MM_HG = 40;
const MM_VG = 8;
const MM_PAD = 20;

type MindNode = { name?: string; title?: string; children?: MindNode[] };
type MmNode = { id: string; label: string; x: number; y: number; depth: number; hasChildren: boolean };
type MmEdge = { x1: number; y1: number; x2: number; y2: number };
type MmLayout = { nodes: MmNode[]; edges: MmEdge[]; width: number; height: number };

function subtreeH(node: MindNode, id: string, collapsed: Set<string>): number {
  if (!node.children?.length || collapsed.has(id)) return MM_NH;
  let h = (node.children.length - 1) * MM_VG;
  node.children.forEach((c, i) => { h += subtreeH(c, `${id}-${i}`, collapsed); });
  return h;
}

function buildMindLayout(root: MindNode, collapsed: Set<string>): MmLayout {
  const nodes: MmNode[] = [];
  const edges: MmEdge[] = [];

  function visit(node: MindNode, id: string, depth: number, yOff: number) {
    const h = subtreeH(node, id, collapsed);
    const nx = MM_PAD + depth * (MM_NW + MM_HG);
    const ny = MM_PAD + yOff + (h - MM_NH) / 2;
    const hasChildren = !!node.children?.length;
    nodes.push({ id, label: node.name ?? node.title ?? "", x: nx, y: ny, depth, hasChildren });

    if (hasChildren && !collapsed.has(id)) {
      let cy = yOff;
      node.children!.forEach((child, i) => {
        const cid = `${id}-${i}`;
        const ch = subtreeH(child, cid, collapsed);
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

export function MindMapModal({
  title,
  fetchContent,
  onClose,
}: {
  title: string;
  fetchContent: () => Promise<string>;
  onClose: () => void;
}) {
  const [root, setRoot] = useState<MindNode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetchContent()
      .then((text) => {
        try { setRoot(JSON.parse(text) as MindNode); }
        catch { setError("Invalid JSON"); }
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const layout = useMemo(() => root ? buildMindLayout(root, collapsed) : null, [root, collapsed]);

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={`bg-vellum rounded-[2px] border border-ink shadow-[4px_4px_0_rgb(42_36_24_/_0.18)] w-full ${expanded ? EXPANDED_MODAL : "max-w-7xl max-h-[90vh]"} flex flex-col overflow-hidden`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule shrink-0">
          <h2 className="font-serif-display text-[22px] leading-tight tracking-tight text-ink line-clamp-1">{title}</h2>
          <div className="flex items-center gap-1 shrink-0">
            <ExpandButton expanded={expanded} onToggle={() => setExpanded(!expanded)} />
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-ink-fade hover:text-ink" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
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
    </div>
  );
}
