/**
 * Simple Expression (nodes/definitions/simpleExpr.ts, compiler/simpleExprSync.ts, docs/simple-expression.md):
 * inputs take the type of the wire into them (and follow a rewire), an unwired input is float 0.0, the
 * Output type casts by the graph's wire rule or refuses with a fix, the emitted GLSL parses and runs on the
 * CPU (glslEval.ts) to the right values, input names are GLSL names, save → load keeps it, and it converts
 * to an Expression Block and back.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import { parser } from '@shaderfrog/glsl-parser';
import { compileGraph } from '../graphCompiler';
import { syncSimpleExprTypes } from '../simpleExprSync';
import { getNodeDefinition } from '../../nodes/definitions';
import {
  addSimpleExprVar, blockSimplifyProblem, blockToSimpleExpr, checkSimpleExpr, checkSimpleExprNode, moveSimpleExprVar, nextSimpleExprName,
  removeSimpleExprVar, renameSimpleExprVar, setSimpleExprOutput, simpleExprNameProblem, simpleExprToBlock, simpleExprVars,
} from '../../nodes/definitions/simpleExpr';
import { n } from '../../store/graphBuilder';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { BUILTINS, runGlsl, type Val } from './glslEval';
import type { GraphNode } from '../../types/nodeGraph';

const parses = (fs: string) => { try { parser.parse(fs.replace(/^#version.*$/m, ''), { quiet: true }); return null; } catch (e) { return (e as Error).message.split('\n')[0]; } };
const smoothstep = (a: Val, b: Val, x: Val) => {
  const f = (v: number) => { const t = Math.min(Math.max((v - (a as number)) / ((b as number) - (a as number)), 0), 1); return t * t * (3 - 2 * t); };
  return Array.isArray(x) ? x.map(f) : f(x as number);
};

/** A Simple Expression `S` with inputs a, b, c (keys in1–in3) wired per `wires`. */
function simple(expr: string, outputType = 'float', wires: Record<string, [string, string]> = {}, names = ['a', 'b', 'c']): GraphNode {
  const vars = names.map((name, i) => ({ key: `in${i + 1}`, name }));
  return n('simpleExpr', 'S', 400, 0, { vars, expr, outputType }, wires);
}
const typesOf = (node: GraphNode) => Object.fromEntries(simpleExprVars(node).map(v => [v.name, node.inputs[v.key].type]));
const find = (nodes: GraphNode[], id: string) => nodes.find(x => x.id === id)!;

describe('types follow the wires', () => {
  const sources = [n('uv', 'U', 0, 0), n('time', 'T', 0, 100), n('colorPicker', 'C', 0, 200), n('matConst', 'M', 0, 300), n('pass', 'P', 0, 400)];

  it('each wired input takes its wire\'s type; an unwired one is a float', () => {
    const s = simple('a.x + b + c.y', 'float', { in1: ['U', 'uv'], in2: ['T', 'time'] }, ['a', 'b', 'c']);
    const synced = find(syncSimpleExprTypes([...sources, s]), 'S');
    expect(typesOf(synced)).toEqual({ a: 'vec2', b: 'float', c: 'float' });
  });

  it('rewiring retypes at once; unwiring goes back to float', () => {
    let nodes = syncSimpleExprTypes([...sources, simple('a', 'float', { in1: ['U', 'uv'] })]);
    expect(typesOf(find(nodes, 'S')).a).toBe('vec2');
    nodes = nodes.map(x => (x.id === 'S' ? { ...x, inputs: { ...x.inputs, in1: { ...x.inputs.in1, connection: { nodeId: 'C', outputKey: 'rgb' } } } } : x));
    nodes = syncSimpleExprTypes(nodes);
    expect(typesOf(find(nodes, 'S')).a).toBe('vec3');
    nodes = nodes.map(x => (x.id === 'S' ? { ...x, inputs: { ...x.inputs, in1: { ...x.inputs.in1, connection: { nodeId: 'M', outputKey: 'mat' } } } } : x));
    expect(typesOf(find(syncSimpleExprTypes(nodes), 'S')).a).toBe('mat3');
    nodes = nodes.map(x => (x.id === 'S' ? { ...x, inputs: { ...x.inputs, in1: { ...x.inputs.in1, connection: undefined } } } : x));
    expect(typesOf(find(syncSimpleExprTypes(nodes), 'S')).a).toBe('float');
  });

  it('the store retypes on connect and disconnect (it syncs before each compile)', () => {
    const st = useNodeGraphStore.getState();
    st.replaceGraph([...sources, simple('a', 'vec3'), n('output', 'O', 800, 0, {}, { color: ['S', 'result'] })]);
    useNodeGraphStore.getState().connectNodes('C', 'rgb', 'S', 'in1');
    expect(typesOf(find(useNodeGraphStore.getState().nodes, 'S')).a).toBe('vec3');
    useNodeGraphStore.getState().connectNodes('U', 'uv', 'S', 'in1');
    expect(typesOf(find(useNodeGraphStore.getState().nodes, 'S')).a).toBe('vec2');
    useNodeGraphStore.getState().disconnectInput('S', 'in1');
    expect(typesOf(find(useNodeGraphStore.getState().nodes, 'S')).a).toBe('float');
  });

  it('a chain settles: one Simple Expression\'s Output type is the next one\'s input type', () => {
    const first = { ...simple('a', 'vec3', { in1: ['C', 'rgb'] }), id: 'S1' };
    const second = { ...simple('a * 2.0', 'vec3', { in1: ['S1', 'result'] }), id: 'S2' };
    const nodes = syncSimpleExprTypes([...sources, first, second]);
    expect(typesOf(find(nodes, 'S2')).a).toBe('vec3');
  });

  it('a texture is refused with a clear message, and gives zero', () => {
    const nodes = syncSimpleExprTypes([...sources, simple('a', 'vec3', { in1: ['P', 'texture'] })]);
    const s = find(nodes, 'S');
    expect(s.inputs.in1.type).toBe('texture');
    const c = checkSimpleExprNode(s);
    expect(c.ok).toBe(false);
    expect(!c.ok && c.error).toMatch(/texture.*Sample Texture/);
    const { code } = getNodeDefinition('simpleExpr')!.generateGLSL(s, { in1: 'u_tex' });
    expect(code).toContain('vec3 S_result = vec3(0.0);');
  });
});

describe('the GLSL', () => {
  const run = (node: GraphNode, inputVars: Record<string, string>, env: Record<string, Val> = {}) => {
    const { code, outputVars } = getNodeDefinition('simpleExpr')!.generateGLSL(node, inputVars);
    const out = runGlsl(code, { ...BUILTINS, smoothstep, u_time: 2, g_uv: [0.25, -0.5], ...env });
    return { code, value: out[outputVars.result] as Val };
  };

  it('declares each input as its type, unwired ones as float 0.0, and evaluates mix(a, b, smoothstep(0.2, 0.8, c))', () => {
    const s = find(syncSimpleExprTypes([n('colorPicker', 'C', 0, 0), n('colorPicker', 'D', 0, 0), n('time', 'T', 0, 0), simple('mix(a, b, smoothstep(0.2, 0.8, c))', 'vec3', { in1: ['C', 'rgb'], in2: ['D', 'rgb'], in3: ['T', 'time'] })]), 'S');
    const { code, value } = run(s, { in1: 'vec3(1.0, 0.0, 0.0)', in2: 'vec3(0.0, 0.0, 1.0)', in3: '0.5' });
    expect(code).toContain('vec3 a = vec3(1.0, 0.0, 0.0);');
    expect(code).toContain('float c = 0.5;');
    (value as number[]).forEach((x, i) => expect(x).toBeCloseTo([0.5, 0, 0.5][i], 9));
    const unwired = run(simple('a + 1.0'), {});
    expect(unwired.code).toContain('float a = 0.0;');
    expect(unwired.value).toBe(1);
  });

  it('t, uv and the other free names are declared only when used, and an input of the same name wins', () => {
    const r = run(simple('t * 0.5 + uv.x', 'float', {}, []), {});
    expect(r.code).toContain('float t = u_time;');
    expect(r.code).toContain('vec2 uv = g_uv;');
    expect(r.code).not.toContain('u_resolution');
    expect(r.code).not.toContain('u_mouse');
    expect(r.value).toBeCloseTo(1.25, 9);
    const own = run(simple('t', 'float', {}, ['t']), { in1: '7.0' });
    expect(own.code).not.toContain('u_time');
    expect(own.value).toBe(7);
  });

  it('casts by the wire rule: a float fills a vector, vec3 → vec2 keeps .xy', () => {
    const r = run(simple('a * 2.0', 'vec3'), { in1: '0.25' });
    expect(r.value).toEqual([0.5, 0.5, 0.5]);
    const c = checkSimpleExpr('a', [{ name: 'a', type: 'vec3' }], 'vec2');
    expect(c.ok && c.glsl).toBe('((a)).xy');
    expect(c.ok && c.note).toMatch(/keeps \.xy/);
  });

  it('refuses a type that can\'t become the Output type, with a fix, and gives zero so the graph still draws', () => {
    const c = checkSimpleExpr('a * 2.0', [{ name: 'a', type: 'vec3' }], 'float');
    expect(c.ok).toBe(false);
    expect(!c.ok && c.error).toMatch(/makes .*Output type is .*Output to vec3/);
    const s = find(syncSimpleExprTypes([n('colorPicker', 'C', 0, 0), simple('a * 2.0', 'float', { in1: ['C', 'rgb'] }), n('output', 'O', 800, 0, {}, { color: ['S', 'result'] })]), 'S');
    expect(run(s, { in1: 'vec3(1.0)' }).code).toContain('float S_result = 0.0;');
  });

  it('catches what it can before the GPU: unknown names, assignments, brackets, several statements', () => {
    const vars = [{ name: 'a', type: 'float' }];
    expect(checkSimpleExpr('a * k', vars, 'float')).toMatchObject({ ok: false, error: expect.stringMatching(/“k” isn't an input/) });
    expect(checkSimpleExpr('a = 1.0', vars, 'float').ok).toBe(false);
    expect(checkSimpleExpr('a += 1.0', vars, 'float').ok).toBe(false);
    expect(checkSimpleExpr('sin(a', vars, 'float').ok).toBe(false);
    expect(checkSimpleExpr('a; a', vars, 'float').ok).toBe(false);
    expect(checkSimpleExpr('', vars, 'float').ok).toBe(false);
    expect(checkSimpleExpr('a +', vars, 'float').ok).toBe(false);
    expect(checkSimpleExpr('a.q', [{ name: 'a', type: 'vec2' }], 'float').ok).toBe(false);
    // Comparisons, ?:, PI and u_ uniforms are fine
    expect(checkSimpleExpr('a > 0.5 ? a : PI * u_time', vars, 'float').ok).toBe(true);
    // A matrix is left to the GPU to type
    expect(checkSimpleExpr('m * vec3(uv, 1.0)', [{ name: 'm', type: 'mat3' }], 'vec3')).toMatchObject({ ok: true, type: null });
  });

  it('a whole graph compiles, and its shader parses', () => {
    const nodes = [
      n('uv', 'U', 0, 0), n('colorPicker', 'C', 0, 100), n('matConst', 'M', 0, 200),
      simple('mix(c, vec3(a, 0.5), fract(t))', 'vec3', { in1: ['U', 'uv'], in2: ['M', 'mat'], in3: ['C', 'rgb'] }, ['a', 'm', 'c']),
      n('output', 'O', 800, 0, {}, { color: ['S', 'result'] }),
    ];
    const r = compileGraph({ nodes });
    expect(r.errors).toBeUndefined();
    expect(r.success).toBe(true);
    expect(parses(r.fragmentShader)).toBeNull();
    expect(r.fragmentShader).toMatch(/vec2 a = /);
    expect(r.fragmentShader).toMatch(/mat3 m = /);
    expect(r.fragmentShader).toMatch(/vec3 c = /);
  });
});

describe('names and card edits', () => {
  it('input names must be GLSL names, not GLSL words, and not taken', () => {
    expect(simpleExprNameProblem('speed')).toBeNull();
    expect(simpleExprNameProblem('_x2')).toBeNull();
    expect(simpleExprNameProblem('2x')).toMatch(/isn't a GLSL name/);
    expect(simpleExprNameProblem('my value')).toMatch(/isn't a GLSL name/);
    expect(simpleExprNameProblem('a__b')).toMatch(/underscores/);
    expect(simpleExprNameProblem('gl_x')).toMatch(/belong to the shader/);
    expect(simpleExprNameProblem('u_time')).toMatch(/belong to the shader/);
    for (const w of ['float', 'vec3', 'if', 'return', 'sin', 'mix', 'PI']) expect(simpleExprNameProblem(w), w).toMatch(/GLSL word/);
    expect(simpleExprNameProblem('a', ['a'])).toMatch(/already/);
    expect(nextSimpleExprName(['a', 'b'])).toBe('c');
    expect(nextSimpleExprName('abcdefghijklmnopqrs'.split(''))).toBe('u'); // t is time
  });

  it('+ Input, rename (the wire and the expression follow), move, remove, Output type', () => {
    let s = simple('a * 2.0', 'float', { in1: ['T', 'time'] }, ['a']);
    s = addSimpleExprVar(s);
    expect(simpleExprVars(s).map(v => v.name)).toEqual(['a', 'b']);
    expect(s.inputs.in2).toMatchObject({ type: 'float', label: 'b' });
    const r = renameSimpleExprVar(s, 'in1', 'speed');
    expect('node' in r).toBe(true);
    if (!('node' in r)) return;
    s = r.node;
    expect(s.params.expr).toBe('speed * 2.0');
    expect(s.inputs.in1.connection).toEqual({ nodeId: 'T', outputKey: 'time' });
    expect(s.inputs.in1.label).toBe('speed');
    expect(renameSimpleExprVar(s, 'in2', 'speed')).toEqual({ error: expect.stringMatching(/already/) });
    expect(renameSimpleExprVar(s, 'in2', 'vec3')).toEqual({ error: expect.stringMatching(/GLSL word/) });
    s = moveSimpleExprVar(s, 'in2', -1);
    expect(simpleExprVars(s).map(v => v.name)).toEqual(['b', 'speed']);
    s = removeSimpleExprVar(s, 'in1');
    expect(Object.keys(s.inputs)).toEqual(['in2']);
    expect(checkSimpleExprNode(s)).toMatchObject({ ok: false, error: expect.stringMatching(/“speed” isn't an input/) });
    s = setSimpleExprOutput(s, 'vec4');
    expect(s.outputs.result.type).toBe('vec4');
  });
});

describe('the store', () => {
  beforeEach(() => useNodeGraphStore.getState().clearToMinimal());

  it('a new one from the node list has one input a, returns it, and compiles', () => {
    const id = useNodeGraphStore.getState().addNode('simpleExpr', { x: 0, y: 0 })!;
    const node = find(useNodeGraphStore.getState().nodes, id);
    expect(simpleExprVars(node)).toEqual([{ key: 'in1', name: 'a' }]);
    expect(node.inputs.in1).toMatchObject({ type: 'float', label: 'a' });
    expect(node.outputs.result.type).toBe('float');
    expect(checkSimpleExprNode(node).ok).toBe(true);
  });

  it('save → load keeps it, and compiles to the same shader', () => {
    useNodeGraphStore.getState().replaceGraph([
      n('uv', 'U', 0, 0), n('colorPicker', 'C', 0, 100),
      simple('c * (0.5 + 0.5 * sin(a.x * 10.0 + t))', 'vec3', { in1: ['U', 'uv'], in3: ['C', 'rgb'] }, ['a', 'b', 'c']),
      n('output', 'O', 800, 0, {}, { color: ['S', 'result'] }),
    ]);
    const before = compileGraph({ nodes: useNodeGraphStore.getState().nodes });
    expect(before.success).toBe(true);
    const saved = find(useNodeGraphStore.getState().nodes, 'S');
    const json = useNodeGraphStore.getState().graphFileJson(false);
    expect(useNodeGraphStore.getState().importGraph(json).ok).toBe(true);
    const loaded = find(useNodeGraphStore.getState().nodes, 'S');
    expect(loaded.params.vars).toEqual(saved.params.vars);
    expect(loaded.params.expr).toBe(saved.params.expr);
    expect(typesOf(loaded)).toEqual({ a: 'vec2', b: 'float', c: 'vec3' });
    expect(compileGraph({ nodes: useNodeGraphStore.getState().nodes }).fragmentShader).toBe(before.fragmentShader);
  });

  it('converts to an Expression Block in place (wires kept, same picture), and back', () => {
    useNodeGraphStore.getState().replaceGraph([
      n('uv', 'U', 0, 0), n('colorPicker', 'C', 0, 100),
      simple('mix(c, vec3(uv, 0.0), 0.5) * a.x', 'vec3', { in1: ['U', 'uv'], in2: ['C', 'rgb'] }, ['a', 'c']),
      n('output', 'O', 800, 0, {}, { color: ['S', 'result'] }),
    ]);
    const st = () => useNodeGraphStore.getState();
    const before = compileGraph({ nodes: st().nodes });
    expect(before.success).toBe(true);
    st().replaceNodeInScope('S', simpleExprToBlock, 'convert');
    const block = find(st().nodes, 'S');
    expect(block.type).toBe('exprNode');
    expect(block.params.result).toBe('mix(c, vec3(g_uv, 0.0), 0.5) * a.x');
    expect(block.params.inputs).toEqual([{ name: 'a', type: 'vec2', slider: null }, { name: 'c', type: 'vec3', slider: null }]);
    expect(block.inputs.a.connection).toEqual({ nodeId: 'U', outputKey: 'uv' });
    expect(block.inputs.c.connection).toEqual({ nodeId: 'C', outputKey: 'rgb' });
    expect(find(st().nodes, 'O').inputs.color.connection).toEqual({ nodeId: 'S', outputKey: 'result' });
    const asBlock = compileGraph({ nodes: st().nodes });
    expect(asBlock.success).toBe(true);
    expect(parses(asBlock.fragmentShader)).toBeNull();
    // A block that is only a result line simplifies back; one with lines doesn't.
    expect(blockSimplifyProblem(block)).toBeNull();
    st().replaceNodeInScope('S', x => blockToSimpleExpr(x) ?? x, 'simplify');
    const back = find(st().nodes, 'S');
    expect(back.type).toBe('simpleExpr');
    expect(back.params.expr).toBe('mix(c, vec3(g_uv, 0.0), 0.5) * a.x');
    expect(typesOf(back)).toEqual({ a: 'vec2', c: 'vec3' });
    expect(compileGraph({ nodes: st().nodes }).success).toBe(true);
    expect(blockSimplifyProblem({ ...block, params: { ...block.params, lines: [{ lhs: 'a', op: '*=', rhs: '2.0' }] } })).toMatch(/lines/);
    expect(blockSimplifyProblem({ ...block, params: { ...block.params, result: 'p * a.x' } })).toMatch(/“p”/);
    // Undo brings the block back
    st().undo();
    expect(find(st().nodes, 'S').type).toBe('exprNode');
  });
});

describe('the example', () => {
  it('Simple Expression · rings and a blend compiles, every node has a note, and Blend reads three types', async () => {
    const { EXAMPLE_GRAPHS } = await import('../../store/exampleGraphs');
    const g = EXAMPLE_GRAPHS.simpleExprBlend;
    const r = compileGraph({ nodes: g.nodes });
    expect(r.errors).toBeUndefined();
    expect(parses(r.fragmentShader)).toBeNull();
    for (const node of g.nodes) if (node.type !== 'output') expect(typeof node.params.__comment, node.id).toBe('string');
    const blend = find(syncSimpleExprTypes(g.nodes), 'se_blend');
    expect(typesOf(blend)).toEqual({ a: 'vec3', b: 'vec3', c: 'float', p: 'vec2' });
    expect(checkSimpleExprNode(blend)).toMatchObject({ ok: true, type: 'vec3' });
  });
});
