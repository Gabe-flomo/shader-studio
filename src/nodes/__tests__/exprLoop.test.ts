/**
 * Loop mode for Expression Blocks (nodes/exprLoop.ts, docs/expression-block.md "Loop"): the code
 * each section makes, carried and hoisted variables, Break when, a live Iterations (a uniform, no
 * recompile) against Max iterations (a recompile), the clamp, Copy as code / Make a function, the
 * examples, save round-trip and the pass-by-pass numbers.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import { parser } from '@shaderfrog/glsl-parser';
import type { GraphNode } from '../../types/nodeGraph';
import { compileGraph } from '../../compiler/graphCompiler';
import { getNodeDefinition, resolveNodeAliases } from '../definitions';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { clampCount, loopCode, loopNameClashes, loopOnPatch, LOOP_MAX_DEFAULT, type ExprLoop } from '../exprLoop';
import { exprBlockFunctionText, exprBlockLinesText, exprBlockToCustomFn } from '../exprToCustomFn';
import { buildExprLoopExamples, EXPR_LOOP_EXAMPLE_KEYS } from '../../store/exprLoopExamples';
import { unfiledIn } from '../../store/exampleIndex';
import { exprPresetParams } from '../../lib/glslPatterns';
import { workedLoop } from '../../lib/glslPatterns';
import { loopPassesOf } from '../../components/explain/LoopPasses';
import { buildCompletions } from '../../components/code/glslReference';
import { exprBlockEnv } from '../../lib/glslPatterns/findUses';
import { rulesTemplateNodes } from '../../agentRules/templates';
import { buildSplatStandalone } from '../../splatBuilder/build';
import { newEffect, starterSplatScene } from '../../splatBuilder/spec';
import type { SubgraphData } from '../../types/nodeGraph';

const parses = (fs: string) => { try { parser.parse(fs.replace(/^#version.*$/m, ''), { quiet: true }); return null; } catch (e) { return (e as Error).message.split('\n')[0]; } };

type L = { lhs: string; op: string; rhs: string; off?: boolean };
const ln = (lhs: string, op: string, rhs: string): L => ({ lhs, op, rhs });

/** UV → a looped block (uv input, an `a` slider) → Output. */
function graph(params: Record<string, unknown>): GraphNode[] {
  return [
    { id: 'uv', type: 'uv', position: { x: 0, y: 0 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} },
    {
      id: 'blk', type: 'exprNode', position: { x: 200, y: 0 },
      inputs: { uv: { type: 'vec2', label: 'uv', connection: { nodeId: 'uv', outputKey: 'uv' } }, a: { type: 'float', label: 'a', defaultValue: 0.5 } },
      outputs: { result: { type: 'vec3', label: 'Result' } },
      params: {
        inputs: [{ name: 'uv', type: 'vec2', slider: null }, { name: 'a', type: 'float', slider: { min: 0, max: 1 } }], a: 0.5,
        outputType: 'vec3', result: 'vec3(acc)', ...params,
      },
    },
    { id: 'out', type: 'output', position: { x: 400, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: 'blk', outputKey: 'result' } } }, outputs: {}, params: {} },
  ];
}

const sum: Record<string, unknown> = {
  loop: { on: true, before: [ln('float acc', '=', '0.0')], after: [ln('acc', '/=', 'n')] } satisfies ExprLoop,
  loopN: 5,
  lines: [ln('acc', '+=', 'a * k')],
};

const compile = (nodes: GraphNode[]) => compileGraph({ nodes });

describe('loop codegen', () => {
  it('emits Before once, a bounded for loop with i / fi / n / k, the looped lines, After, then Return', () => {
    const r = compile(graph(sum));
    expect(r.success, r.errors?.join('; ')).toBe(true);
    const fs = r.fragmentShader;
    expect(parses(fs)).toBeNull();
    const at = (s: string) => fs.indexOf(s);
    expect(at('float acc = 0.0;')).toBeGreaterThan(0);
    expect(fs).toMatch(/int \w+_n = int\(clamp\(floor\(u_p_\w+_loopN \+ 0\.5\), 0\.0, 128\.0\)\);/);
    expect(fs).toContain(`for (int i = 0; i < ${LOOP_MAX_DEFAULT}; i++) {`);
    expect(fs).toMatch(/if \(i >= \w+_n\) break;/);
    expect(fs).toContain('float fi = float(i);');
    expect(fs).toContain('float k = fi / max(n - 1.0, 1.0);');
    // Order: Before < for < looped line < After < result
    expect(at('float acc = 0.0;')).toBeLessThan(at('for (int i'));
    expect(at('for (int i')).toBeLessThan(at('acc += '));
    expect(at('acc += ')).toBeLessThan(at('acc /= n;'));
    expect(at('acc /= n;')).toBeLessThan(at('_result = vec3(acc);'));
  });

  it('carries variables: a looped line declaring one is hoisted (declared once, assigned each pass, read after)', () => {
    const code = loopCode({ before: [ln('vec2 z', '=', 'uv')], body: [ln('z', '=', 'z * 0.5'), ln('float d', '=', 'length(z)')], after: [], max: 16, count: 4, declared: new Set(['uv']) });
    const text = code.map(c => `${'  '.repeat(c.depth)}${c.text}`).join('\n');
    expect(text).toContain('vec2 z = uv;');
    expect(text).toContain('float d = 0.0;');
    expect(text).toMatch(/\n {2}d = length\(z\);/);
    expect(text).not.toMatch(/ {2}float d = length/);
    // The hoisted declaration is before the loop, so After / Return / Also outputs can read it
    expect(text.indexOf('float d = 0.0;')).toBeLessThan(text.indexOf('for (int i'));
    // A literal count is clamped to Max and written in
    expect(text).toContain('if (i >= 4) break;');
    expect(loopCode({ before: [], body: [], after: [], max: 16, count: 900, declared: new Set() }).some(c => c.text === 'if (i >= 16) break;')).toBe(true);
  });

  it('Break when stops the loop after the pass', () => {
    const r = compile(graph({ ...sum, loop: { ...(sum.loop as ExprLoop), breakWhen: 'acc > 0.3;' } }));
    expect(r.success, r.errors?.join('; ')).toBe(true);
    expect(r.fragmentShader).toMatch(/acc \+= [^\n]+\n\s+if \(acc > 0\.3\) break;/);
    expect(parses(r.fragmentShader)).toBeNull();
  });

  it('a block with Loop off compiles as before (Before / After kept for later, not run)', () => {
    const off = compile(graph({ ...sum, loop: { ...(sum.loop as ExprLoop), on: false }, lines: [ln('float acc', '=', 'a')] }));
    expect(off.success).toBe(true);
    expect(off.fragmentShader).not.toContain('for (int i');
    expect(off.fragmentShader).not.toContain('acc /= n');
  });

  it('a hoisted variable can be an Also output', () => {
    const r = compile(graph({ ...sum, lines: [ln('float d', '=', 'length(uv) * fi')], result: 'vec3(d)', outputs: ['d'] }));
    expect(r.success, r.errors?.join('; ')).toBe(true);
    expect(parses(r.fragmentShader)).toBeNull();
  });

  it('warns about inputs or lines that take the loop’s names', () => {
    expect(loopNameClashes({ ...sum, inputs: [{ name: 'k', type: 'float' }] })).toEqual(['k']);
    expect(loopNameClashes({ ...sum, lines: [ln('float i', '=', '1.0')] })).toEqual(['i']);
    expect(loopNameClashes({ ...sum, loop: { on: false } })).toEqual([]);
  });

  it('Loop on starts at 8 iterations and keeps Before / After from before', () => {
    expect(loopOnPatch({}, true)).toEqual({ loop: { on: true }, loopN: 8 });
    expect(loopOnPatch({ loop: { on: false, before: [ln('float a', '=', '1.0')] }, loopN: 3 }, true)).toEqual({ loop: { on: true, before: [ln('float a', '=', '1.0')] } });
    expect(clampCount(500, 128)).toBe(128);
    expect(clampCount(-2, 128)).toBe(0);
  });
});

describe('Iterations is live; Max iterations recompiles', () => {
  const st = () => useNodeGraphStore.getState();
  beforeEach(() => st().replaceGraph(graph(sum)));

  it('Iterations is a uniform bound to blk::loopN: a drag writes it without recompiling', () => {
    const u = st().paramBindings['blk::loopN'];
    expect(u).toMatch(/^u_p_\w+_loopN$/);
    expect(st().paramUniforms[u]).toBe(5);
    const before = st().fragmentShader;
    st().updateNodeParams('blk', { loopN: 40 }, { immediate: true });
    expect(st().paramUniforms[u]).toBe(40);
    expect(st().fragmentShader).toBe(before);
  });

  it('a new Max iterations recompiles with the new bound', () => {
    const r1 = compile(graph(sum));
    const r2 = compile(graph({ ...sum, loop: { ...(sum.loop as ExprLoop), max: 300 } }));
    expect(r1.fragmentShader).toContain('i < 128;');
    expect(r2.fragmentShader).toContain('i < 300;');
    expect(r2.fragmentShader).toContain('0.0, 300.0)');
    // Iterations alone: the same shader text, a different uniform value
    const r3 = compile(graph({ ...sum, loopN: 99 }));
    expect(r3.fragmentShader).toBe(r1.fragmentShader);
  });
});

describe('Copy as code, Make a function, the card', () => {
  const node = graph({ ...sum, loop: { ...(sum.loop as ExprLoop), breakWhen: 'acc > 2.0' } })[1];

  it('Copy as code is a real GLSL for loop', () => {
    const text = exprBlockLinesText(node);
    expect(text).toBe([
      '// Before the loop',
      'float acc = 0.0;',
      'float n = float(5);',
      'for (int i = 0; i < 128; i++) {',
      '  if (i >= 5) break;',
      '  float fi = float(i);',
      '  float k = fi / max(n - 1.0, 1.0);',
      '  acc += a * k;',
      '  if (acc > 2.0) break;',
      '}',
      '// After the loop',
      'acc /= n;',
      'return vec3(acc);',
    ].join('\n'));
  });

  it('Copy as a GLSL function wraps the loop', () => {
    const fn = exprBlockFunctionText(node);
    expect(fn).toMatch(/^\/\/ a = 0\.5\nvec3 expression\(vec2 uv, float a\) \{/);
    expect(fn).toContain('  for (int i = 0; i < 128; i++) {');
  });

  it('Turn into a Custom Function: the loop in the body, Iterations a slider input, and it compiles', () => {
    const r = exprBlockToCustomFn(node);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.node.params.loop).toBeUndefined();
    expect(r.node.params.inputs).toContainEqual({ name: 'iterations', type: 'float', slider: { min: 1, max: 128 } });
    expect(r.node.params.iterations).toBe(5);
    expect(String(r.node.params.body)).toContain('floor(iterations + 0.5)');
    const nodes = graph(sum).map(x => (x.id === 'blk' ? { ...r.node, inputs: { ...r.node.inputs, iterations: { type: 'float' as const, label: 'iterations' } } } : x));
    const c = compile(nodes);
    expect(c.success, c.errors?.join('; ')).toBe(true);
    expect(parses(c.fragmentShader)).toBeNull();
  });

  it('autocomplete and the explain types know i, fi, n, k', () => {
    const names = buildCompletions([{ name: 'uv', type: 'vec2' }], [{ name: 'k', type: 'float', doc: 'x' }]).filter(c => c.kind === 'var').map(c => c.name);
    expect(names).toEqual(['uv', 'k']);
    const env = exprBlockEnv(node);
    expect(env).toMatchObject({ i: 'int', fi: 'float', n: 'float', k: 'float', acc: 'float' });
  });
});

describe('saving', () => {
  it('a graph round-trips through JSON and compiles the same', () => {
    const nodes = graph({ ...sum, loop: { ...(sum.loop as ExprLoop), max: 64, breakWhen: 'acc > 1.0' } });
    const back = JSON.parse(JSON.stringify(nodes)) as GraphNode[];
    expect(back[1].params.loop).toEqual(nodes[1].params.loop);
    expect(compile(back).fragmentShader).toBe(compile(nodes).fragmentShader);
  });

  it('a saved preset keeps the loop and Iterations', () => {
    const loop = { on: true, max: 32, before: [ln('float acc', '=', '0.0')] };
    const p = exprPresetParams({ label: 'x', inputs: [], outputType: 'float', lines: [], result: 'acc', loop, loopN: 12 });
    expect(p).toMatchObject({ loop, loopN: 12 });
  });
});

describe('the examples', () => {
  const all = buildExprLoopExamples();
  it('are in Groups & Code or retired', () => {
    expect(unfiledIn('Groups & Code', EXPR_LOOP_EXAMPLE_KEYS)).toEqual([]);
  });
  it.each(EXPR_LOOP_EXAMPLE_KEYS)('%s compiles, parses, has a live Iterations and notes on every node', key => {
    const nodes = resolveNodeAliases(all[key].nodes, getNodeDefinition);
    const r = compileGraph({ nodes });
    expect(r.errors ?? []).toEqual([]);
    expect(r.success).toBe(true);
    expect(parses(r.fragmentShader)).toBeNull();
    const blk = nodes.find(x => x.type === 'exprNode')!;
    expect(r.paramBindings[`${blk.id}::loopN`]).toBeTruthy();
    for (const x of nodes) expect(String(x.params.__comment ?? ''), x.id).not.toBe('');
  });
});

describe('stepping through the passes', () => {
  it('records each variable after each pass, and stops at Break when', () => {
    const w = workedLoop({ before: ['float acc = 0.0'], body: ['acc += 1.0'], breakWhen: 'acc > 2.5', n: 10, inputs: [] });
    expect(w.names).toEqual(['acc']);
    expect(w.start.acc).toBe(0);
    expect(w.passes.map(p => p.values.acc)).toEqual([1, 2, 3]);
    expect(w.passes[2].broke).toBe(true);
  });

  it('gives a looped block’s passes from its sample inputs (k runs 0..1)', () => {
    const nodes = graph(sum);
    const w = loopPassesOf(nodes[1], nodes)!;
    expect(w.passes).toHaveLength(5);
    // a = 0.5 (the slider), k = 0, .25, .5, .75, 1: acc = 0.5 × (0 + .25 + .5 + .75 + 1) = 1.25 before After
    expect(w.passes[4].values.acc as number).toBeCloseTo(1.25, 6);
    expect(w.passes[0].ranges.acc).toEqual([[0, 0]]);
  });

  it('the Julia example escapes early at some pixels', () => {
    const ex = buildExprLoopExamples().loopJulia;
    const blk = ex.nodes.find(x => x.type === 'exprNode')!;
    const w = loopPassesOf(blk, ex.nodes)!;
    expect(w.names).toEqual(['z', 'esc']);
    expect(w.passes.length).toBeGreaterThan(0);
  });
});

describe('other programs', () => {
  const looped = (n: GraphNode): GraphNode => ({ ...n, params: { ...n.params, loop: { on: true, before: [ln('float lp', '=', '0.0')] }, loopN: 3, lines: [...((n.params.lines as L[]) ?? []), ln('lp', '+=', 'fi')] } });

  it('compiles inside an Agents group’s update program, its Iterations live there too', () => {
    const nodes = rulesTemplateNodes('slime', 'lp');
    const gi = nodes.findIndex(x => x.type === 'agentsGroup');
    const sub = nodes[gi].params.subgraph as SubgraphData;
    const bi = sub.nodes.findIndex(x => x.type === 'exprNode');
    expect(bi).toBeGreaterThanOrEqual(0);
    const id = sub.nodes[bi].id;
    nodes[gi] = { ...nodes[gi], params: { ...nodes[gi].params, subgraph: { ...sub, nodes: sub.nodes.map((x, k) => (k === bi ? looped(x) : x)) } } };
    const r = compileGraph({ nodes });
    expect(r.errors ?? []).toEqual([]);
    const fs = r.agents!.groups[0].fragmentShader;
    expect(fs).toContain('for (int i = 0; i < 128; i++) {');
    expect(parses(fs)).toBeNull();
    expect(r.paramBindings[`${id}::loopN`]).toBeTruthy();
  });

  it('compiles in a Splat Scene’s per-splat modifier program', () => {
    const g = buildSplatStandalone({ ...starterSplatScene(), effects: [newEffect('wave', 'w1')] });
    const wave = g.nodes.find(x => x.type === 'splatWave')!;
    const blk: GraphNode = {
      id: 'lpb', type: 'exprNode', position: { x: 0, y: 0 }, inputs: {}, outputs: { result: { type: 'float', label: 'Result' } },
      params: { inputs: [], outputType: 'float', loop: { on: true, before: [ln('float s', '=', '0.0')] }, loopN: 4, lines: [ln('s', '+=', 'k')], result: 's + t' },
    };
    const nodes = [...g.nodes.map(x => (x.id === wave.id ? { ...x, inputs: { ...x.inputs, time: { ...x.inputs.time, connection: { nodeId: 'lpb', outputKey: 'result' } } } } : x)), blk];
    const r = compileGraph({ nodes });
    expect(r.errors ?? []).toEqual([]);
    const fs = r.splats![0].modifier!.fragmentShader;
    expect(fs).toContain('for (int i = 0; i < 128; i++) {');
    expect(parses(fs)).toBeNull();
  });
});
