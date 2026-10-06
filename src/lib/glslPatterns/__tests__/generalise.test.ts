import { describe, it, expect } from 'vitest';
import { parser } from '@shaderfrog/glsl-parser';
import {
  buildFunction, evaluate, evaluateFunction, findUses, generaliseText, inferTypes, insertFunction, parseExpr, callInCustomFn,
  toExprPreset, toPublishNode, exprPresetParams, matchesInLine, provenance, descriptionFor, type Value, type GeneraliseContext,
} from '..';
import { nodeToSubgraph, buildUserNodeDefinition } from '../../../nodes/userNodes/publishUserNode';
import type { GraphNode } from '../../../types/nodeGraph';

const T = { uv: 'vec2', p: 'vec2', col: 'vec3', d: 'float', t: 'float', x: 'float', r: 'float' } as const;
const ctx: GeneraliseContext = { types: { ...T } };
const gen = (s: string, c: GeneraliseContext = ctx) => { const g = generaliseText(s, c); if ('error' in g) throw new Error(g.error); return g; };

const ENV: Record<string, Value> = { uv: [0.31, -0.62], p: [0.2, 0.15], col: [0.2, 0.5, 0.9], d: 0.37, t: 1.3, x: 0.42, r: 0.25, q: [1, 2], w: 0.5 };
const close = (a: Value, b: Value) => {
  const fa = Array.isArray(a) ? a : [a], fb = Array.isArray(b) ? b : [b];
  expect(fa.length).toBe(fb.length);
  fa.forEach((v, i) => expect(v).toBeCloseTo(fb[i], 9));
};

/** The function, as GLSL that parses, whose body's type is the declared one. */
function compiles(code: string) {
  expect(() => parser.parse(`${code}\nvoid main() {}`, { quiet: true })).not.toThrow();
  const m = /^(\w+)\s+\w+\(([^)]*)\)\s*\{\s*return ([\s\S]*);\s*\}$/.exec(code)!;
  const env: Record<string, never> = {};
  for (const p of m[2].split(',').map(s => s.trim()).filter(Boolean)) { const [ty, n] = p.split(/\s+/); (env as Record<string, string>)[n] = ty; }
  const r = parseExpr(m[3]);
  expect(r.ok).toBe(true);
  if (r.ok) expect(inferTypes(r.expr, env).get(r.expr.id)).toBe(m[1]);
}

/** Same values as the original on sample inputs. */
function sameValues(src: string, c: GeneraliseContext = ctx) {
  const g = gen(src, c);
  const b = buildFunction(g);
  expect(b.errors).toEqual([]);
  compiles(b.code);
  const orig = parseExpr(src);
  if (!orig.ok) throw new Error(orig.error);
  const args = b.params.map(p => { const r = parseExpr(p.source); if (!r.ok) throw new Error(r.error); return evaluate(r.expr, ENV); });
  close(evaluateFunction(b.code, args), evaluate(orig.expr, ENV));
  return { g, b };
}

describe('generalising an idiom', () => {
  it('soft circle: named inputs, literal defaults as sliders, types inferred', () => {
    const { g, b } = sameValues('smoothstep(0.3, 0.35, length(uv))');
    expect(g.idiom?.id).toBe('soft-circle');
    expect(g.inputs.map(i => [i.name, i.type, i.kind, i.default])).toEqual([
      ['radius', 'float', 'literal', 0.3], ['width', 'float', 'literal', 0.05], ['p', 'vec2', 'hole', undefined],
    ]);
    expect(b.code).toBe('float softCircle(float radius, float width, vec2 p) {\n    return smoothstep(radius, radius + width, length(p));\n}');
    expect(b.call).toBe('softCircle(0.3, 0.05, uv)');
    expect(b.pattern).toBe('smoothstep($radius, $radius + $width, length($p))');
    expect(g.description).toBe('Makes a soft-edged circle of radius radius around the origin of p: 0 inside, rising to 1 over width outside it.');
  });
  it('keeps the idiom’s own numbers, and vector constants start constant', () => {
    const { g, b } = sameValues('vec3(0.5) + vec3(0.5) * cos(6.28318 * (vec3(1.0) * t + vec3(0.0, 0.33, 0.67)))');
    expect(g.inputs.filter(i => !i.constant).map(i => i.name)).toEqual(['t']);
    expect(b.code).toMatch(/^vec3 cosPalette\(float t\)/);
    // Turning a constant into an input
    const idx = g.inputs.findIndex(i => i.name === 'phase');
    const b2 = buildFunction(g, { constant: { [idx]: false } });
    expect(b2.code).toMatch(/^vec3 cosPalette\(float t, vec3 phase\)/);
    compiles(b2.code);
  });
  it('remap and rotation keep their identity constants', () => {
    expect(sameValues('sin(t) * 0.5 + 0.5').b.code).toBe('float to01(float x) {\n    return x * 0.5 + 0.5;\n}');
    expect(sameValues('mat2(cos(t), -sin(t), sin(t), cos(t)) * uv').b.params.map(p => `${p.type} ${p.name}`)).toEqual(['float angle', 'vec2 p']);
  });
  it.each([
    'uv * 2.0 - 1.0', 'fract(uv * 8.0)', 'exp(-4.0 * d)', 'length(p) - 0.25', 'abs(fract(x) - 0.5)', 'pow(col, vec3(1.0 / 2.2))',
    'x * x * (3.0 - 2.0 * x)', 'fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453)', 'clamp(x, 0.0, 1.0)', 'atan(p.y, p.x)',
    'dot(col, vec3(0.299, 0.587, 0.114))', '1.0 / (1.0 + 20.0 * d)', 'floor(uv * 10.0)',
  ])('%s gives the same values as a function', src => { sameValues(src); });
});

describe('generalising as written', () => {
  it('the user’s example: free names and literals become inputs', () => {
    const { g, b } = sameValues('fract(sin(uv*3.0)*2.0)');
    expect(g.idiom).toBeUndefined();
    expect(g.inputs.map(i => [i.name, i.type, i.kind])).toEqual([['uv', 'vec2', 'free'], ['zoom', 'float', 'literal'], ['scale', 'float', 'literal']]);
    expect(b.code).toBe('vec2 ramps(vec2 uv, float zoom, float scale) {\n    return fract(sin(uv * zoom) * scale);\n}');
    expect(b.call).toBe('ramps(uv, 3.0, 2.0)');
  });
  it('literals named by where they sit; 0, 1 and constant vectors start constant', () => {
    const g = gen('mix(col, vec3(1.0, 0.5, 0.2), smoothstep(0.0, 0.4, d))', { ...ctx, plain: true });
    const byName = Object.fromEntries(g.inputs.map(i => [i.name, i]));
    expect(byName.edge1?.default).toBe(0.4);
    expect(byName.edge1?.constant).toBe(false);
    expect(byName.edge0?.constant).toBe(true);
    expect(byName.green?.constant).toBe(true);
    sameValues('mix(col, vec3(1.0, 0.5, 0.2), smoothstep(0.0, 0.4, d))', { ...ctx, plain: true });
  });
  it('as written on an idiom when asked', () => {
    const g = gen('smoothstep(0.3, 0.35, length(uv))', { ...ctx, plain: true });
    expect(g.idiom).toBeUndefined();
    expect(g.inputs.map(i => i.name)).toEqual(['uv', 'edge0', 'edge1']);
  });
  it('guesses types of undeclared names from use and name, and says so', () => {
    const g = gen('q.y * 2.0 + w', {});
    expect(g.inputs.find(i => i.name === 'q')).toMatchObject({ type: 'vec2', typeGuessed: true });
    expect(g.inputs.find(i => i.name === 'w')).toMatchObject({ type: 'float', typeGuessed: true });
    sameValues('q.y * 2.0 + w', {});
  });
  it('keeps globals (u_time, and t in an Expression Block) as they are', () => {
    const g = gen('sin(u_time * 2.0 + t)', { types: {}, globals: ['t'] });
    expect(g.inputs.map(i => i.name)).toEqual(['speed']);
  });
  it('renames, constants and bad names', () => {
    const g = gen('fract(sin(uv*3.0)*2.0)');
    const b = buildFunction(g, { names: { 0: 'pos', 1: 'freq' }, constant: { 2: true }, fnName: 'bands' });
    expect(b.code).toBe('vec2 bands(vec2 pos, float freq) {\n    return fract(sin(pos * freq) * 2.0);\n}');
    expect(b.call).toBe('bands(uv, 3.0)');
    expect(buildFunction(g, { names: { 1: 'uv' } }).errors).toContain('Two inputs are called “uv”.');
    expect(buildFunction(g, { names: { 1: 'sin' } }).errors[0]).toMatch(/GLSL word/);
    expect(buildFunction(g, { fnName: '2x' }).errors[0]).toMatch(/valid function name/);
    expect(descriptionFor(g)).toBe(g.description);
  });
});

describe('save flows', () => {
  it('an Expression Block preset: inputs, sliders with defaults, body as Return', () => {
    const g = gen('smoothstep(0.3, 0.35, length(uv))');
    const b = buildFunction(g);
    const p = toExprPreset(g, b, 'Soft circle');
    expect(p).toMatchObject({
      label: 'Soft circle', outputType: 'float', lines: [], result: 'smoothstep(radius, radius + width, length(p))',
      inputs: [{ name: 'radius', type: 'float', slider: { min: 0, max: 1 } }, { name: 'width', type: 'float', slider: { min: 0, max: 1 } }, { name: 'p', type: 'vec2', slider: null }],
      values: { radius: 0.3, width: 0.05 }, pattern: b.pattern,
    });
    expect(p.comment).toBe(g.description);
    // Placing it gives the slider values as params
    expect(exprPresetParams(p)).toMatchObject({ radius: 0.3, width: 0.05, __comment: g.description });
  });
  it('a user node through the publish flow: a one-node subgraph that flattens to a working definition', () => {
    const g = gen('smoothstep(0.3, 0.35, length(uv))');
    const b = buildFunction(g);
    const node = toPublishNode(g, b, 'Soft circle');
    const sub = nodeToSubgraph(node);
    expect(sub.inputPorts.map(p => [p.key, p.type])).toEqual([['radius', 'float'], ['width', 'float'], ['p', 'vec2']]);
    const res = buildUserNodeDefinition({ kind: 'node', node }, {
      label: 'Soft circle', category: 'My Nodes', description: g.description, params: [],
      inputs: sub.inputPorts.map(p => ({ portKey: p.key, key: p.key, label: p.key, type: p.type, slider: p.type === 'float' ? { min: 0, max: 1, default: b.params.find(x => x.name === p.key)?.default ?? 0 } : null })),
      outputs: sub.outputPorts.map(p => ({ portKey: p.key, key: p.key, label: p.label, type: p.type })),
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.def.description).toBe(g.description);
      expect(res.def.inputs.find(i => i.key === 'radius')?.slider?.default).toBe(0.3);
      expect(res.def.functionCode).toMatch(/smoothstep\(radius, radius \+ width, length\(p\)\)/);
    }
  });
  it('use it here: GLSL text gets the function above, the span becomes the call', () => {
    const code = 'void main() {\n    vec2 uv = vUv;\n    float m = smoothstep(0.3, 0.35, length(uv));\n    gl_FragColor = vec4(m);\n}';
    const s = code.indexOf('smoothstep'), e = code.indexOf(';', s);
    const g = generaliseText(code, { types: { uv: 'vec2' } }, { start: s, end: e });
    if ('error' in g) throw new Error(g.error);
    const b = buildFunction(g);
    const out = insertFunction(code, b.code, { start: s, end: e }, b.call);
    expect(out.code).toBe(`${b.code}\n\nvoid main() {\n    vec2 uv = vUv;\n    float m = softCircle(0.3, 0.05, uv);\n    gl_FragColor = vec4(m);\n}`);
    expect(out.code.slice(out.callStart, out.callEnd)).toBe(b.call);
    expect(() => parser.parse(`precision mediump float; varying vec2 vUv;\n${out.code}`, { quiet: true })).not.toThrow();
  });
  it('use it here: a Custom Function gains a helper and a call, once', () => {
    const body = 'float l = length(p);\nreturn fract(l * 4.0);';
    const s = body.indexOf('fract'), e = body.lastIndexOf(';');
    const g = generaliseText(body, { types: { p: 'vec2', l: 'float' } }, { start: s, end: e });
    if ('error' in g) throw new Error(g.error);
    const b = buildFunction(g);
    const r = callInCustomFn(body, '', b.code, { start: s, end: e }, b.call);
    expect(r.body).toBe(`float l = length(p);\nreturn ${b.call};`);
    expect(r.helpers).toBe(`${b.code}\n`);
    expect(callInCustomFn(r.body, r.helpers, b.code, { start: 0, end: 0 }, '').helpers).toBe(r.helpers);
  });
});

describe('find uses', () => {
  const block = (id: string, lines: Array<{ lhs: string; op: string; rhs: string }>, result: string, inputs = [{ name: 'uv', type: 'vec2' }]): GraphNode =>
    ({ id, type: 'exprNode', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: { label: `Block ${id}`, inputs, lines, result, outputType: 'float' } } as unknown as GraphNode);
  const graph: GraphNode[] = [
    block('a', [{ lhs: 'float d', op: '=', rhs: 'length(uv - 0.5)' }], 'smoothstep(0.2, 0.25, d)'),
    block('b', [], 'smoothstep(0.1, 0.3, length(uv))'),
    { id: 'g', type: 'group', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: { label: 'Group', subgraph: { nodes: [
      { id: 'f', type: 'customFn', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: { label: 'Fn', inputs: [{ name: 'p', type: 'vec2' }], body: 'float c = smoothstep(0.5, 0.6, length(p));\nreturn c;' } },
    ], inputPorts: [], outputPorts: [] } } } as unknown as GraphNode,
  ];
  it('finds an idiom by id, with provenance, inside groups too', () => {
    const hits = findUses({ idiomId: 'soft-circle' }, [{ graph: 'This graph', nodes: graph }]);
    expect(hits.map(provenance)).toEqual([
      'This graph → Block b → Return',
      'This graph → Group → Fn → Statement 1 (line 1)',
    ]);
    expect(hits[0].match).toBe('smoothstep(0.1, 0.3, length(uv))');
  });
  it('finds a made function’s shape, with any inputs', () => {
    const g = gen('smoothstep(0.3, 0.35, length(uv))', { ...ctx, plain: true });
    const b = buildFunction(g);
    expect(matchesInLine('return smoothstep(0.1, 0.3, length(uv))', { pattern: b.pattern })).toHaveLength(1);
    const hits = findUses({ pattern: b.pattern }, [{ graph: 'Example', exampleKey: 'ex', nodes: graph }]);
    expect(hits.map(h => h.nodeId)).toEqual(['b', 'f']);
    expect(hits[0].exampleKey).toBe('ex');
  });
});
