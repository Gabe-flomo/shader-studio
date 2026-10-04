/**
 * Where things are on an effect graph's canvas (the Look effect editor and
 * the stack card's tiny diagram share it): nodes are fixed-width cards whose
 * socket rows come first, so a socket's position follows from its index
 * without measuring the page.
 */
import { effectNodeSockets, FX_IN_ID, FX_IN_TYPE, type EffectGraph, type EffectGraphNode } from '../../../play/lookGraph';

export const NODE_W = 196;
export const HEAD_H = 26;
export const ROW_H = 20;
/** The inputs node isn't stored: it always sits here. */
export const IN_POS = { x: 0, y: 40 };

/** Every node on the canvas, the inputs node first. */
export function layoutNodes(graph: EffectGraph): EffectGraphNode[] {
  return [{ id: FX_IN_ID, type: FX_IN_TYPE, x: IN_POS.x, y: IN_POS.y }, ...graph.nodes];
}

export interface NodeBox {
  node: EffectGraphNode;
  label: string;
  inputs: Array<{ key: string; type: string; label: string }>;
  outputs: Array<{ key: string; type: string; label: string }>;
  /** The socket rows' height (the card grows below them with its settings). */
  rowsH: number;
}

export function nodeBox(node: EffectGraphNode): NodeBox {
  const s = effectNodeSockets(node);
  const inputs = Object.entries(s?.inputs ?? {}).map(([key, v]) => ({ key, type: v.type, label: v.label }));
  const outputs = Object.entries(s?.outputs ?? {}).map(([key, v]) => ({ key, type: v.type, label: v.label }));
  return { node, label: s?.label ?? node.type, inputs, outputs, rowsH: Math.max(inputs.length, outputs.length, 1) * ROW_H };
}

/** A socket's centre: inputs on the left edge, outputs on the right, one row each. */
export function socketAt(box: NodeBox, side: 'in' | 'out', key: string): { x: number; y: number } | null {
  const list = side === 'in' ? box.inputs : box.outputs;
  const i = list.findIndex(s => s.key === key);
  if (i < 0) return null;
  return { x: box.node.x + (side === 'in' ? 0 : NODE_W), y: box.node.y + HEAD_H + i * ROW_H + ROW_H / 2 };
}

/** A wire's path: a horizontal S from an output to an input. */
export function wirePath(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

/** Every wire, as the two ends' positions and the type it carries. */
export function graphWires(graph: EffectGraph): Array<{ to: string; key: string; from: string; out: string; a: { x: number; y: number }; b: { x: number; y: number }; type: string }> {
  const boxes = new Map(layoutNodes(graph).map(n => [n.id, nodeBox(n)]));
  const out: ReturnType<typeof graphWires> = [];
  for (const n of graph.nodes) {
    for (const [key, [from, outKey]] of Object.entries(n.wires ?? {})) {
      const src = boxes.get(from), dst = boxes.get(n.id);
      if (!src || !dst) continue;
      const a = socketAt(src, 'out', outKey), b = socketAt(dst, 'in', key);
      if (!a || !b) continue;
      out.push({ to: n.id, key, from, out: outKey, a, b, type: src.outputs.find(o => o.key === outKey)?.type ?? 'vec3' });
    }
  }
  return out;
}
