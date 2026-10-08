import { describe, expect, it } from 'vitest';
import type { GraphNode } from '../../types/nodeGraph';
import { GROUP_PORT_SENTINEL } from '../../types/nodeGraph';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { toDataflow, viewOf } from '../dataflow';
import { TECHNIQUE_BY_ID, TECHNIQUES, techniqueHits } from '../catalogue';
import { analyseGraph, buildPatternIndex, findTechniques, graphsUsing, techniquesAtNode, type GraphInput } from '../patternIndex';
import { canonical, minePatterns } from '../mine';
import { rankCandidates } from '../candidates';

// ── Tiny graph builder ────────────────────────────────────────────────────────
type Wire = [string, string];
function nd(id: string, type: string, opts: { params?: Record<string, unknown>; in?: Record<string, Wire | string>; out?: Record<string, string> } = {}): GraphNode {
  const inputs: GraphNode['inputs'] = {};
  for (const [k, w] of Object.entries(opts.in ?? {})) {
    inputs[k] = typeof w === 'string' ? { type: 'vec2', label: k, connection: { nodeId: GROUP_PORT_SENTINEL, outputKey: w } } : { type: 'float', label: k, connection: { nodeId: w[0], outputKey: w[1] } };
  }
  const outputs: GraphNode['outputs'] = {};
  for (const [k, t] of Object.entries(opts.out ?? { result: 'float' })) outputs[k] = { type: t as 'float', label: k };
  return { id, type, position: { x: 0, y: 0 }, inputs, outputs, params: opts.params ?? {} } as GraphNode;
}
const expr = (id: string, lines: Array<[string, string]>, result: string, ins: Record<string, Wire> = {}) =>
  nd(id, 'exprNode', { params: { lines: lines.map(([lhs, rhs]) => ({ lhs, op: '=', rhs })), result }, in: ins });

const hits = (techId: string, nodes: GraphNode[]) => techniqueHits(TECHNIQUE_BY_ID.get(techId)!, viewOf(toDataflow(nodes)));
const variants = (techId: string, nodes: GraphNode[]) => [...new Set(hits(techId, nodes).map(h => h.variant))].sort();

describe('dataflow', () => {
  it('collapses conversion nodes and flattens plain groups', () => {
    const g = [
      nd('uv', 'uv', { out: { uv: 'vec2' } }),
      nd('split', 'splitVec2', { in: { v: ['uv', 'uv'] }, out: { x: 'float', y: 'float' } }),
      nd('grp', 'group', {
        in: { in_x: ['split', 'x'] },
        params: { subgraph: { nodes: [nd('s', 'sin', { in: { input: 'in_x' } })], inputPorts: [], outputPorts: [] } },
      }),
    ];
    const df = toDataflow(g);
    expect(df.nodes.map(n => n.type).sort()).toEqual(['sin', 'uv']);
    const e = df.edges.find(x => x.to === 's');
    expect(e?.from).toBe('uv');
    expect(df.nodes.find(n => n.id === 's')?.path).toEqual(['grp']);
  });

  it('reads containers as their own level with the container noted', () => {
    const g = [nd('loop', 'marchLoopGroup', { params: { subgraph: { nodes: [nd('vg', 'volumeGlow'), nd('d', 'marchSceneDist')] } } })];
    const df = toDataflow(g);
    const vg = df.nodes.find(n => n.id === 'vg')!;
    expect(vg.container).toBe('loop');
    expect(vg.uid).toBe('loop/vg');
    expect(variants('accum-loop', g)).toContain('march');
  });

  it('carries GLSL lines with their idioms', () => {
    const df = toDataflow([expr('e', [['float g', 'exp(-d * 4.0)']], 'g')]);
    expect(df.nodes[0].code?.[0].text).toContain('exp(-d * 4.0)');
  });
});

describe('light falloff matchers', () => {
  const circle = nd('c', 'circleSDF', { out: { distance: 'float' } });
  it('exponential: SDF Glow node (with its shape) and exp(-k·d) in code', () => {
    const g = [circle, nd('l', 'light', { params: { mode: 'glow' }, in: { distance: ['c', 'distance'] } })];
    const h = hits('falloff-exp', g);
    expect(h.map(x => x.variant)).toEqual(['node-glow']);
    expect(h[0].nodes.sort()).toEqual(['c', 'l']);
    expect(variants('falloff-exp', [expr('e', [['float g', 'exp(-d * 4.0)']], 'g')])).toEqual(['code']);
  });
  it('exponential: not for a saturation curve, and Gaussian is its own variant', () => {
    expect(variants('falloff-exp', [expr('e', [['float m', '1.0 - exp(-x * 2.0)']], 'm')])).toEqual([]);
    expect(variants('falloff-exp', [expr('e', [['float g', 'exp(-r * r * 9.0)']], 'g')])).toEqual(['gaussian']);
    expect(variants('soft-clip', [expr('e', [['float m', '1.0 - exp(-x * 2.0)']], 'm')])).toEqual(['exposure']);
  });
  it('inverse: Simple mode and k / d in code; not exp', () => {
    expect(variants('falloff-inverse', [circle, nd('l', 'light', { params: { mode: 'simple' }, in: { distance: ['c', 'distance'] } })])).toEqual(['node-simple']);
    expect(variants('falloff-inverse', [expr('e', [['float g', '0.02 / abs(d)']], 'g')])).toEqual(['code']);
    expect(variants('falloff-inverse', [circle, nd('l', 'light', { params: { mode: 'glow' }, in: { distance: ['c', 'distance'] } })])).toEqual([]);
  });
  it('inverse-square and smoothstep', () => {
    expect(variants('falloff-inverse-square', [expr('e', [['float g', '1.0 / (1.0 + k * d * d)']], 'g')])).toEqual(['code']);
    expect(variants('falloff-smoothstep', [expr('e', [['float m', '1.0 - smoothstep(0.1, 0.2, d)']], 'm')])).toEqual(['code']);
    expect(variants('falloff-smoothstep', [expr('e', [['float m', 'smoothstep(0.1, 0.2, d)']], 'm')])).toEqual([]);
  });
});

describe('other matchers', () => {
  it('ripples: one centre vs several', () => {
    expect(variants('ripples', [expr('e', [['float w', 'sin(20.0 * length(uv - c) - t)']], 'w')])).toEqual(['code']);
    expect(variants('ripples', [expr('e', [['float w', 'sin(20.0 * length(uv - a)) + sin(20.0 * length(uv - b))']], 'w')])).toContain('several');
    expect(variants('ripples', [expr('e', [['float w', 'sin(uv.x * 10.0)']], 'w')])).toEqual([]);
  });
  it('summed waves: two sines added, not one', () => {
    expect(variants('waves-summed', [expr('e', [['float w', 'sin(uv.x * 10.0) + sin(uv.y * 7.0 + t)']], 'w')])).toEqual(['code']);
    expect(variants('waves-summed', [expr('e', [['float w', 'sin(uv.x * 10.0)']], 'w')])).toEqual([]);
    const g = [nd('a', 'sin'), nd('b', 'cos'), nd('s', 'add', { in: { a: ['a', 'result'], b: ['b', 'result'] } })];
    expect(variants('waves-summed', g)).toEqual(['nodes']);
  });
  it('per-cell hash: floor → hash in code; plain hash without a cell is not', () => {
    expect(variants('cell-hash', [expr('e', [['vec2 id', 'floor(uv * 8.0)'], ['float h', 'fract(sin(dot(id, vec2(12.9898, 78.233))) * 43758.5453)']], 'h')])).toEqual(['code']);
    expect(variants('cell-hash', [expr('e', [['float h', 'fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453)']], 'h')])).toEqual([]);
  });
  it('domain warp: noise into another node’s uv (through an Add); and not a lone noise', () => {
    const g = [nd('n', 'fbm', { out: { value: 'float' } }), nd('a', 'add', { in: { a: ['n', 'value'] } }), nd('m', 'fbm', { in: { uv: ['a', 'result'] }, out: { value: 'float' } })];
    expect(variants('domain-warp', g)).toEqual(['noise-into-uv']);
    expect(variants('domain-warp', [nd('n', 'fbm', { out: { value: 'float' } })])).toEqual([]);
  });
  it('SDF union: hard vs smooth by k', () => {
    expect(variants('sdf-boolean', [nd('u', 'sdfUnion', { params: { k: 0 } })])).toEqual(['node']);
    expect(variants('sdf-boolean', [nd('u', 'sdfUnion', { params: { k: 0.3 } })])).toEqual([]);
    expect(variants('sdf-smooth', [nd('u', 'sdfUnion', { params: { k: 0.3 } })])).toEqual(['node']);
  });
  it('iterated fold: a plain group with iterations and a fract inside', () => {
    const g = [nd('grp', 'group', { params: { iterations: 4, subgraph: { nodes: [nd('f', 'fract', { out: { output: 'vec2' } })], inputPorts: [], outputPorts: [] } } })];
    expect(variants('iterated-fold', g)).toEqual(['group']);
    const once = [nd('grp', 'group', { params: { iterations: 1, subgraph: { nodes: [nd('f', 'fract', { out: { output: 'vec2' } })], inputPorts: [], outputPorts: [] } } })];
    expect(variants('iterated-fold', once)).toEqual([]);
  });
  it('every technique has variants, slots and a family', () => {
    for (const t of TECHNIQUES) {
      expect(t.variants.length, t.id).toBeGreaterThan(0);
      expect(t.slots.out.length, t.id).toBeGreaterThan(0);
      expect(t.maths && t.explain, t.id).toBeTruthy();
    }
    expect(new Set(TECHNIQUES.map(t => t.id)).size).toBe(TECHNIQUES.length);
  });
});

describe('miner', () => {
  const g = (id: string, nodes: GraphNode[]) => ({ graphId: id, df: toDataflow(nodes) });
  const chainAB = (p: string) => [nd(`${p}c`, 'circleSDF', { out: { distance: 'float' } }), nd(`${p}l`, 'light', { in: { distance: [`${p}c`, 'distance'] }, out: { glow: 'float' } }), nd(`${p}o`, 'output', { in: { color: [`${p}l`, 'glow'] } })];

  it('counts support per graph and leaves trivial nodes out', () => {
    const mined = minePatterns([g('a', chainAB('a')), g('b', chainAB('b')), g('c', chainAB('c')), g('d', [nd('x', 'circleSDF')])], { minSupport: 2 });
    expect(mined.map(m => [m.text, m.support])).toEqual([['circleSDF.distance → light.distance', 3]]);
  });

  it('labels isomorphic subgraphs the same whatever the node names', () => {
    const t = new Map([['p', 'sin'], ['q', 'sin'], ['r', 'add'], ['x', 'sin'], ['y', 'sin'], ['z', 'add']]);
    const w = new Map<string, Array<[string, string]>>([['p', [['r', 'result>a']]], ['q', [['r', 'result>b']]], ['x', [['z', 'result>b']]], ['y', [['z', 'result>a']]]]);
    const a = canonical(['p', 'q', 'r'], u => t.get(u)!, u => w.get(u) ?? []);
    const b = canonical(['z', 'y', 'x'], u => t.get(u)!, u => w.get(u) ?? []);
    expect(a.key).toBe(b.key);
  });

  it('is deterministic (same result twice, and whatever the input order)', () => {
    const inputs = Object.entries(EXAMPLE_GRAPHS).slice(0, 80).map(([k, x]) => g(k, x.nodes));
    const sig = (r: ReturnType<typeof minePatterns>) => r.map(m => `${m.key}:${m.support}:${m.count}`).join('\n');
    const one = sig(minePatterns(inputs));
    expect(sig(minePatterns(inputs))).toBe(one);
    expect(sig(minePatterns([...inputs].reverse()))).toBe(one);
  });
});

describe('index', () => {
  const examples: GraphInput[] = Object.entries(EXAMPLE_GRAPHS).filter(([k]) => k !== 'blank').map(([k, x]) => ({ id: `example:${k}`, label: x.label, origin: 'example', nodes: x.nodes }));

  it('runs on all examples in reasonable time, most graphs have a technique', () => {
    const t0 = performance.now();
    const ix = buildPatternIndex(examples);
    const ms = performance.now() - t0;
    const covered = ix.graphs.filter(x => x.techniques.length).length;
    // Recorded in docs/reports/pattern-discovery.md (≈ 0.2 s for ~400 graphs on an M-series laptop).
    expect(ms).toBeLessThan(10000);
    expect(covered / ix.graphs.length).toBeGreaterThan(0.9);
    // Cached by hash: a second run is cheap and gives the same answer.
    const again = buildPatternIndex(examples);
    expect(again.graphs.map(x => x.techniques.join()).join('|')).toBe(ix.graphs.map(x => x.techniques.join()).join('|'));
    expect(graphsUsing(ix, { technique: 'falloff-exp' }).length).toBeGreaterThan(20);
    expect(graphsUsing(ix, { family: 'waves' }).length).toBeGreaterThan(3);
    // Candidates come back, and none of them is wholly a named technique.
    const cands = rankCandidates(minePatterns(examples.slice(0, 120).map(x => ({ graphId: x.id, df: toDataflow(x.nodes) }))), ix, { limit: 10 });
    expect(cands.every(c => c.covered <= 0.5)).toBe(true);
  });

  it('answers per node and by words', () => {
    const nodes = [nd('c', 'circleSDF', { out: { distance: 'float' } }), nd('l', 'light', { in: { distance: ['c', 'distance'] }, out: { tinted: 'vec3' } }), nd('t', 'toneMap', { in: { color: ['l', 'tinted'] } })];
    const gp = analyseGraph({ id: 'open:', label: 'Open', origin: 'open', nodes });
    expect(techniquesAtNode(gp, 'c').map(x => x.technique.id)).toContain('falloff-exp');
    expect(techniquesAtNode(gp, 't').map(x => x.technique.id)).toEqual(['soft-clip']);
    expect(findTechniques('wave interference')[0].id).toBe('waves-summed');
  });
});
