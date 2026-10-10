/**
 * Compact layouts (store/graphLayout.ts layoutByRank; docs/structure-hints.md "Auto layout"). Convert and
 * Auto layout used to leave a source read only at the end of a long chain alone in the first column
 * (a lone column far left, the rest far right), and stacked unrelated pieces of the graph into the
 * same columns. Ranks are now pulled toward what a node feeds, and the connected pieces are packed
 * side by side or in rows with the usual gaps.
 */
import { describe, expect, it, vi } from 'vitest';
import type { GraphNode } from '../../types/nodeGraph';

vi.hoisted(() => {
  const ls = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => ls.get(k) ?? null, setItem: (k: string, v: string) => { ls.set(k, v); },
    removeItem: (k: string) => { ls.delete(k); }, key: () => null, length: 0, clear: () => ls.clear(),
  });
});

import { compactRanks, computeNodeRanks, connectedPieces, layoutByRank } from '../graphLayout';
import { glslToGraph } from '../../glslToGraph';
import { useNodeGraphStore } from '../useNodeGraphStore';

const COL = 440, CARD = 360, GAP_X = COL - CARD;
const node = (id: string, type: string, inputs: GraphNode['inputs']): GraphNode =>
  ({ id, type, position: { x: 0, y: 0 }, inputs, outputs: {}, params: {} });
const wire = (from: string, out = 'result') => ({ type: 'float' as const, label: 'A', connection: { nodeId: from, outputKey: out } });

it('a source read only at the end of a long chain sits one column before what reads it', () => {
  const chain = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'];
  const nodes = [
    node('c0', 'uv', {}),
    ...chain.slice(1).map((id, i) => node(id, 'add', { a: wire(chain[i]) })),
    node('time', 'time', {}),
    node('mix', 'multiply', { a: wire('c5'), b: wire('time', 'time') }),
    node('out', 'output', { color: wire('mix') }),
  ];
  expect(computeNodeRanks(nodes).get('time')).toBe(0);
  expect(compactRanks(nodes).get('time')).toBe(compactRanks(nodes).get('mix')! - 1);
  const pos = layoutByRank(nodes, { heightOf: () => 100 });
  expect(pos.get('mix')!.x - pos.get('time')!.x).toBe(COL);
  // The chain itself keeps its columns.
  expect(pos.get('c5')!.x - pos.get('c0')!.x).toBe(5 * COL);
});

it('Convert: a helper chain read at the end of the shader sits right before its reader, not in the first column', () => {
  const src = `void main() {
    float t = sin(u_time * 0.5) * 0.5 + 0.5;
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / u_resolution.y;
    float d = length(uv); d = abs(d - 0.3); d = smoothstep(0.02, 0.0, d); d = d * d; d = sqrt(d); d = d + 0.1;
    vec3 col = vec3(d) * t;
    gl_FragColor = vec4(col, 1.0);
  }`;
  const { nodes } = glslToGraph(src);
  expect(nodes.length).toBeGreaterThan(8);
  const byId = new Map(nodes.map(n => [n.id, n]));
  const readers = new Map<string, GraphNode[]>();
  for (const n of nodes) for (const i of Object.values(n.inputs)) if (i.connection && byId.has(i.connection.nodeId)) readers.set(i.connection.nodeId, [...(readers.get(i.connection.nodeId) ?? []), n]);
  expect(readers.size).toBeGreaterThan(5);
  // Every node is exactly one column before the first node it feeds.
  for (const [id, rs] of readers) expect(Math.min(...rs.map(r => r.position.x)) - byId.get(id)!.position.x, byId.get(id)!.type).toBe(COL);
  // The Time node (the helper chain's start) is not in the first column any more.
  const time = nodes.find(n => n.type === 'time');
  expect(time).toBeDefined();
  expect(time!.position.x).toBeGreaterThan(Math.min(...nodes.map(n => n.position.x)));
});

/** A graph in four pieces: the Output's chain, a deep chain of its own, a pair, a lone node. */
const pieces = () => {
  const main = [node('uv', 'uv', {}), node('len', 'length', { a: wire('uv', 'uv') }), node('out', 'output', { color: wire('len') })];
  const deep = Array.from({ length: 7 }, (_, i) => node(`d${i}`, 'add', i ? { a: wire(`d${i - 1}`) } : {}));
  const pair = [node('t', 'time', {}), node('s', 'sin', { a: wire('t', 'time') })];
  const lone = [node('k', 'add', {})];
  return { all: [...lone, ...pair, ...deep, ...main], groups: [main, deep, pair, lone] };
};
const boxOf = (pos: Map<string, { x: number; y: number }>, list: GraphNode[], h = 100) => {
  const ps = list.map(n => pos.get(n.id)!);
  const x = Math.min(...ps.map(p => p.x)), y = Math.min(...ps.map(p => p.y));
  return { x, y, r: Math.max(...ps.map(p => p.x)) + CARD, b: Math.max(...ps.map(p => p.y)) + h };
};
type B = ReturnType<typeof boxOf>;
/** The widest horizontal gap between two pieces side by side (sharing rows) with nothing between them. */
const maxRowGap = (boxes: B[]) => {
  let worst = 0;
  for (let i = 0; i < boxes.length; i++) for (let j = 0; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (i === j || b.x < a.r || !(a.y < b.b && b.y < a.b)) continue;
    const between = boxes.some((c, k) => k !== i && k !== j && c.x >= a.r && c.r <= b.x && c.y < Math.max(a.b, b.b) && Math.min(a.y, b.y) < c.b);
    if (!between) worst = Math.max(worst, b.x - a.r);
  }
  return worst;
};
const noOverlap = (boxes: B[]) => {
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    expect(a.r <= b.x || b.r <= a.x || a.b <= b.y || b.b <= a.y, `pieces ${i} and ${j} overlap`).toBe(true);
  }
};

describe('connected pieces', () => {
  it('splits the graph into its connected pieces, the Output\'s first', () => {
    const got = connectedPieces(pieces().all).map(g => g.map(n => n.id).sort());
    expect(got[0]).toEqual(['len', 'out', 'uv']);
    expect(got.length).toBe(4);
  });

  it('packs them: no overlap, the column gap between neighbours, nothing stranded', () => {
    const { all, groups } = pieces();
    const pos = layoutByRank(all, { heightOf: () => 100 });
    const boxes = groups.map(g => boxOf(pos, g));
    expect([boxes[0].x, boxes[0].y]).toEqual([40, 60]);
    noOverlap(boxes);
    expect(maxRowGap(boxes)).toBeLessThanOrEqual(GAP_X);
    // No wider than its widest piece (at least three columns): nothing far off to one side.
    const widest = Math.max(3 * COL - GAP_X, ...boxes.map(b => b.r - b.x));
    expect(Math.max(...boxes.map(b => b.r)) - 40).toBeLessThanOrEqual(widest);
  });

  it('Auto layout in the Studio packs a graph of scattered pieces the same way', () => {
    const { all, groups } = pieces();
    useNodeGraphStore.setState({ activeGroupId: null, activeGroupPath: [] });
    useNodeGraphStore.getState().replaceGraph(all.map((n, i) => ({ ...n, position: { x: i * 3000, y: (i % 3) * 2000 } })));
    useNodeGraphStore.getState().autoLayout();
    const pos = new Map(useNodeGraphStore.getState().nodes.map(n => [n.id, n.position]));
    const boxes = groups.map(g => boxOf(pos, g, 1));
    noOverlap(boxes);
    expect(maxRowGap(boxes)).toBeLessThanOrEqual(GAP_X);
    const right = Math.max(...boxes.map(b => b.r)), left = Math.min(...boxes.map(b => b.x));
    expect(right - left).toBeLessThanOrEqual(Math.max(3 * COL - GAP_X, ...boxes.map(b => b.r - b.x)));
  });
});
