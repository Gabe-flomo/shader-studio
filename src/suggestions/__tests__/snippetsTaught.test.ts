/**
 * The snippet library (suggestions/snippets.ts), taught moves (taught.ts) and the connection
 * check (connectionCheck.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; },
  key: () => null, get length() { return Object.keys(store).length; }, clear: () => { for (const k of Object.keys(store)) delete store[k]; },
});

import { parser } from '@shaderfrog/glsl-parser';
import preprocess from '@shaderfrog/glsl-parser/preprocessor';
import { compileGraph } from '../../compiler/graphCompiler';
import { n } from '../../store/graphBuilder';
import { estimateNodeHeight } from '../../store/graphLayout';
import type { GraphNode } from '../../types/nodeGraph';
import { SNIPPETS, searchSnippets, snippetForFunction, snippetLines } from '../snippets';
import { exportTaught, importTaught, matchTaught, reloadTaught, renameTaught, taughtMoves, teachFromSelection, deleteTaught, TAUGHT_KEY } from '../taught';
import { parseDo, runDoPlan } from '../doBar';
import { rankMoves } from '../rank';
import { checkConnection, wiresAmong } from '../connectionCheck';
import { learnGraph, setLearningStorage, learnedTable, personalTable, priorTable, type KV } from '../learning';
import { exprBlock } from '../moves';

const H = (nd: GraphNode) => estimateNodeHeight(nd);
const parses = (fs: string) => expect(() => parser.parse(preprocess('vec4 gl_FragColor;\nvec4 gl_FragCoord;\n' + fs, { preserve: {} }), { quiet: true, failOnWarn: true })).not.toThrow();
const out = (wire: [string, string], type: 'float' | 'vec2' | 'vec3') => [
  ...(type === 'vec3' ? [] : [n(type === 'float' ? 'floatToVec3' : 'palette', 'show', 1200, 0, {}, type === 'float' ? { input: wire } : {})]),
  n('output', 'o', 1600, 0, {}, { color: type === 'vec3' ? wire : ['show', type === 'float' ? 'rgb' : 'color'] }),
];

describe('snippets', () => {
  it('are searchable by name and phrase', () => {
    expect(searchSnippets('smooth min')[0].id).toBe('smin');
    expect(searchSnippets('melt')[0].id).toBe('smin');
    expect(searchSnippets('hash')[0].id).toBe('hash21');
    expect(searchSnippets('palette')[0].id).toBe('cosPalette');
    expect(searchSnippets('')).toHaveLength(SNIPPETS.length);
  });

  for (const s of SNIPPETS) {
    it(`${s.id}: Expression Block lines compile, wired to the block's variables`, () => {
      const inputs = [{ name: 'a', type: 'float' as const }, { name: 'b', type: 'float' as const }, { name: 'p', type: 'vec2' as const }];
      const existing = [{ lhs: 'float h', op: '=', rhs: 'a * 2.0' }];
      const r = snippetLines(s, inputs, existing);
      // A temporary called h is renamed: the block already declares one.
      expect(r.lines.map(l => l.lhs).filter(l => /\bh$/.test(l))).toEqual([]);
      const e = exprBlock('e', 400, 0, { label: 'S', inputs, lines: [...existing, ...r.lines].map(l => [l.lhs, l.rhs] as [string, string]), result: r.result, outputType: r.resultType, comment: 'x' });
      e.inputs.a.connection = { nodeId: 'u', outputKey: 'x' };
      const res = compileGraph({ nodes: [n('mouse', 'u', 0, 0), e, ...out(['e', 'result'], r.resultType)] });
      expect(res.errors, JSON.stringify(res.errors)).toBeUndefined();
      parses(res.fragmentShader!);
      if (s.args[0].type === 'float') expect(r.lines.some(l => l.rhs.includes('a'))).toBe(true);
    });
    it(`${s.id}: Custom Function helper + call compile`, () => {
      const inputs = [{ name: 'x', type: 'float' as const }, { name: 'q', type: 'vec2' as const }];
      const r = snippetForFunction(s, inputs, '');
      const again = snippetForFunction(s, inputs, r.helpers);
      expect(again.helpers).toBe(r.helpers); // added once
      const f = n('customFn', 'f', 400, 0, { inputs: inputs.map(i => ({ ...i, slider: null })), outputType: s.returns, body: `return ${r.call};`, glslFunctions: r.helpers });
      f.inputs = { x: { type: 'float', label: 'x' }, q: { type: 'vec2', label: 'q' } };
      f.outputs = { result: { type: s.returns, label: 'Result' } };
      const res = compileGraph({ nodes: [f, ...out(['f', 'result'], s.returns)] });
      expect(res.errors, JSON.stringify(res.errors)).toBeUndefined();
      parses(res.fragmentShader!);
    });
  }
});

describe('taught moves', () => {
  beforeEach(() => { for (const k of Object.keys(store)) delete store[k]; reloadTaught(); });
  const scope = () => [
    n('uv', 'u', 0, 0), n('circleSDF', 'c', 420, 0, {}, { position: ['u', 'uv'] }),
    n('abs', 'edge', 840, 0, {}, { input: ['c', 'distance'] }),
    n('light', 'neon', 1260, 0, { brightness: 14, tint: [1, 0.2, 0.8] }, { distance: ['edge', 'output'] }),
    n('output', 'o', 1680, 0, {}, { color: ['neon', 'tinted'] }),
  ];

  it('teaches a chain with slots, then the phrase builds it with the slots filled', () => {
    const r = teachFromSelection(scope(), ['edge', 'neon'], 'neon edge {colour} {falloff}');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.move.entry).toMatchObject({ nodeId: 'edge', key: 'input', kind: 'distance' });
    expect(r.move.exit).toMatchObject({ nodeId: 'neon', key: 'tinted' });
    expect(r.move.slots.map(s => [s.name, s.param])).toEqual([['colour', 'tint'], ['falloff', 'brightness']]);

    // Typed later on another shape.
    const g = [n('boxSDF', 'b', 0, 0), n('output', 'o', 900, 0)];
    const m = matchTaught('neon edge pink 6');
    expect(m?.args).toMatchObject({ colour: [1, 0.45, 0.7], falloff: 6 });
    const plan = parseDo('neon edge pink falloff 6', { nodes: g, selected: ['b'] });
    expect(plan.steps).toHaveLength(1);
    let k = 0;
    const res = runDoPlan(g, plan, () => `t${k++}`, { heightOf: H });
    const light = res.nodes.find(nd => nd.type === 'light')!;
    expect(light.params.brightness).toBe(6);
    expect(light.params.tint).toEqual([1, 0.45, 0.7]);
    const abs = res.nodes.find(nd => nd.type === 'abs')!;
    expect(abs.inputs.input.connection?.nodeId).toBe('b');
    expect(String(light.params.__comment)).toMatch(/taught move/);
    expect(compileGraph({ nodes: res.nodes }).errors).toBeUndefined();
  });

  it('ranks in the suggestions for the same kind of value', () => {
    teachFromSelection(scope(), ['edge', 'neon'], 'neon edge {colour}');
    const c = n('circleSDF', 'c', 0, 0);
    const t = learnedTable().table;
    const ranked = rankMoves(c, [c], { table: t, personal: personalTable(), prior: priorTable() }, { limit: 20 });
    expect(ranked.some(r => r.move.id.startsWith('taught:'))).toBe(true);
  });

  it('a chain that makes something new is added on its own', () => {
    const g = [n('uv', 'u', 0, 0), n('fbm', 'f', 400, 0, {}, { uv: ['u', 'uv'] }), n('palette', 'p', 800, 0, {}, { value: ['f', 'value'] }), n('output', 'o', 1200, 0)];
    expect(teachFromSelection(g, ['u', 'f', 'p'], 'cloudy colours').ok).toBe(true);
    const plan = parseDo('cloudy colours', { nodes: [n('output', 'o', 0, 0)], selected: [] });
    expect(plan.steps[0].kind).toBe('chain');
    let k = 0;
    const res = runDoPlan([n('output', 'o', 0, 0)], plan, () => `q${k++}`, { heightOf: H });
    expect(res.nodes.find(nd => nd.type === 'output')!.inputs.color.connection).toBeDefined();
    expect(compileGraph({ nodes: res.nodes }).errors).toBeUndefined();
  });

  it('says when a slot matches no setting, and keeps slots on rename', () => {
    const bad = teachFromSelection(scope(), ['edge', 'neon'], 'neon {wobble}');
    expect(bad.ok).toBe(false);
    const r = teachFromSelection(scope(), ['edge', 'neon'], 'neon {colour}');
    if (!r.ok) throw new Error('teach');
    expect(renameTaught(r.move.id, 'pink tube').ok).toBe(false);
    expect(renameTaught(r.move.id, 'pink tube {colour}').ok).toBe(true);
    expect(taughtMoves()[0].phrase).toBe('pink tube {colour}');
  });

  it('exports, deletes and imports', () => {
    const r = teachFromSelection(scope(), ['edge', 'neon'], 'neon edge');
    if (!r.ok) throw new Error('teach');
    const json = exportTaught();
    deleteTaught(r.move.id);
    expect(taughtMoves()).toHaveLength(0);
    expect(importTaught(json)).toMatchObject({ ok: true, count: 1 });
    reloadTaught();
    expect(JSON.parse(store[TAUGHT_KEY])).toHaveLength(1);
    expect(importTaught('{"kind":"other"}').ok).toBe(false);
  });
});

describe('connection check', () => {
  const kv = (): KV => { const d: Record<string, string> = {}; return { get: k => d[k] ?? null, set: (k, v) => { d[k] = v; }, remove: k => { delete d[k]; }, keys: () => Object.keys(d) }; };
  const tables = () => ({ table: learnedTable().table, personal: personalTable(), prior: priorTable() });

  it('reports a common wire with its counts and what usually follows', () => {
    setLearningStorage(kv());
    for (let i = 0; i < 4; i++) learnGraph(`g${i}`, 'saved', [n('fbm', 'f', 0, 0), n('palette', 'p', 0, 0, {}, { value: ['f', 'value'] })], `s${i}`);
    learnGraph('import:x', 'imported', [n('fbm', 'f', 0, 0), n('palette', 'p', 0, 0, {}, { value: ['f', 'value'] })], 'x');
    const r = checkConnection([{ fromType: 'fbm', outKey: 'value', toType: 'palette', inKey: 'value' }], tables())!;
    expect(r).toMatchObject({ saved: 4, imported: 1, rare: false });
    expect(r.examples).toBeGreaterThan(1);
    expect(r.message).toMatch(/^Seen in 4 of your graphs, 1 imported graph, about [\d.]+ in the examples\./);
    expect(r.message).toMatch(/Usually followed by/);
  });

  it('a rare wire says so and offers the usual alternatives', () => {
    setLearningStorage(kv());
    const r = checkConnection([{ fromType: 'circleSDF', outKey: 'distance', toType: 'hueRotate', inKey: 'angle' }], tables())!;
    expect(r.rare).toBe(true);
    expect(r.message).toMatch(/rare/);
    expect(r.alternatives.length).toBeGreaterThan(0);
    expect(r.alternatives.some(a => /SDF Glow/.test(a))).toBe(true);
  });

  it('a chain you build often offers "Teach this?"', () => {
    setLearningStorage(kv());
    const chain = [n('circleSDF', 'c', 0, 0), n('abs', 'a', 400, 0, {}, { input: ['c', 'distance'] }), n('light', 'l', 800, 0, {}, { distance: ['a', 'output'] })];
    for (let i = 0; i < 3; i++) learnGraph(`c${i}`, 'saved', chain, `s${i}`);
    const r = checkConnection(wiresAmong(chain, ['c', 'a', 'l']), tables())!;
    expect(r.what).toBe('Circle SDF → Abs → SDF Glow');
    expect(r.saved).toBe(3);
    expect(r.teach).toBe(true);
  });
});
