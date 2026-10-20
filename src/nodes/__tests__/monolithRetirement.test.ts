// @vitest-environment jsdom
/**
 * The 2026-10-19 monolith retirement (nodes/notOffered.ts MONOLITH_RETIRED_TYPES, docs/node-retirements.md
 * "Whole-shader nodes"): the "whole shader" nodes are offered nowhere but still load and render; the examples that
 * used one are rebuilt from small nodes; and the small nodes fractals need (Log, Complex Divide, Loop Break, Loop
 * Carry, Loop Index) are offered.
 */
import { describe, expect, it } from 'vitest';
import type { GraphNode } from '../../types/nodeGraph';
import { BUILDER_WRITTEN_TYPES, MONOLITH_RETIRED_TYPES, NOT_OFFERED, RETIRED_TYPES } from '../notOffered';
import { NODE_REGISTRY, getNodeDefinition, getOfferedDefinitions } from '../definitions';
import { switchFamiliesFor } from '../switchNode';
import { HIDDEN_TYPES } from '../../components/NodeGraph/nodeCategoryMeta';
import { CATEGORY_ORDER, HIDDEN_NODES, libraryLayout, nodesOfRow } from '../../components/NodeGraph/libraryRows';
import { creatable } from '../../lang/barAssist';
import { STARTER_RECIPES } from '../recipes';
import { DEFAULT_EXAMPLE, EXAMPLE_FOLDERS, EXAMPLE_INDEX, RETIRED_EXAMPLE_KEYS } from '../../store/exampleIndex';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { MERGED_EXAMPLES, migrateLoadedNodes } from '../../store/useNodeGraphStore';
import { compileGraph } from '../../compiler/graphCompiler';
import { n, group, port } from '../../store/graphBuilder';
import { ROLE_KEY } from '../../sceneBuilder/build';

const walk = (nodes: GraphNode[], out: GraphNode[] = []): GraphNode[] => {
  for (const nd of nodes) { out.push(nd); const sg = nd.params?.subgraph as { nodes?: GraphNode[] } | undefined; if (sg?.nodes) walk(sg.nodes, out); }
  return out;
};

describe('the whole-shader nodes are retired: hidden, not deleted', () => {
  it('are on the retired list, still registered, with no DEPRECATED badge', () => {
    expect(MONOLITH_RETIRED_TYPES).toHaveLength(22);
    for (const t of MONOLITH_RETIRED_TYPES) {
      expect(RETIRED_TYPES, t).toContain(t);
      expect(NODE_REGISTRY[t], t).toBeTruthy();
      expect(NODE_REGISTRY[t].deprecated, t).toBeFalsy();
    }
    // Kept on purpose: the Scene Builder's 4D fractal shapes and the pattern / field generators.
    for (const t of ['quatJuliaSDF', 'quatMandelSDF', 'truchet', 'lissajous', 'cmykHalftone', 'noisyGridSDF', 'chladniField']) expect(NOT_OFFERED.has(t), t).toBe(false);
  });

  it('nothing offers them: browser rows, search, Do bar, phone browser, Switch to, starter recipes', () => {
    const offered = new Set(getOfferedDefinitions().map(d => d.type));
    const rows = new Set(CATEGORY_ORDER.flatMap(r => nodesOfRow(r).map(d => d.type)).filter(t => !HIDDEN_NODES.has(t)));
    const phone = new Set(libraryLayout(HIDDEN_TYPES).flatMap(s => s.rows.flatMap(r => r.groups.flatMap(g => g.types))));
    const bar = new Set(creatable(new Set()).flatMap(c => c.words ?? []));
    for (const t of MONOLITH_RETIRED_TYPES) {
      expect(offered.has(t), t).toBe(false);
      expect(rows.has(t), t).toBe(false);
      expect(phone.has(t), t).toBe(false);
      expect(HIDDEN_TYPES.has(t) && HIDDEN_NODES.has(t), t).toBe(true);
      expect(bar.has(t), t).toBe(false);
      expect(STARTER_RECIPES[t], t).toBeUndefined();
      expect(switchFamiliesFor(t), t).toEqual([]);
    }
  });

  it('a type hidden from the browser rows is hidden from search, the Do bar and the phone too (no half-hidden nodes)', () => {
    // Hidden from the desktop rows only, on purpose: Output (one per graph, made with it), the Oscilloscope, and the
    // anchors a March Loop, Shader Texture or Splat Scene makes inside itself (search finds them when one goes missing).
    const ROWS_ONLY = new Set(['output', 'vec4Output', 'scope', 'marchLoopInputs', 'marchLoopOutput', 'shaderTextureOutput', 'splatModOut']);
    const offered = new Set(getOfferedDefinitions().map(d => d.type));
    const half = [...HIDDEN_NODES].filter(t => offered.has(t) && !HIDDEN_TYPES.has(t) && !ROWS_ONLY.has(t));
    expect(half).toEqual([]);
  });

  it('a saved graph with one still loads and compiles', () => {
    const old = (type: string, params: Record<string, unknown> = {}): GraphNode[] => {
      const node = n(type, 'old', 300, 0, params, { uv: ['uv', 'uv'] });
      const outKey = Object.keys(node.outputs)[0];
      return [n('uv', 'uv', 0, 0), node, n('output', 'out', 600, 0, {}, { color: ['old', outKey] })];
    };
    for (const t of ['fractalLoop', 'mandelbrot', 'newtonFractal', 'magicTexture', 'metaballs']) {
      const r = compileGraph({ nodes: migrateLoadedNodes(old(t)) });
      expect(r.errors ?? [], t).toEqual([]);
      expect(r.fragmentShader, t).toBeTruthy();
    }
  });
});

describe('examples are built from small nodes', () => {
  const listed = [...new Set([...EXAMPLE_FOLDERS.flatMap(f => f.keys), ...RETIRED_EXAMPLE_KEYS])];

  it('no listed or retired-list example uses a type that is not offered (a builder\'s own renderer aside)', () => {
    for (const k of listed) {
      const g = EXAMPLE_GRAPHS[k];
      expect(g, k).toBeTruthy();
      const bad = walk(g.nodes).filter(nd => NOT_OFFERED.has(nd.type) && !(BUILDER_WRITTEN_TYPES.includes(nd.type) && nd.params?.[ROLE_KEY]));
      expect(bad.map(nd => nd.type), k).toEqual([]);
    }
  });

  it('no example at all uses a retired whole-shader node', () => {
    for (const [k, g] of Object.entries(EXAMPLE_GRAPHS)) {
      const used = walk(g.nodes).filter(nd => MONOLITH_RETIRED_TYPES.includes(nd.type) && !(BUILDER_WRITTEN_TYPES.includes(nd.type) && nd.params?.[ROLE_KEY]));
      expect(used.map(nd => nd.type), k).toEqual([]);
    }
  });

  it('the rebuilt fractals keep their keys, build up from loops and use no Expression Blocks', () => {
    expect(DEFAULT_EXAMPLE).toBe('fractalRings');
    for (const k of ['fractalRings', 'learnFractal', 'newtonFractalZ5', 'groupJuliaBreak', 'motionBlurTrails']) {
      const all = walk(EXAMPLE_GRAPHS[k].nodes);
      expect(all.some(nd => nd.type === 'group' && Number(nd.params.iterations) > 1), k).toBe(true);
      expect(all.some(nd => nd.type === 'loopCarry'), k).toBe(true);
      expect(all.filter(nd => ['exprNode', 'simpleExpr', 'customFn'].includes(nd.type)), k).toEqual([]);
      expect(compileGraph({ nodes: migrateLoadedNodes(EXAMPLE_GRAPHS[k].nodes) }).errors ?? [], k).toEqual([]);
    }
    expect(walk(EXAMPLE_GRAPHS.learnFractal.nodes).map(nd => nd.type)).toEqual(expect.arrayContaining(['complexMul', 'loopBreak', 'log']));
    expect(walk(EXAMPLE_GRAPHS.newtonFractalZ5.nodes).map(nd => nd.type)).toEqual(expect.arrayContaining(['complexPow', 'complexDiv', 'loopBreak']));
  });

  it('merged keys open the example that replaced them', () => {
    expect(MERGED_EXAMPLES.groupCarryRings).toBe('fractalRings');
    expect(MERGED_EXAMPLES.raymarchSpheres).toBe('learn3dMarch');
    for (const k of ['groupCarryRings', 'raymarchSpheres']) {
      expect(EXAMPLE_GRAPHS[k], k).toBeUndefined();
      expect(EXAMPLE_INDEX[k], k).toBeUndefined();
      expect(EXAMPLE_GRAPHS[MERGED_EXAMPLES[k]], k).toBeTruthy();
    }
  });
});

describe('the small nodes fractals need', () => {
  const code = (node: GraphNode, inputs: Record<string, string> = {}) => getNodeDefinition(node.type)!.generateGLSL(node, inputs).code;

  it('Log: natural, base 2 and base 10, guarded unless Exact, on vectors too', () => {
    expect(code(n('log', 'l', 0, 0), { input: 'x' })).toBe('    float l_output = log(max(x, 1e-8));\n');
    expect(code(n('log', 'l', 0, 0, { base: '2' }), { input: 'x' })).toBe('    float l_output = log2(max(x, 1e-8));\n');
    expect(code(n('log', 'l', 0, 0, { base: '10', exact: true }), { input: 'x' })).toBe('    float l_output = log2(x) * 0.30103;\n');
    expect(code(n('log', 'l', 0, 0, { outputType: 'vec2' }), { input: 'v' })).toBe('    vec2 l_output = log(max(v, vec2(1e-8)));\n');
  });

  it('Complex Divide: A × conj(B) ÷ |B|² (so (3+4i) ÷ (1+2i) = 2.2 − 0.4i)', () => {
    const glsl = code(n('complexDiv', 'q', 0, 0), { a: 'A', b: 'B' });
    expect(glsl).toContain('q_av.x*q_bv.x + q_av.y*q_bv.y, q_av.y*q_bv.x - q_av.x*q_bv.y');
    // The same formula in JS.
    const div = ([ax, ay]: number[], [bx, by]: number[]) => { const bb = bx * bx + by * by; return [(ax * bx + ay * by) / bb, (ay * bx - ax * by) / bb]; };
    const [re, im] = div([3, 4], [1, 2]);
    expect(re).toBeCloseTo(2.2);
    expect(im).toBeCloseTo(-0.4);
  });

  it('Loop Break: an iterated group stops after the pass\'s carries are written; elsewhere it does nothing', () => {
    const inner = (when: boolean) => [
      { ...n('loopCarry', 'z', 0, 0, { dataType: 'float' }, { next: ['zn', 'result'] }), inputs: { init: { type: 'float' as const, label: 'Init' }, next: { type: 'float' as const, label: 'Next', connection: { nodeId: 'zn', outputKey: 'result' } } }, outputs: { value: { type: 'float' as const, label: 'Value' } } },
      n('add', 'zn', 200, 0, { b: 1 }, { a: ['z', 'value'] }),
      n('compare', 'big', 400, 0, { operator: '>' }, { a: ['zn', 'result'], b: port('in_k') }),
      n('loopBreak', 'stop', 600, 0, {}, when ? { when: ['big', 'mask'] } : {}),
      n('makeVec3', 'col', 600, 200, {}, { r: ['z', 'value'] }),
    ];
    const graph = (iterations: number, when = true) => [
      n('constant', 'k', 0, 0, { value: 3 }),
      group('g', 200, 0, { label: 'count', iterations, inputs: [{ key: 'in_k', type: 'float', label: 'k', from: ['k', 'value'] }], outputs: [{ key: 'out_c', type: 'vec3', label: 'C', from: ['col', 'rgb'] }], nodes: inner(when) }),
      n('output', 'out', 400, 0, {}, { color: ['g', 'out_c'] }),
    ];
    const fs = compileGraph({ nodes: graph(8) }).fragmentShader!;
    const loop = fs.slice(fs.indexOf('for (float'));
    const brk = loop.indexOf('break;');
    expect(brk).toBeGreaterThan(0);
    // After the carry update, before the loop closes.
    expect(loop.lastIndexOf('_lc_', brk)).toBeGreaterThan(0);
    expect(loop.slice(0, brk + 6)).toMatch(/_lc_\w+ = \w+;\n[\s\S]*if \(\w+_when > 0\.5\) break;$/);
    // Unwired, or not in a loop: no break.
    const main = (iters: number, when = true) => compileGraph({ nodes: graph(iters, when) }).fragmentShader!.split('void main')[1];
    expect(main(8, false)).not.toContain('break;');
    expect(compileGraph({ nodes: graph(1) }).errors ?? []).toEqual([]);
    expect(main(1)).not.toContain('break;');
  });

  it('Log, Complex Divide and the loop nodes are in the library (Loop Carry and Loop Index no longer hidden)', () => {
    const offered = new Set(getOfferedDefinitions().map(d => d.type));
    const loops = new Set(nodesOfRow('Loops').map(d => d.type).filter(t => !HIDDEN_NODES.has(t)));
    for (const t of ['log', 'complexDiv', 'loopCarry', 'loopIndex', 'loopBreak']) {
      expect(offered.has(t), t).toBe(true);
      expect(HIDDEN_NODES.has(t) || HIDDEN_TYPES.has(t), t).toBe(false);
    }
    for (const t of ['loopCarry', 'loopIndex', 'loopBreak']) expect(loops.has(t), t).toBe(true);
    expect(switchFamiliesFor('exp').flatMap(f => f.types)).toContain('log');
  });
});
