/**
 * playGraphLayout.ts — where the Graph view draws each box (playGraph.ts):
 * layered columns left to right, each a stack of groups (a source, a rule, a
 * layer's controls…), each group a stack of rows. Pure and deterministic.
 *
 * Order: a few barycentre sweeps to cut crossings. Going right, each group
 * (and each row inside a control group) moves to the mean height of what
 * feeds it from columns to its left; going left, of what it feeds to its
 * right. Ties and groups with no neighbours that way keep their place, so
 * the same graph always lays out the same way. Columns are then centred on
 * the tallest.
 */
import type { PlayGraph } from './playGraph';

export const GRAPH_NODE_W = 188;
export const GRAPH_ROW_H = 28;
/** A rule's box: its name over its structure badge. */
export const GRAPH_RULE_H = 46;
/** A control group's heading. */
export const GRAPH_HEAD_H = 24;
const GROUP_PAD = 4;
const GROUP_GAP = 14;
const COL_GAP = 110;
const SWEEPS = 4;

export interface Box { x: number; y: number; w: number; h: number }
export interface GraphLayout {
  nodes: Map<string, Box>;
  groups: Map<string, Box>;
  width: number;
  height: number;
}

/** A group's height: a heading when it has a label, a row per node; a rule is taller. */
function groupHeight(g: { kind: string; label?: string; nodes: string[] }): number {
  if (g.label !== undefined) return GRAPH_HEAD_H + g.nodes.length * GRAPH_ROW_H + GROUP_PAD;
  return g.kind === 'rule' ? GRAPH_RULE_H : GRAPH_ROW_H;
}

export function layoutPlayGraph(graph: PlayGraph): GraphLayout {
  const columns: Array<Array<{ id: string; kind: string; label?: string; nodes: string[] }>> = Array.from({ length: Math.max(1, graph.columns) }, () => []);
  for (const g of graph.groups) columns[g.column]?.push({ id: g.id, kind: g.kind, label: g.label, nodes: [...g.nodes] });
  const colOf = new Map<string, number>();
  for (const g of graph.groups) for (const n of g.nodes) colOf.set(n, g.column);

  // Each node's neighbours, by side.
  const left = new Map<string, string[]>(), right = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, k: string, v: string) => { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); };
  for (const e of graph.edges) {
    const a = colOf.get(e.from), b = colOf.get(e.to);
    if (a === undefined || b === undefined || a === b) continue;
    if (a < b) { push(left, e.to, e.from); push(right, e.from, e.to); } else { push(left, e.from, e.to); push(right, e.to, e.from); }
  }

  // Each node's height in its column as rows (heights in rows are enough to order by).
  const pos = new Map<string, number>();
  const place = (col: typeof columns[number]) => {
    let y = 0;
    for (const g of col) {
      if (g.label !== undefined) y += 1;
      for (const n of g.nodes) pos.set(n, y++);
      y += 0.5;
    }
  };
  columns.forEach(place);
  const mean = (ids: string[] | undefined): number | null => {
    const ys = (ids ?? []).map(i => pos.get(i)).filter((v): v is number => v !== undefined);
    return ys.length ? ys.reduce((s, v) => s + v, 0) / ys.length : null;
  };
  /** Stable sort by a key, falling back to the current place. */
  const sortBy = <T,>(xs: T[], key: (x: T, i: number) => number) => {
    const keyed = xs.map((x, i) => ({ x, i, k: key(x, i) }));
    keyed.sort((a, b) => a.k - b.k || a.i - b.i);
    return keyed.map(o => o.x);
  };
  for (let s = 0; s < SWEEPS; s++) {
    const toRight = s % 2 === 0;
    const side = toRight ? left : right;
    const order = columns.map((_, i) => i);
    if (!toRight) order.reverse();
    for (const c of order) {
      const col = columns[c];
      for (const g of col) if (g.nodes.length > 1) g.nodes = sortBy(g.nodes, n => mean(side.get(n)) ?? pos.get(n)!);
      place(col);
      columns[c] = sortBy(col, g => mean(g.nodes.flatMap(n => side.get(n) ?? [])) ?? mean(g.nodes)!);
      place(columns[c]);
    }
  }

  // Pixels: columns side by side, each centred on the tallest.
  const heights = columns.map(col => col.reduce((h, g, i) => h + groupHeight(g) + (i ? GROUP_GAP : 0), 0));
  const height = Math.max(GRAPH_ROW_H, ...heights);
  const nodes = new Map<string, Box>(), groups = new Map<string, Box>();
  columns.forEach((col, c) => {
    const x = c * (GRAPH_NODE_W + COL_GAP);
    let y = Math.round((height - heights[c]) / 2);
    for (const g of col) {
      const h = groupHeight(g);
      groups.set(g.id, { x, y, w: GRAPH_NODE_W, h });
      const top = y + (g.label !== undefined ? GRAPH_HEAD_H : 0);
      const rowH = g.label !== undefined ? GRAPH_ROW_H : h;
      g.nodes.forEach((n, i) => nodes.set(n, { x, y: top + i * rowH, w: GRAPH_NODE_W, h: rowH }));
      y += h + GROUP_GAP;
    }
  });
  return { nodes, groups, width: columns.length * GRAPH_NODE_W + (columns.length - 1) * COL_GAP, height };
}

/**
 * A wire from box `a` to box `b`, as an SVG path and the point halfway along
 * it (for its label). Forward: right side to left side, an S curve. Same
 * column (a control driving another): right side to right side, bowing out.
 * Backward (a control a rule reads, a source hearing a rule): right side to
 * left side, swinging wide round. Into itself: a small loop beside the box.
 */
export function wirePathOf(a: Box, b: Box): { d: string; mid: { x: number; y: number } } {
  const y1 = a.y + a.h / 2, y2 = b.y + b.h / 2;
  const cubic = (x1: number, c1x: number, c2x: number, x2: number) => ({
    d: `M ${x1} ${y1} C ${c1x} ${y1} ${c2x} ${y2} ${x2} ${y2}`,
    // A cubic at t = ½: (P0 + 3·P1 + 3·P2 + P3) / 8.
    mid: { x: (x1 + 3 * c1x + 3 * c2x + x2) / 8, y: (y1 + y2) / 2 },
  });
  const x1 = a.x + a.w;
  if (a.x === b.x && a.y === b.y) return { d: `M ${x1} ${y1 - 6} C ${x1 + 44} ${y1 - 40} ${x1 + 44} ${y1 + 40} ${x1} ${y1 + 6}`, mid: { x: x1 + 33, y: y1 } };
  if (b.x === a.x) {
    const bow = 36 + Math.min(60, Math.abs(y2 - y1) / 4);
    return cubic(x1, x1 + bow, x1 + bow, b.x + b.w);
  }
  if (b.x > a.x) {
    const dx = Math.max(30, (b.x - x1) / 2);
    return cubic(x1, x1 + dx, b.x - dx, b.x);
  }
  const swing = 80 + Math.min(120, (x1 - b.x) / 6);
  return cubic(x1, x1 + swing, b.x - swing, b.x);
}

/** The view that shows `w`×`h` of content whole in a `vw`×`vh` viewport, centred, never above 1:1. */
export function fitView(w: number, h: number, vw: number, vh: number, margin = 32): { x: number; y: number; k: number } {
  const k = Math.max(GRAPH_ZOOM_MIN, Math.min(1, (vw - 2 * margin) / Math.max(1, w), (vh - 2 * margin) / Math.max(1, h)));
  return { x: Math.round((vw - w * k) / 2), y: Math.round((vh - h * k) / 2), k };
}

export const GRAPH_ZOOM_MIN = 0.15;
export const GRAPH_ZOOM_MAX = 2.5;

/** Zoom by `factor` about the viewport point (px, py), keeping it still. */
export function zoomAt(v: { x: number; y: number; k: number }, factor: number, px: number, py: number): { x: number; y: number; k: number } {
  const k = Math.max(GRAPH_ZOOM_MIN, Math.min(GRAPH_ZOOM_MAX, v.k * factor));
  const f = k / v.k;
  return { x: px - (px - v.x) * f, y: py - (py - v.y) * f, k };
}
