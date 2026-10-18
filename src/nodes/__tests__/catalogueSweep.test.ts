/**
 * The 2026-10-17 catalogue sweep (docs/node-retirements.md, "The catalogue sweep"): the node library after the
 * effects sweep — old transforms, duplicate shapes and helpers retired, shapers and Chladni merged, search
 * aliases, categories and labels. Like effectSweep.test.ts: a retired type still loads (merged ones migrate with
 * the same maths, run on the CPU with glslEval.ts; hidden ones stay registered) and no example uses one.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, key: () => null, length: 0, clear: () => mem.clear() };
});

import { readFileSync } from 'fs';
import type { GraphNode, NodeDefinition } from '../../types/nodeGraph';
import {
  ExpEaseNode, DoubleExpSeatNode, DoubleExpSigmoidNode, LogisticSigmoidNode, CircularEaseInNode, CircularEaseOutNode,
  DoubleCircleSeatNode, DoubleCircleSigmoidNode, DoubleEllipticSigmoidNode, QuadBezierShaperNode,
} from '../definitions/shapers';
import { ChladniNode, ChladniSuperpositionNode, WaveTermNode } from '../definitions/physics';
import { emptyPlayRecord, type PlayRecord } from '../../types/play';
import { getNodeDefinition, getOfferedDefinitions, NODE_REGISTRY } from '../definitions';
import { NODE_ALIASES } from '../definitions/aliases';
import { RETIRED_TYPES } from '../notOffered';
import { CATEGORY_GROUPS, HIDDEN_NODES, libraryLayout, nodesOfRow, rowOfType } from '../../components/NodeGraph/libraryRows';
import { migrateNodeParams } from '../../types/nodeGraph';
import { resolveNodeAliases } from '../definitions/aliases';
import { runGlsl, type Val } from '../../compiler/__tests__/glslEval';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { migrateLoadedNodes, migrateLoadedPlay, useNodeGraphStore } from '../../store/useNodeGraphStore';
import { compileGraph } from '../../compiler/graphCompiler';
import { gpBindings } from '../../play/kit/gpuParticles.js';

/** Every node type an example uses, at any depth. */
function typesOf(nodes: GraphNode[], out: string[] = []): string[] {
  for (const nd of nodes) {
    out.push(nd.type);
    const sg = nd.params?.subgraph as { nodes?: GraphNode[] } | undefined;
    if (sg?.nodes) typesOf(sg.nodes, out);
  }
  return out;
}

/** A saved node as an old graph holds it. */
export function saved(type: string, id: string, params: Record<string, unknown>, inputs: Record<string, [string, string] | null>, outputs: string[]): GraphNode {
  const def = getNodeDefinition(type);
  return {
    id, type, position: { x: 0, y: 0 }, params,
    inputs: Object.fromEntries(Object.entries(inputs).map(([k, w]) => [k, { type: def?.inputs[k]?.type ?? 'float', label: k, ...(w ? { connection: { nodeId: w[0], outputKey: w[1] } } : {}) }])),
    outputs: Object.fromEntries(outputs.map(k => [k, { type: def?.outputs[k]?.type ?? 'float', label: k }])),
  } as GraphNode;
}

/** Load as the store does: aliases, then each node's param migration. */
const load = (nodes: GraphNode[]) => resolveNodeAliases(nodes, getNodeDefinition).map(nd => migrateNodeParams(nd, getNodeDefinition));

describe('T6: examples use current node types', () => {
  it('no example uses an old (aliased) type name or the retired Audio Input', () => {
    for (const [k, g] of Object.entries(EXAMPLE_GRAPHS)) {
      const old = typesOf(g.nodes).filter(t => NODE_ALIASES[t] || t === 'audioInput');
      expect(old, k).toEqual([]);
    }
  });

  it('the Chladni sand examples hear an Audio Source\'s six bands', () => {
    for (const key of ['particleChladniSand', 'particleCymatics3d']) {
      const r = compileGraph({ nodes: migrateLoadedNodes(EXAMPLE_GRAPHS[key].nodes) });
      expect(r.errors ?? [], key).toEqual([]);
      const [b] = gpBindings(r.fragmentShader!);
      expect(b.audio, key).toMatch(/^u_aud_\w+_level$/);
      expect(b.audioBands, key).toHaveLength(6);
      expect(b.audioBands[0], key).toMatch(/_b1_v$/);
    }
  });

  it('an Audio Input still wins over an Audio Source (old graphs hear what they heard)', () => {
    const fs = ['uniform float u_aud_src_level;', 'uniform float u_aud_src_time;', 'uniform float u_audio_old_0;', 'uniform sampler2D u_gpup_p; // gpu-particles {"p":{}}'].join('\n');
    expect(gpBindings(fs)[0].audio).toBe('u_audio_old_0');
  });

  it('a Band level alone is not taken for a source (it has no Time)', () => {
    const fs = ['uniform float u_aud_bass_level;', 'uniform float u_aud_bass_peak;', 'uniform sampler2D u_gpup_p; // gpu-particles {"p":{}}'].join('\n');
    expect(gpBindings(fs)[0].audio).toBeNull();
  });

  it('replaceGraph runs the load migrations (aliases, then params)', () => {
    useNodeGraphStore.getState().replaceGraph([
      saved('palettePreset', 'p', { preset: '3' }, { t: null }, ['color']),
      saved('smoothMin', 's', { k: 0.25 }, { a: null, b: null }, ['result']),
    ]);
    const [p, s] = useNodeGraphStore.getState().nodes;
    expect(p.type).toBe('palette');
    expect(p.inputs.value).toBeTruthy();
    expect(s.type).toBe('sdfUnion');
    // A Smooth Min saved with k (not smoothness) keeps it.
    expect(s.params.k).toBe(0.25);
  });

  it('Add (vec3) keeps its B when the three sliders agree', () => {
    const [n] = migrateLoadedNodes([saved('addVec3', 'a', { bx: 0.5, by: 0.5, bz: 0.5 }, { a: null, b: null }, ['result'])]);
    expect(n.type).toBe('add');
    expect(n.params.b).toBe(0.5);
    expect(n.params.bx).toBeUndefined();
  });
});

describe('T4: the old transforms are retired; a saved one becomes a Transform on load where exact', () => {
  const OLD = ['place2D', 'uvTransform2d', 'rotate2d', 'translate3D', 'rotate3D', 'scale3d', 'translate4D', 'rotate4D', 'scale4D'];

  it('they stay registered, offered nowhere, and no example uses them', () => {
    const offered = new Set(getOfferedDefinitions().filter(d => !HIDDEN_NODES.has(d.type)).map(d => d.type));
    for (const t of OLD) {
      expect(NODE_REGISTRY[t], t).toBeTruthy();
      expect(RETIRED_TYPES, t).toContain(t);
      expect(offered.has(t), t).toBe(false);
    }
    for (const [k, g] of Object.entries(EXAMPLE_GRAPHS)) expect(typesOf(g.nodes).filter(t => OLD.includes(t)), k).toEqual([]);
  });

  it('Translate 3D, Rotate 4D (with Spin) and Rotate 2D (Angle wired) switch; a Rotate 3D with an angle in radians stays', () => {
    const nodes = migrateLoadedNodes([
      saved('scenePos', 'sp', {}, {}, ['pos']),
      saved('translate3D', 'mv', { tx: 0.5, ty: -0.25, tz: 1 }, { pos: ['sp', 'pos'] }, ['pos']),
      saved('sphereSDF3D', 'ball', { radius: 0.5 }, { pos: ['mv', 'pos'] }, ['dist']),
      saved('lift4D', 'lift', {}, { pos: ['sp', 'pos'] }, ['p4']),
      saved('rotate4D', 'r4', { plane: 'yw', angle: 30, spin: 12 }, { p4: ['lift', 'p4'] }, ['p4']),
      saved('hypersphereSDF', 'hs', {}, { p4: ['r4', 'p4'] }, ['dist']),
      saved('rotate3D', 'r3', { axis: 'y', angle: 0.7 }, { pos: ['sp', 'pos'] }, ['pos']),
      saved('uv', 'uv', {}, {}, ['uv']),
      saved('time', 't', {}, {}, ['time']),
      saved('rotate2d', 'r2', {}, { input: ['uv', 'uv'], angle: ['t', 'time'] }, ['output']),
      saved('circleSDF', 'c', {}, { position: ['r2', 'output'] }, ['distance']),
    ]);
    const by = Object.fromEntries(nodes.map(n => [n.id, n]));
    expect(by.mv.type).toBe('transform');
    expect(by.mv.params).toMatchObject({ dim: '3', x: 0.5, y: -0.25, z: 1 });
    expect(by.ball.inputs.pos.connection).toEqual({ nodeId: 'mv', outputKey: 'p' });
    expect(by.r4.type).toBe('transform');
    expect(by.r4.params).toMatchObject({ dim: '4', ryw: 30, spin: 12, spinPlane: 'yw' });
    expect(by.hs.inputs.p4.connection).toEqual({ nodeId: 'r4', outputKey: 'p' });
    expect(by.r3.type).toBe('rotate3D');
    expect(by.r2.type).toBe('transform');
    expect(by.r2.params).toMatchObject({ dim: '2', mode: 'space', rotate: 0 });
    expect(by.r2.inputs.turn.connection).toEqual({ nodeId: 't', outputKey: 'time' });
    expect(by.c.inputs.position.connection).toEqual({ nodeId: 'r2', outputKey: 'p' });
  });

  it('a Play control on a switched setting follows it (Translate 3D X → Move X)', () => {
    const raw = [saved('scenePos', 'sp', {}, {}, ['pos']), saved('translate3D', 'mv', { tx: 0.5 }, { pos: ['sp', 'pos'] }, ['pos'])];
    const play = { ...emptyPlayRecord(), controls: [{ id: 'c1', kind: 'float', label: 'X', target: 'mv::tx', min: -1, max: 1, value: 0.5 }] } as unknown as PlayRecord;
    expect(migrateLoadedPlay(play, raw).controls[0].target).toBe('mv::x');
  });

  it('the 4D builder turns a spinning shape with a Transform (3D builder folds and rounds with current nodes)', () => {
    const spec = readFileSync(new URL('../../sceneBuilder/spec.ts', import.meta.url), 'utf8');
    for (const t of ['fold3D', 'roundedBoxSDF3D', 'roundedCylinderSDF3D', 'verticalCapsuleSDF3D']) expect(spec).not.toContain(`'${t}'`);
    expect(readFileSync(new URL('../../sceneBuilder/build.ts', import.meta.url), 'utf8')).not.toContain("'rotate4D'");
  });
});

/** A node's own emitted code run on the CPU; returns its outputs. */
function runNode(nd: GraphNode, inputs: Record<string, string>, env: Record<string, Val | ((...a: Val[]) => Val)>): Record<string, Val> {
  const { code, outputVars } = getNodeDefinition(nd.type)!.generateGLSL(nd, inputs);
  const out = runGlsl(code, env);
  return Object.fromEntries(Object.entries(outputVars).map(([k, v]) => [k, out[v] as Val]));
}
const near = (a: number, b: number, eps = 1e-12) => expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThan(eps);
const gone = (t: string, to: string) => {
  expect(NODE_REGISTRY[t], t).toBeUndefined();
  expect(NODE_ALIASES[t]?.to, t).toBe(to);
};

describe('N4: one Shaper with a Curve', () => {
  const OLD: Record<string, NodeDefinition> = {
    expEase: ExpEaseNode, doubleExpSeat: DoubleExpSeatNode, doubleExpSigmoid: DoubleExpSigmoidNode, logisticSigmoid: LogisticSigmoidNode,
    circularEaseIn: CircularEaseInNode, circularEaseOut: CircularEaseOutNode, doubleCircleSeat: DoubleCircleSeatNode,
    doubleCircleSigmoid: DoubleCircleSigmoidNode, doubleEllipticSigmoid: DoubleEllipticSigmoidNode, quadBezierShaper: QuadBezierShaperNode,
  };

  it('each old shaper migrates to Shaper with its Curve and settings, and emits exactly its old code', () => {
    for (const [t, old] of Object.entries(OLD)) {
      gone(t, 'shaper');
      for (const params of [{}, { a: 0.23, b: 0.81, bipolar: true }]) {
        const raw = saved(t, 's', params, { x: null }, ['y']);
        const [nd] = load([raw]);
        expect(nd.type, t).toBe('shaper');
        expect(nd.params.curve, t).toBe(t);
        for (const ins of [{ x: 'X' }, { x: 'X', a: 'A', b: 'B' }] as Record<string, string>[]) {
          const want = old.generateGLSL({ ...raw, params: { ...old.defaultParams, ...params } }, ins);
          expect(getNodeDefinition('shaper')!.generateGLSL(nd, ins), `${t} ${JSON.stringify(params)}`).toEqual(want);
        }
      }
    }
    expect(load([saved('logisticSigmoid', 's', {}, { x: null }, ['y'])])[0].params.a).toBe(0.7);
  });

  it('only the Quadratic Bezier curve brings its helper; Cubic Bezier stays its own node', () => {
    const def = getNodeDefinition('shaper')!;
    expect(def.glslFunctionsFor!(saved('shaper', 's', { curve: 'quadBezierShaper' }, {}, [])).join('')).toContain('quadBezierShaper(');
    expect(def.glslFunctionsFor!(saved('shaper', 's', { curve: 'expEase' }, {}, []))).toEqual([]);
    expect(NODE_REGISTRY.cubicBezierShaper).toBeTruthy();
  });

  it('runs the same numbers on the CPU (Exp ease, Shape 0.3, x 0.4)', () => {
    const [nd] = load([saved('expEase', 's', { a: 0.3 }, { x: null }, ['y'])]);
    near(runNode(nd, { x: 'X' }, { X: 0.4, pow: (a, b) => Math.pow(a as number, b as number) }).y as number, Math.pow(0.4, 0.6));
  });
});

describe('N5: one Chladni (Plate, Field, Superposition and Wave Term)', () => {
  /** Runs a node's code and evaluates each of its outputs (an output may be an expression, like Lines). */
  const runAll = (def: NodeDefinition, nd: GraphNode, ins: Record<string, string>, env: Record<string, Val | ((...a: Val[]) => Val)>) => {
    const { code, outputVars } = def.generateGLSL(nd, ins);
    const tail = Object.entries(outputVars).map(([k, v]) => `    ${k === 'uv' ? 'vec2' : k === 'color' ? 'vec3' : 'float'} __out_${k} = ${v};\n`).join('');
    const out = runGlsl(code + tail, env);
    return Object.fromEntries(Object.keys(outputVars).map(k => [k, out[`__out_${k}`] as Val]));
  };
  const wave = (PI: number) => (p: Val, n: Val, m: Val) => Math.cos((n as number) * PI * (p as number[])[0]) * Math.cos((m as number) * PI * (p as number[])[1]);
  const ENV = (UV: number[]) => ({
    UV, T: 1.3, PI: 3.1415926538, u_resolution: [1600, 900], waveTerm: wave(3.1415926538),
    smoothstep: (e0: Val, e1: Val, x: Val) => { const t = Math.min(1, Math.max(0, ((x as number) - (e0 as number)) / ((e1 as number) - (e0 as number)))); return t * t * (3 - 2 * t); },
    fwidth: () => 0.01, length: (v: Val) => Math.hypot(...(v as number[])), atan: (y: Val, x: Val) => Math.atan2(y as number, x as number),
    chladni: (p: Val, m: Val, n: Val) => wave(3.14159265)(p, n, m) - wave(3.14159265)(p, m, n),
    ch2_noise2: (p: Val) => [Math.sin((p as number[])[0] * 7), Math.cos((p as number[])[1] * 5)],
  });
  const near = (a: Val, b: Val, eps: number) => {
    const A = Array.isArray(a) ? a : [a as number], B = Array.isArray(b) ? b : [b as number];
    A.forEach((x, i) => expect(Math.abs(x - B[i]), `${A} vs ${B}`).toBeLessThanOrEqual(eps));
  };
  const POINTS = [[0.12, -0.31], [0.7, 0.44], [-1.3, 0.05], [0.0, 0.92]];
  const UNIFIED = () => getNodeDefinition('chladniField')!;

  it('Plate, Superposition and Wave Term are aliases onto Chladni; Mode Frequency stays', () => {
    for (const t of ['chladni', 'waveTerm', 'chladniSuperposition']) gone(t, 'chladniField');
    expect(NODE_REGISTRY.chladniModeFreq).toBeTruthy();
    expect(getNodeDefinition('chladniField')!.label).toBe('Chladni');
  });

  it('Wave Term: the same value (Mix 0 adds exactly nothing)', () => {
    for (const bounded of ['plate', 'infinite']) {
      const raw = saved('waveTerm', 'w', { n: 2.5, m: 1.5, scale: 1.4, bounded }, { uv: null }, ['value']);
      const [nd] = load([raw]);
      for (const UV of POINTS) {
        const old = runAll(WaveTermNode, { ...raw, params: { ...WaveTermNode.defaultParams, ...raw.params } }, { uv: 'UV' }, ENV(UV));
        const now = runAll(UNIFIED(), nd, { uv: 'UV' }, ENV(UV));
        near(now.field, old.value, 0);
        near(now.uv, old.uv, 0);
      }
    }
  });

  it('Superposition: 4 terms, square and round, the same field', () => {
    for (const geometry of ['square', 'circular']) {
      const raw = saved('chladniSuperposition', 's', { terms: '4', n1: 3, m1: 2, geometry, w3: -0.4 }, { uv: null, n1: null }, ['field']);
      const [nd] = load([raw]);
      expect(nd.params).toMatchObject({ n: 3, m: 2, mix: 0, terms: '4' });
      for (const UV of POINTS) {
        const old = runAll(ChladniSuperpositionNode, { ...raw, params: { ...ChladniSuperpositionNode.defaultParams, ...raw.params } }, { uv: 'UV' }, ENV(UV));
        near(runAll(UNIFIED(), nd, { uv: 'UV' }, ENV(UV)).field, old.field, 0);
      }
    }
  });

  it('Plate: Mix −1, unstretched, unbounded, with its wobble and lines (π differs only past float32: the same float)', () => {
    expect(Math.fround(3.14159265)).toBe(Math.fround(3.1415926538));
    const raw = saved('chladni', 'c', { m: 0.6, n: 1.7, scale: 1.2, turbulence: 0.05, line_width: 2, aa: 1.5, brightness: 1.4 }, { uv: null, time: null }, ['density', 'field', 'color', 'uv']);
    const [nd] = load([raw]);
    expect(nd.params).toMatchObject({ n: 1.7, m: 0.6, mix: -1, aspect: 'fill', bounded: 'infinite', wobble: 'on' });
    expect(nd.outputs.lines).toBeTruthy();
    for (const UV of POINTS) {
      const old = runAll(ChladniNode, { ...raw, params: { ...ChladniNode.defaultParams, ...raw.params } }, { uv: 'UV', time: 'T' }, ENV(UV));
      const now = runAll(UNIFIED(), nd, { uv: 'UV', time: 'T' }, ENV(UV));
      near(now.uv, old.uv, 0);
      near(now.field, old.field, 1e-6);
      near(now.lines, old.density, 1e-4);
      near(now.color, old.color, 1e-4);
    }
  });

  it('Lines and Color compile when wired (also an old Plate graph)', () => {
    for (const t of ['chladniField', 'chladni']) {
      const nodes = migrateLoadedNodes([
        saved('uv', 'uv', {}, {}, ['uv']),
        saved(t, 'c', t === 'chladni' ? { turbulence: 0.02 } : {}, { uv: ['uv', 'uv'] }, t === 'chladni' ? ['density', 'color'] : ['lines', 'color']),
        saved('multiply', 'k', {}, { a: ['c', t === 'chladni' ? 'density' : 'lines'] }, ['result']),
        saved('output', 'out', {}, { color: ['c', 'color'] }, []),
      ]);
      const r = compileGraph({ nodes });
      expect(r.errors ?? [], t).toEqual([]);
      expect(r.fragmentShader).toContain('fwidth(');
    }
  });

  it('a Chladni saved before (the old Field) emits its old field line', () => {
    const nd = load([saved('chladniField', 'f', { n: 6, m: 4, mix: 1, scale: 1, geometry: 'square' }, { uv: null }, ['field'])])[0];
    const { code } = UNIFIED().generateGLSL(nd, { uv: 'UV' });
    expect(code).toContain('float f_field = waveTerm(f_p, 6.0, 4.0) + 1.0 * waveTerm(f_p, 4.0, 6.0);\n');
    expect(code).not.toContain('ch2_noise2');
  });
});

describe('N8: small duplicates', () => {
  const code = (nd: GraphNode, ins: Record<string, string>) => getNodeDefinition(nd.type)!.generateGLSL(nd, ins).code;

  it('Vec2 → Angle is Vector Angle with its Vector wired: the same atan call, Angle out', () => {
    gone('vec2Angle', 'atan2');
    const [nd] = load([saved('vec2Angle', 'a', {}, { v: ['u', 'uv'] }, ['result'])]);
    expect(nd.type).toBe('atan2');
    expect(code(nd, { v: 'V' })).toBe('    float a_angle = atan((V).y, (V).x);\n');
    expect(code(nd, { y: 'Y', x: 'X' })).toBe('    float a_angle = atan(Y, X);\n');
    const [down] = load([saved('vec2Angle', 'a', {}, { v: null }, ['result']), saved('sin', 's', {}, { input: ['a', 'result'] }, ['output'])]).slice(1);
    expect(down.inputs.input.connection).toEqual({ nodeId: 'a', outputKey: 'angle' });
  });

  it('Vec2 / Vec3 Swizzle are Swizzle with their pattern; the same components', () => {
    gone('vec2Swizzle', 'swizzle');
    gone('vec3Swizzle', 'swizzle');
    const [a, b] = load([saved('vec2Swizzle', 'a', { mode: 'xx' }, { input: null }, ['output']), saved('vec3Swizzle', 'b', { mode: 'zyx' }, { input: null }, ['output'])]);
    expect(a.params).toMatchObject({ inputType: 'vec2', pattern: 'xx' });
    expect(a.outputs.output.type).toBe('vec2');
    expect(code(a, { input: 'V' })).toBe('    vec2 a_output = (V).xx;\n');
    expect(b.params).toMatchObject({ inputType: 'vec3', pattern: 'zyx' });
    expect(code(b, { input: 'V' })).toBe('    vec3 b_output = (V).zyx;\n');
  });

  it('Vec2 Const is a vec2 Constant: the same vec2', () => {
    gone('vec2Const', 'constant');
    const [c] = load([saved('vec2Const', 'c', { x: 0.5, y: -2 }, {}, ['val'])]);
    expect(c.params).toMatchObject({ outputType: 'vec2', x: 0.5, y: -2 });
    expect(code(c, {})).toBe('    vec2 c_value = vec2(0.5, -2.0);\n');
  });

  it('Simple SDF and SDF Colorize are hidden (registered, offered nowhere, unused by examples)', () => {
    const offered = new Set(getOfferedDefinitions().map(d => d.type));
    for (const t of ['simpleSDF', 'sdfColorize']) {
      expect(NODE_REGISTRY[t], t).toBeTruthy();
      expect(offered.has(t), t).toBe(false);
    }
    const OLD = ['simpleSDF', 'sdfColorize', 'vec2Angle', 'vec2Swizzle', 'vec3Swizzle', 'vec2Const'];
    for (const [k, g] of Object.entries(EXAMPLE_GRAPHS)) expect(typesOf(g.nodes).filter(t => OLD.includes(t)), k).toEqual([]);
  });
});

describe('Q12: one home per kind of node', () => {
  const rowOf = (t: string) => { const d = getNodeDefinition(t)!; return rowOfType(d.type, d.category); };

  it('colour adjustments are in Colour grading; Luminance and Float → Color in Colour', () => {
    for (const t of ['brightnessContrast', 'colorSaturation', 'hueRotate', 'liftGammaGain', 'shadowsHighlights', 'toneCurve', 'invert', 'hueRange', 'colorMatrix']) expect(rowOf(t), t).toBe('Color Grading');
    for (const t of ['luminance', 'floatToVec3']) expect(rowOf(t), t).toBe('Color');
  });

  it('every "(texture)" node is in Texture tools (Motion (texture) is an input); no glow is a Combiner', () => {
    for (const d of getOfferedDefinitions().filter(x => !HIDDEN_NODES.has(x.type) && /\((texture|lens)\)/.test(x.label) && x.type !== 'motionMap')) expect(rowOfType(d.type, d.category), d.label).toBe('Texture tools');
    expect(getOfferedDefinitions().filter(d => d.category === 'Combiners' && !HIDDEN_NODES.has(d.type) && /glow/i.test(d.label))).toEqual([]);
  });

  it('every grouped type is in its row, and every offered node of a grouped row has a group', () => {
    const offered = getOfferedDefinitions().filter(d => !HIDDEN_NODES.has(d.type));
    for (const [row, groups] of Object.entries(CATEGORY_GROUPS)) {
      const inRow = new Set(nodesOfRow(row).map(d => d.type));
      for (const g of groups) for (const t of g.types) if (offered.some(d => d.type === t)) expect(inRow.has(t), `${row}/${g.label}: ${t}`).toBe(true);
    }
    const ungrouped = libraryLayout(new Set()).flatMap(s => s.rows.filter(r => CATEGORY_GROUPS[r.row]).flatMap(r => r.groups.filter(g => g.label === 'More').flatMap(g => g.types.map(t => `${r.row}: ${t}`))));
    expect(ungrouped).toEqual([]);
  });
});

describe('Radiance Cascades 2D is retired (too slow)', () => {
  it('stays registered, is offered nowhere, and nothing uses it', () => {
    expect(NODE_REGISTRY.radianceCascadesApprox).toBeTruthy();
    expect(RETIRED_TYPES).toContain('radianceCascadesApprox');
    expect(getOfferedDefinitions().some(d => d.type === 'radianceCascadesApprox')).toBe(false);
    for (const [k, g] of Object.entries(EXAMPLE_GRAPHS)) expect(typesOf(g.nodes).includes('radianceCascadesApprox'), k).toBe(false);
    expect(Object.values(CATEGORY_GROUPS).flat().some(g => g.types.includes('radianceCascadesApprox'))).toBe(false);
  });
});

describe('Q10: the 3D warps sit in 3D Transforms; Fold 3D is Mirror Fold 3D at Offset 0', () => {
  it('3D Domain Warp, Turbulence 3D and Mirror Fold 3D are 3D Transforms, grouped there', () => {
    for (const t of ['domainWarp3D', 'turbulence3D', 'mirrorFold3D']) {
      expect(getNodeDefinition(t)!.category, t).toBe('3D Transforms');
      expect(CATEGORY_GROUPS['3D Transforms'].some(g => g.types.includes(t)), t).toBe(true);
    }
  });

  it('a saved Fold 3D migrates with its axes and folds the same', () => {
    gone('fold3D', 'mirrorFold3D');
    const [def, x, all] = load([
      saved('fold3D', 'a', {}, { pos: null }, ['pos']),
      saved('fold3D', 'b', { foldX: true, foldY: false, foldZ: false }, { pos: null }, ['pos']),
      saved('fold3D', 'c', { foldX: true, foldY: true, foldZ: true }, { pos: null }, ['pos']),
    ]);
    expect(def.params).toMatchObject({ foldX: true, foldY: false, foldZ: true, offsetX: 0, offsetY: 0, offsetZ: 0 });
    expect(x.params).toMatchObject({ foldX: true, foldY: false, foldZ: false });
    const P = [-0.3, -0.7, 0.4];
    const abs = (v: number[], m: boolean[]) => v.map((c, i) => (m[i] ? Math.abs(c) : c));
    expect(runNode(def, { pos: 'P' }, { P }).pos).toEqual(abs(P, [true, false, true]));
    expect(runNode(x, { pos: 'P' }, { P }).pos).toEqual(abs(P, [true, false, false]));
    expect(runNode(all, { pos: 'P' }, { P }).pos).toEqual(abs(P, [true, true, true]));
  });
});

describe('Q11 / N7: one Capsule, Box and Cylinder with Rounding', () => {
  it('Vertical Capsule is Capsule SDF 3D (the same function under another name)', () => {
    gone('verticalCapsuleSDF3D', 'capsuleSDF3D');
    const [c] = load([saved('verticalCapsuleSDF3D', 'v', { radius: 0.3 }, { pos: null }, ['dist'])]);
    expect(c.type).toBe('capsuleSDF3D');
    expect(c.params).toMatchObject({ height: 0.5, radius: 0.3 });
    expect(runNode(c, { pos: 'P' }, { P: [0, 0, 0], sdf3d_capsule: (p, h, r) => { const v = p as number[]; const y = v[1] - Math.min(Math.max(v[1], 0), h as number); return Math.hypot(v[0], y, v[2]) - (r as number); } }).dist).toBeCloseTo(-0.3, 12);
  });

  it('a Box or Cylinder with Edges Sharp emits exactly the plain shape', () => {
    const box = getNodeDefinition('boxSDF3D')!.generateGLSL(saved('boxSDF3D', 'b', { sizeX: 0.5, sizeY: 0.5, sizeZ: 0.5 }, {}, ['dist']), { pos: 'P' }).code;
    expect(box).toBe('    float b_dist = sdf3d_box(P, vec3(0.5, 0.5, 0.5));\n');
    const cyl = getNodeDefinition('cylinderSDF3D')!.generateGLSL(saved('cylinderSDF3D', 'c', { radius: 0.3, height: 0.5 }, {}, ['dist']), { pos: 'P' }).code;
    expect(cyl).toBe('    float c_dist = sdf3d_cylinder(P, 0.3, 0.5);\n');
  });

  it('Rounded Box migrates to Box SDF 3D, Edges Rounded: the same rounded-box call', () => {
    gone('roundedBoxSDF3D', 'boxSDF3D');
    const [b] = load([saved('roundedBoxSDF3D', 'r', { sizeX: 0.3, radius: 0.07 }, { pos: null, radius: ['w', 'value'] }, ['dist'])]);
    expect(b.type).toBe('boxSDF3D');
    expect(b.params).toMatchObject({ sizeX: 0.3, sizeY: 0.4, sizeZ: 0.4, edges: 'rounded', rounding: 0.07 });
    expect(b.inputs.rounding.connection).toEqual({ nodeId: 'w', outputKey: 'value' });
    const code = (nd: GraphNode, ins: Record<string, string>) => getNodeDefinition(nd.type)!.generateGLSL(nd, ins).code;
    expect(code(b, { pos: 'P' })).toBe('    float r_dist = sdf3d_roundedBox(P, vec3(0.3, 0.4, 0.4), 0.07);\n');
    expect(code(b, { pos: 'P', rounding: 'W' })).toBe('    float r_dist = sdf3d_roundedBox(P, vec3(0.3, 0.4, 0.4), W);\n');
  });

  it('Rounded Cylinder migrates with Radius as the outside radius: the old call\'s arguments exactly', () => {
    expect(NODE_ALIASES.roundedCylinderSDF3D.to).toBe('cylinderSDF3D');
    const [c] = load([saved('roundedCylinderSDF3D', 'r', { radius: 0.35, edgeRadius: 0.06, height: 0.4 }, { pos: null }, ['dist'])]);
    expect(c.type).toBe('cylinderSDF3D');
    expect(c.params).toMatchObject({ radius: 0.7, edges: 'rounded', rounding: 0.06, height: 0.4 });
    const args: Val[][] = [];
    runNode(c, { pos: 'P' }, { P: [0.1, 0.2, 0.3], sdf3d_roundedCylinder: (...a: Val[]) => { args.push(a); return 0; } });
    expect(args[0].slice(1)).toEqual([0.35, 0.06, 0.4]);
  });

  it('a Rounded Cylinder with its Radius wired stays as it was (hidden, still registered)', () => {
    const [c] = load([saved('roundedCylinderSDF3D', 'r', {}, { pos: null, radius: ['w', 'value'] }, ['dist'])]);
    expect(c.type).toBe('roundedCylinderSDF3D');
    expect(RETIRED_TYPES).toContain('roundedCylinderSDF3D');
  });

  it('no example uses Fold 3D, Vertical Capsule or the rounded shapes', () => {
    const OLD = ['fold3D', 'verticalCapsuleSDF3D', 'roundedBoxSDF3D', 'roundedCylinderSDF3D'];
    for (const [k, g] of Object.entries(EXAMPLE_GRAPHS)) expect(typesOf(g.nodes).filter(t => OLD.includes(t)), k).toEqual([]);
  });
});
