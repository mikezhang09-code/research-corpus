// Shared tidy-tree layout for mindmap JSON ({ name | title, children[] }).
// Used by the read-only MindMapModal and the MindMapEditorModal. Nodes may
// carry a runtime `id` (the editor assigns stable ones); without it the
// positional path ("root-0-1") is used, matching the viewer's old behaviour.

export type MindNode = { id?: string; name?: string; title?: string; children?: MindNode[] };
export type MmNode = { id: string; label: string; x: number; y: number; depth: number; hasChildren: boolean };
export type MmEdge = { x1: number; y1: number; x2: number; y2: number };
export type MmLayout = { nodes: MmNode[]; edges: MmEdge[]; width: number; height: number };

export const MM_NW = 180;
export const MM_NH = 44;
export const MM_HG = 40;
export const MM_VG = 8;
export const MM_PAD = 20;

export const MM_NODE_COLORS = [
  "bg-ink text-paper border-ink",
  "bg-terracotta text-paper border-terracotta",
  "bg-vellum border-ink text-ink",
  "bg-paper-deep border-rule text-ink-soft",
];

function subtreeH(node: MindNode, id: string, collapsed: Set<string>): number {
  if (!node.children?.length || collapsed.has(id)) return MM_NH;
  let h = (node.children.length - 1) * MM_VG;
  node.children.forEach((c, i) => { h += subtreeH(c, c.id ?? `${id}-${i}`, collapsed); });
  return h;
}

export function buildMindLayout(root: MindNode, collapsed: Set<string>): MmLayout {
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
        const cid = child.id ?? `${id}-${i}`;
        const ch = subtreeH(child, cid, collapsed);
        const cnx = MM_PAD + (depth + 1) * (MM_NW + MM_HG);
        const cny = MM_PAD + cy + (ch - MM_NH) / 2;
        edges.push({ x1: nx + MM_NW, y1: ny + MM_NH / 2, x2: cnx, y2: cny + MM_NH / 2 });
        visit(child, cid, depth + 1, cy);
        cy += ch + MM_VG;
      });
    }
  }

  visit(root, root.id ?? "root", 0, 0);
  const w = nodes.reduce((m, n) => Math.max(m, n.x + MM_NW), 0) + MM_PAD;
  const h = nodes.reduce((m, n) => Math.max(m, n.y + MM_NH), 0) + MM_PAD;
  return { nodes, edges, width: w, height: h };
}
