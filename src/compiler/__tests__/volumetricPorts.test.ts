/**
 * A Scene Group with port values (settings fed from outside) under a volumetric march loop. The loop body is a
 * GLSL function outside main(), so the ports must be parameters of it too; before, the body called the scene
 * function with main()-scope variables it could not see ("'lfo_0_value' : undeclared identifier").
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../graphCompiler';
import { getNodeDefinition, resolveNodeAliases } from '../../nodes/definitions';
import { volumetricOn } from '../../nodes/volumetricAuto';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { n } from '../../store/graphBuilder';
import type { GraphNode } from '../../types/nodeGraph';
import { compileFragment, type Val } from './glslRun';

const compile = (nodes: GraphNode[]) => compileGraph({ nodes: resolveNodeAliases(nodes, getNodeDefinition) });

/** Every `*_value` port variable a function outside main() reads must be its own parameter or local. */
function undeclaredInFunctions(src: string): string[] {
  const bad: string[] = [];
  const re = /^(?:float|vec[234]|int|bool|mat[234])\s+(\w+)\(([^)]*)\)\s*\{/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[1] === 'main') continue;
    let depth = 1, i = re.lastIndex;
    for (; i < src.length && depth > 0; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') depth--; }
    const body = src.slice(re.lastIndex, i);
    for (const id of new Set(body.match(/\b[a-z]\w*_value\b/g) ?? [])) {
      const decl = new RegExp(`\\b(float|vec[234]|int)\\s+${id}\\b`);
      if (!decl.test(m[2]) && !decl.test(body)) bad.push(`${m[1]}: ${id}`);
    }
  }
  return bad;
}

/** A sphere whose radius arrives through a port from a Constant, under a volumetric March Loop (Scene Distance + Volume Glow in its body). */
function graph(radius: number, extraLoop: Record<string, unknown> = {}, loopType = 'marchLoopGroup'): GraphNode[] {
  const loopDef = getNodeDefinition(loopType)!;
  const scene = n('sceneGroup', 'scene', 0, 300, {
    subgraph: {
      nodes: [
        n('scenePos', 'sp', 0, 0, { _groupOriginal: true }),
        n('sphereSDF3D', 'sph', 200, 0, { radius: 0.1 }, { pos: ['sp', 'pos'] }),
        n('sceneOutput', 'so', 500, 0, { _groupOriginal: true }, { dist: ['sph', 'dist'] }),
      ],
      inputPorts: [{ key: 'r', type: 'float', label: 'R', toNodeId: 'sph', toInputKey: 'radius' }],
      outputPorts: [],
    },
  });
  scene.inputs.r = { type: 'float', label: 'R', connection: { nodeId: 'rk', outputKey: 'value' } };
  const wire = (k: string) => k === 'scene' ? { connection: { nodeId: 'scene', outputKey: 'scene' } }
    : k === 'ro' ? { connection: { nodeId: 'ro', outputKey: 'rgb' } }
    : k === 'rd' ? { connection: { nodeId: 'rd', outputKey: 'rgb' } } : {};
  const loop: GraphNode = {
    id: 'mlg', type: loopType, position: { x: 0, y: 0 },
    inputs: Object.fromEntries(Object.entries(loopDef.inputs).map(([k, v]) => [k, { type: v.type, label: v.label, ...wire(k) }])),
    outputs: { ...Object.fromEntries(Object.entries(loopDef.outputs).map(([k, v]) => [k, { type: v.type, label: v.label }])), acc0: { type: 'float', label: 'Glow' } },
    params: { maxSteps: 128, maxDist: 6, stepScale: 1, passthrough: 0.1, bg: [0, 0, 0], volumetric: true, jitter: 0, ...extraLoop, subgraph: { nodes: [
      n('marchLoopInputs', 'mli', 0, 0, { extraInputs: [] }),
      n('marchSceneDist', 'msd', 200, 0, {}, { pos: ['mli', 'marchPos'] }),
      { ...n('volumeGlow', 'vg', 400, 0, { density: 0.2, falloff: 10, shell: 0 }, { dist: ['msd', 'rawDist'] }), assignOp: '+=' as const },
    ], inputPorts: [], outputPorts: [] } },
  };
  return [
    n('constant', 'rk', 0, 0, { value: radius }),
    scene,
    n('makeVec3', 'ro', 0, 600, { r: 0, g: 0, b: 3 }),
    n('makeVec3', 'rd', 0, 700, { r: 0, g: 0, b: -1 }),
    loop,
    n('output', 'out', 800, 600, {}, { color: ['mlg', 'color'] }),
  ];
}

describe('volumetric March Loop over a Scene Group with a port', () => {
  it('compiles with the port passed through the body function', () => {
    const r = compile(graph(0.5));
    expect(r.errors ?? []).toEqual([]);
    expect(r.success).toBe(true);
    expect(undeclaredInFunctions(r.fragmentShader)).toEqual([]);
    expect(r.fragmentShader).toMatch(/vec3 marchBody_\w+\([^)]*float \w+_value/);
  });

  it('the GI loop in volumetric mode compiles too', () => {
    const r = compile(graph(0.5, {}, 'giLitMarchGroup'));
    expect(r.errors ?? []).toEqual([]);
    expect(r.success).toBe(true);
    expect(undeclaredInFunctions(r.fragmentShader)).toEqual([]);
    expect(r.fragmentShader).toMatch(/vec3 marchBody_\w+\([^)]*float \w+_value/);
  });

  it('keeps working with curvature on', () => {
    const r = compile(graph(0.5, { curvature: 0.3 }));
    expect(r.success).toBe(true);
    expect(undeclaredInFunctions(r.fragmentShader)).toEqual([]);
  });

  /** Run the shader on the CPU and read how many steps the volumetric loop took (it steps by max(scene, Passthrough), so a bigger shape means more small steps). */
  const steps = (radius: number) => {
    const c = compile(graph(radius));
    const env = compileFragment(c.fragmentShader).run({ u_time: 0, u_resolution: [64, 64], vUv: [0.5, 0.5], g_uv: [0.5, 0.5], ...(c.paramUniforms as Record<string, Val>) } as never) as Record<string, Val>;
    return Object.entries(env).find(([k]) => /marchloopg_0_iterCount$/.test(k))?.[1] as number;
  };

  it('the volume follows the port: a bigger sphere keeps the ray in it for more steps', () => {
    const small = steps(0.05), big = steps(0.9);
    expect(Number.isFinite(small) && Number.isFinite(big)).toBe(true);
    expect(big).toBeGreaterThan(small);
  });
});

describe('the 4D examples with Volumetric switched on', () => {
  it.each(['fourDHypersphereInTesseract', 'fourDTesseractSlice', 'fourDThreeSlices'])('%s compiles and no function reads a port it was not given', key => {
    const ex = EXAMPLE_GRAPHS[key];
    let c = 900;
    const loop = ex.nodes.find(nd => nd.type === 'marchLoopGroup')!;
    const nodes = volumetricOn(() => 'v' + (c++), ex.nodes, loop.id).nodes.map(nd => nd.id === loop.id ? { ...nd, params: { ...nd.params, volumetric: true } } : nd);
    const r = compile(nodes);
    expect(r.errors ?? []).toEqual([]);
    expect(r.success).toBe(true);
    expect(undeclaredInFunctions(r.fragmentShader)).toEqual([]);
  });
});
