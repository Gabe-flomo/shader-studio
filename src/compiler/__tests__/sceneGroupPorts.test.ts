/**
 * A Scene Group that takes values in through ports (or has a wired setting) is a GLSL function with extra
 * parameters. Everything that measures the scene must pass them: the march loop always did; Soft Shadow,
 * SDF AO and the other nodes that call the scene function now do too (assembler addSceneArgs).
 */
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });

import { compileGraph } from '../graphCompiler';
import { addSceneArgs } from '../shaderAssembler';
import { getNodeDefinition, resolveNodeAliases } from '../../nodes/definitions';
import { n } from '../../store/graphBuilder';
import type { GraphNode } from '../../types/nodeGraph';
import { compileFragment, type Val } from './glslRun';

describe('addSceneArgs', () => {
  it('adds the arguments to every call, nested ones too, and leaves other names alone', () => {
    const code = 'float a = f(p) + f(p + f(q) * 2.0); float b = xf(p); float c = g(p);';
    expect(addSceneArgs(code, 'f', 'r, s')).toBe('float a = f(p, r, s) + f(p + f(q, r, s) * 2.0, r, s); float b = xf(p); float c = g(p);');
  });
  it('does nothing without arguments', () => {
    expect(addSceneArgs('f(p)', 'f', '')).toBe('f(p)');
  });
});

/** A sphere whose radius comes in through a port from a Constant, measured by Soft Shadow / SDF AO at fixed points. */
function graph(radius: number): GraphNode[] {
  const group = n('sceneGroup', 'scene', 0, 300, {
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
  group.inputs.r = { type: 'float', label: 'R', connection: { nodeId: 'rk', outputKey: 'value' } };
  return [
    n('constant', 'rk', 0, 0, { value: radius }),
    group,
    n('makeVec3', 'pos', 0, 600, { r: 0.7, g: -1.0, b: 0.0 }),       // a point on the floor, off to the side
    n('makeVec3', 'nrm', 0, 700, { r: 0.0, g: 1.0, b: 0.0 }),
    n('makeVec3', 'ld', 0, 800, { r: -0.4, g: 1.0, b: 0.0 }),        // toward the sun: up, passing 0.28 from the sphere's centre
    n('constant', 'hit', 0, 900, { value: 1 }),
    n('softShadow', 'sh', 300, 600, { k: 8, tmax: 20 }, { scene: ['scene', 'scene'], pos: ['pos', 'rgb'], normal: ['nrm', 'rgb'], hit: ['hit', 'value'], lightDir: ['ld', 'rgb'] }),
    n('sdfAo', 'ao', 300, 800, { stepDist: 0.1 }, { scene: ['scene', 'scene'], pos: ['pos', 'rgb'], normal: ['nrm', 'rgb'], hit: ['hit', 'value'] }),
    n('makeVec3', 'res', 600, 600, {}, { r: ['sh', 'shadow'], g: ['ao', 'ao'], b: ['hit', 'value'] }),
    n('output', 'out', 800, 600, {}, { color: ['res', 'rgb'] }),
  ];
}
const compile = (nodes: GraphNode[]) => compileGraph({ nodes: resolveNodeAliases(nodes, getNodeDefinition) });

/** The top-level argument count of every `name(...)` call in `src`. */
function callArity(src: string, name: string): number[] {
  const out: number[] = [];
  let i = 0;
  for (;;) {
    const at = src.indexOf(`${name}(`, i);
    if (at < 0) return out;
    i = at + name.length + 1;
    if (/[A-Za-z0-9_]/.test(src[at - 1] ?? ' ') || /float\s+$/.test(src.slice(Math.max(0, at - 8), at))) continue;
    let depth = 1, commas = 0, j = i;
    for (; j < src.length && depth > 0; j++) {
      const c = src[j];
      if (c === '(') depth++; else if (c === ')') depth--; else if (c === ',' && depth === 1) commas++;
    }
    out.push(commas + 1);
  }
}

describe('Soft Shadow and SDF AO read a Scene Group with a port', () => {
  const r = compile(graph(0.5));

  it('compiles, and the scene function takes the port', () => {
    expect(r.errors ?? []).toEqual([]);
    expect(r.success).toBe(true);
    expect(r.fragmentShader).toMatch(/float mapScene_\w+\(vec3 p, float \w+\)/);
  });

  it('every call of the scene function passes the same arguments (the definition has two)', () => {
    const name = /float (mapScene_\w+)\(vec3 p, float/.exec(r.fragmentShader)![1];
    const arities = callArity(r.fragmentShader, name);
    expect(arities.length).toBeGreaterThanOrEqual(2);
    for (const a of arities) expect(a).toBe(2);
  });

  /** Run the compiled shader on the CPU and read the shadow and occlusion variables. */
  const run = (radius: number) => {
    const c = compile(graph(radius));
    const env = compileFragment(c.fragmentShader).run({ u_time: 0, u_resolution: [64, 64], vUv: [0.5, 0.5], g_uv: [0.5, 0.5], ...(c.paramUniforms as Record<string, Val>) } as never) as Record<string, Val>;
    const get = (suffix: string) => Object.entries(env).find(([k]) => k.endsWith(suffix))?.[1] as number;
    return { shadow: get('_shadow'), ao: get('_ao') };
  };

  it('the shadow matches the shape: a big port-driven sphere blocks the sun, a tiny one does not', () => {
    const big = run(0.6), tiny = run(0.02);
    expect(big.shadow).toBeLessThan(0.05);
    expect(tiny.shadow).toBeGreaterThan(0.5);
  });

  it('the occlusion follows the port too (a sphere touching the floor darkens the point beside it)', () => {
    // The point is 0.7 across and 1.0 below the centre; AO steps up along the normal (y) toward the sphere's height.
    const near = run(1.0), far = run(0.05);
    expect(near.ao).toBeLessThan(far.ao);
    expect(far.ao).toBeGreaterThan(0.99);
  });
});
