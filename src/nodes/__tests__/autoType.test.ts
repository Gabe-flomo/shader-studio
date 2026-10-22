/**
 * Auto types (nodes/autoType.ts): a per-channel math node takes the widest type wired into its main
 * sockets, the nodes it feeds follow, a picked type locks it, and fixed-size vector nodes (Dot,
 * Length, Normalize) never change by themselves.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); }, key: () => null, length: 0, clear: () => store.clear(),
  });
});

import type { GraphNode } from '../../types/nodeGraph';
import { getActiveNodes, useNodeGraphStore } from '../../store/useNodeGraphStore';
import { compileGraph } from '../../compiler/graphCompiler';
import { suggestConnections } from '../../components/NodeGraph/smartConnect';
import { acceptsByRetype, inputTakes, isAutoTyped, isAutoTypeKind, planRetypes, widest } from '../autoType';

const S = () => useNodeGraphStore.getState();
const level = () => getActiveNodes(S().nodes, S().activeGroupPath) ?? S().nodes;
const byId = (id: string) => level().find(n => n.id === id)!;
const out: GraphNode = { id: 'out', type: 'output', position: { x: 1600, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color' } }, outputs: {}, params: {} };

const add = (type: string, x = 0) => S().addNode(type, { x, y: 0 })!;
const vec3Src = () => add('floatToVec3');
const vec2Src = () => add('uv');
const floatSrc = () => add('time');
const vec4Src = () => add('makeVec4');
const firstOut = (id: string) => Object.keys(byId(id).outputs)[0];
const typeOf = (id: string) => byId(id).params.outputType ?? 'float';

const errorsNow = () => compileGraph({ nodes: S().nodes }).errors ?? [];

beforeEach(() => {
  useNodeGraphStore.setState({ activeGroupId: null, activeGroupPath: [] });
  S().replaceGraph([out]);
});

describe('which nodes are Auto', () => {
  it('per-channel math nodes are; fixed-size vector nodes and Constant are not', () => {
    for (const t of ['add', 'multiply', 'mix', 'sin', 'floor', 'smoothstep', 'clamp', 'pow']) expect(isAutoTypeKind(t)).toBe(true);
    for (const t of ['dot', 'length', 'normalizeVec2', 'constant', 'bounds', 'uv']) expect(isAutoTypeKind(t)).toBe(false);
  });

  it('a picked type locks it', () => {
    expect(isAutoTyped({ type: 'multiply', params: {} })).toBe(true);
    expect(isAutoTyped({ type: 'multiply', params: { typeLocked: true } })).toBe(false);
  });

  it('only its main sockets take any number or vector', () => {
    const n = { type: 'mix', params: {} };
    expect(acceptsByRetype(n, 'a', 'vec3')).toBe(true);
    expect(acceptsByRetype(n, 'b', 'vec4')).toBe(true);
    expect(acceptsByRetype(n, 't', 'vec3')).toBe(false); // the blend amount stays a float
    expect(acceptsByRetype(n, 'a', 'texture')).toBe(false);
    expect(acceptsByRetype({ type: 'dot', params: {} }, 'a', 'vec3')).toBe(false);
  });

  it('the widest type wins', () => {
    expect(widest(['float', 'vec3', 'vec2'])).toBe('vec3');
    expect(widest([])).toBeNull();
  });
});

describe('wiring an Auto node', () => {
  it('a colour times a float is a colour, with no type picked', () => {
    const m = add('multiply', 400);
    const c = vec3Src();
    expect(S().connectNodes(c, firstOut(c), m, 'a')).toBe(true);
    S().connectNodes(floatSrc(), 'time', m, 'b');
    expect(typeOf(m)).toBe('vec3');
    expect(byId(m).inputs.a.type).toBe('vec3');
    expect(byId(m).inputs.b.type).toBe('vec3');
    expect(byId(m).outputs.result.type).toBe('vec3');
    S().connectNodes(m, 'result', 'out', 'color');
    expect(errorsNow()).toEqual([]);
  });

  it('the float can come first: a vec2 into B widens it', () => {
    const m = add('multiply', 400);
    S().connectNodes(floatSrc(), 'time', m, 'a');
    expect(typeOf(m)).toBe('float');
    S().connectNodes(vec2Src(), 'uv', m, 'b');
    expect(typeOf(m)).toBe('vec2');
    expect(byId(m).inputs.a.connection?.outputKey).toBe('time'); // the float stays wired (it spreads)
  });

  it('a vec2 and a vec4 can’t mix: refused, nothing changes', () => {
    const m = add('add', 400);
    S().connectNodes(vec2Src(), 'uv', m, 'a');
    const v4 = vec4Src();
    expect(S().connectNodes(v4, firstOut(v4), m, 'b')).toBe(false);
    expect(typeOf(m)).toBe('vec2');
    expect(byId(m).inputs.b.connection).toBeUndefined();
  });

  it('taking a wire off narrows to the widest left; with nothing left it keeps its type', () => {
    const m = add('multiply', 400);
    const c = vec3Src();
    S().connectNodes(c, firstOut(c), m, 'a');
    S().connectNodes(floatSrc(), 'time', m, 'b');
    S().disconnectInput(m, 'a');
    expect(typeOf(m)).toBe('float');
    S().disconnectInput(m, 'b');
    expect(typeOf(m)).toBe('float');
  });

  it('the nodes it feeds follow', () => {
    const m = add('multiply', 400);
    const s = add('sin', 800);
    S().connectNodes(m, 'result', s, 'input');
    S().connectNodes(s, 'output', 'out', 'color');
    const c = vec3Src();
    S().connectNodes(c, firstOut(c), m, 'a');
    expect(typeOf(m)).toBe('vec3');
    expect(typeOf(s)).toBe('vec3');
    expect(errorsNow()).toEqual([]);
  });

  it('refused when a socket it feeds can’t take the new type', () => {
    const m = add('multiply', 400);
    const s = add('sin', 800);
    S().connectNodes(m, 'result', s, 'freq'); // Freq is always a float
    const v2 = vec2Src();
    expect(S().connectNodes(v2, 'uv', m, 'a')).toBe(false);
    expect(typeOf(m)).toBe('float');
  });

  it('a locked node keeps its type', () => {
    const m = add('multiply', 400);
    S().changeNodeVectorType(m, 'a', 'result', 'vec2', { lock: true });
    const c = vec3Src();
    S().connectNodes(c, firstOut(c), m, 'a'); // vec3 → vec2 truncates, as before
    expect(typeOf(m)).toBe('vec2');
    expect(byId(m).params.typeLocked).toBe(true);
  });

  it('Auto again works the type out from the wires', () => {
    const m = add('multiply', 400);
    S().changeNodeVectorType(m, 'a', 'result', 'vec2', { lock: true });
    const c = vec3Src();
    S().connectNodes(c, firstOut(c), m, 'a');
    S().setNodeTypeAuto(m);
    expect(byId(m).params.typeLocked).toBeUndefined();
    expect(typeOf(m)).toBe('vec3');
  });

  it('picking a type keeps a float wire (it spreads) and the Auto nodes after it follow', () => {
    const m = add('multiply', 400);
    const s = add('sin', 800);
    S().connectNodes(floatSrc(), 'time', m, 'b');
    S().connectNodes(m, 'result', s, 'input');
    S().changeNodeVectorType(m, 'a', 'result', 'vec3', { lock: true });
    expect(byId(m).inputs.b.connection?.outputKey).toBe('time');
    expect(typeOf(s)).toBe('vec3');
  });

  it('Dot keeps the type on its card', () => {
    const d = add('dot', 400);
    const before = typeOf(d);
    const c = vec3Src();
    S().connectNodes(c, firstOut(c), d, 'a');
    expect(typeOf(d)).toBe(before);
  });

  it('compiling never retypes (a saved graph renders as it was)', () => {
    const m = add('add', 400);
    S().changeNodeVectorType(m, 'a', 'result', 'vec3');
    S().connectNodes(vec2Src(), 'uv', m, 'a'); // already vec3 from the pick… then the wire made it vec2
    const now = typeOf(m);
    S().compile();
    expect(typeOf(m)).toBe(now);
  });
});

describe('planRetypes', () => {
  it('reports nothing to change when the types already fit', () => {
    const m = add('multiply', 400);
    const p = planRetypes(level(), undefined, [m]);
    expect(p.ok && p.types.size).toBe(0);
  });
});

describe('the pickers offer Auto sockets', () => {
  it('Smart connect offers a float Multiply’s A to a colour, but not a locked one or Sin’s Freq', () => {
    const c = vec3Src();
    const m = add('multiply', 400);
    const locked = add('multiply', 400);
    S().changeNodeVectorType(locked, 'a', 'result', 'float', { lock: true });
    const s = add('sin', 400);
    level().forEach(n => { if (n.id !== c) n.position.x = 400; else n.position.x = 0; });
    const got = suggestConnections({ nodes: level(), from: { nodeId: c, key: firstOut(c), dir: 'out' }, socketPos: () => null, labelOf: n => n.id });
    const keys = got.map(g => `${g.nodeId}.${g.key}`);
    expect(keys).toContain(`${m}.a`);
    expect(keys).not.toContain(`${locked}.a`);
    expect(keys).not.toContain(`${s}.freq`);
  });

  it('inputTakes: the plain rule, or an Auto main socket', () => {
    expect(inputTakes({ type: 'multiply', params: {} }, 'a', 'float', 'vec3')).toBe(true);
    expect(inputTakes({ type: 'multiply', params: { typeLocked: true } }, 'a', 'float', 'vec3')).toBe(false);
    expect(inputTakes({ type: 'output', params: {} }, 'color', 'vec3', 'float')).toBe(true);
  });
});
