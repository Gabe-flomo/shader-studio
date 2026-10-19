/**
 * Phase and Speed on the displace nodes (helpers.ts phaseParamDefs / phaseOf): every displacement with a pattern
 * has a Phase (a live uniform off 0, a socket, a Play target) and a Speed (Phase advanced each second by the shader
 * clock), so the pattern moves on its own. At 0 / 0, or saved before they existed, each node writes the code it
 * always did. The moving check runs each node's real GLSL on the CPU (glslRun.ts) at two times.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, key: () => null, length: 0, clear: () => mem.clear() };
});

import type { GraphNode } from '../../types/nodeGraph';
import { getNodeDefinition } from '../definitions';
import { PARAM_SOCKETS } from '../definitions/helpers';
import { compileFragment, type Val } from '../../compiler/__tests__/glslRun';
import { compileGraph } from '../../compiler/graphCompiler';
import { BUILTIN_HELPERS_GLSL } from '../../compiler/shaderAssembler';
import { n } from '../../store/graphBuilder';
import { patchNodeParamsForUniforms } from '../../compiler/uniformPatcher';
import { buildStandaloneGraph } from '../../sceneBuilder/build';
import { parseRecipe, printRecipe } from '../../sceneBuilder/recipe';
import { WARP_BY_KIND, newShape, newWarp, starterSpec } from '../../sceneBuilder/spec';

/** Each displace node, the input its position / UV comes in on, that value, and what to read back. */
const NODES: Array<{ type: string; at: string; value: Val; out: string; wires?: Record<string, string>; extra?: Record<string, unknown> }> = [
  { type: 'displace3D', at: 'pos', value: [0.3, 0.2, 0.1], out: 'dist', wires: { dist: '0.5' } },
  { type: 'sinWarp3D', at: 'p', value: [0.3, 0.2, 0.1], out: 'p' },
  { type: 'turbulence3D', at: 'pos', value: [0.3, 0.2, 0.1], out: 'pos', extra: { octaves: 3 } },
  { type: 'domainWarp3D', at: 'pos', value: [0.3, 0.2, 0.1], out: 'pos' },
  { type: 'rippleSpace', at: 'input', value: [0.3, 0.2], out: 'output' },
  { type: 'turbulence', at: 'input', value: [0.3, 0.2], out: 'output', extra: { octaves: 3 } },
  { type: 'uvWarp', at: 'input', value: [0.3, 0.2], out: 'output', extra: { kind: 'smooth' } },
  { type: 'uvWarp', at: 'input', value: [0.3, 0.2], out: 'output', extra: { kind: 'jitter' } },
  { type: 'uvWarp', at: 'input', value: [0.3, 0.2], out: 'output', extra: { kind: 'curl' } },
  { type: 'uvWarp', at: 'input', value: [0.3, 0.2], out: 'output', extra: { kind: 'swirl' } },
  { type: 'domainWarp', at: 'uv', value: [0.3, 0.2], out: 'uv' },
  { type: 'gridDensityWarp', at: 'uv', value: [0.3, 0.2], out: 'warpedUV' },
];
const label = (c: typeof NODES[number]) => (c.extra?.kind ? `${c.type} (${c.extra.kind})` : c.type);

function node(type: string, params: Record<string, unknown>): GraphNode {
  const def = getNodeDefinition(type)!;
  return { id: 'w', type, position: { x: 0, y: 0 }, params: { ...(def.defaultParams ?? {}), ...params }, inputs: {}, outputs: {} };
}
function code(c: typeof NODES[number], params: Record<string, unknown>) {
  const def = getNodeDefinition(c.type)!;
  const nd = node(c.type, { ...c.extra, ...params });
  return def.generateGLSL(nd, { [c.at]: 'P', ...(c.wires ?? {}) });
}
const fnsOf = (c: typeof NODES[number], params: Record<string, unknown>) => {
  const def = getNodeDefinition(c.type)!;
  const nd = node(c.type, { ...c.extra, ...params });
  return [...(def.glslFunctionsFor?.(nd) ?? []), ...(def.glslFunction ? [def.glslFunction] : [])].join('\n');
};

/** Run a node's code (its functions, the code in main) with P and u_time set; its output var back. */
function evalAt(c: typeof NODES[number], params: Record<string, unknown>, time: number): Val {
  const r = code(c, params);
  const isVec = (v: Val) => Array.isArray(v);
  const decl = isVec(c.value) ? `vec${(c.value as number[]).length}` : 'float';
  const helpers = BUILTIN_HELPERS_GLSL.replace(/mat2 rot2D[^\n]*/, '');
  const prog = compileFragment(`${helpers}\n${fnsOf(c, params)}\nvoid main() {\n    ${decl} P = Pin;\n${r.code}\n    OUT = ${r.outputVars[c.out]};\n}\n`);
  const cross = (a: Val, b: Val) => { const [a0, a1, a2] = a as number[]; const [b0, b1, b2] = b as number[]; return [a1 * b2 - a2 * b1, a2 * b0 - a0 * b2, a0 * b1 - a1 * b0]; };
  const env = prog.run({ Pin: c.value, u_time: time, OUT: 0, cross });
  return env.OUT as Val;
}
const differs = (a: Val, b: Val) => (Array.isArray(a) ? (a as number[]).some((x, i) => Math.abs(x - (b as number[])[i]) > 1e-4) : Math.abs((a as number) - (b as number)) > 1e-4);

describe('every displace node has Phase and Speed', () => {
  for (const c of NODES) {
    it(`${label(c)}: Phase and Speed are float sliders, literal at 0, with sockets`, () => {
      const def = getNodeDefinition(c.type)!;
      expect(def.paramDefs?.phase?.type, 'phase').toBe('float');
      expect(def.paramDefs?.phaseSpeed?.type, 'phaseSpeed').toBe('float');
      expect(def.paramDefs!.phaseSpeed.literalAt).toBe(0);
      if (c.type !== 'gridDensityWarp') expect(def.paramDefs!.phase.literalAt).toBe(0);
      expect(PARAM_SOCKETS.get(c.type)).toEqual(expect.arrayContaining(['phase', 'phaseSpeed']));
      expect(def.inputs.phase && def.inputs.phaseSpeed).toBeTruthy();
      expect(def.defaultParams?.phaseSpeed ?? 0).toBe(0);
    });

    it(`${label(c)}: at Phase 0 / Speed 0 (or saved without them) the code is unchanged`, () => {
      const saved = code(c, {});
      const zero = code(c, { phase: 0, phaseSpeed: 0 });
      expect(zero.code).toBe(saved.code);
      // No clock in a node that had none (Sin Warp 3D reads u_time when Time is unwired, as it always did).
      if (c.type !== 'sinWarp3D') expect(saved.code).not.toContain('u_time');
      // At 0 neither becomes a uniform.
      const { uniforms } = patchNodeParamsForUniforms(node(c.type, { ...c.extra, phase: 0, phaseSpeed: 0 }), getNodeDefinition(c.type)!);
      expect(Object.keys(uniforms).filter(u => /_phaseSpeed$/.test(u) || (c.type !== 'gridDensityWarp' && /_phase$/.test(u)))).toEqual([]);
    });

    it(`${label(c)}: Speed moves the pattern with time; Phase shifts it`, () => {
      const still = { phase: 0, phaseSpeed: 0 };
      const moving = { phaseSpeed: 1.3 };
      // Still: the same at any time (Sin Warp 3D's own clock aside).
      if (c.type !== 'sinWarp3D') expect(differs(evalAt(c, still, 0), evalAt(c, still, 2.7)), 'still').toBe(false);
      expect(differs(evalAt(c, moving, 0.5), evalAt(c, moving, 2.7)), 'moving').toBe(true);
      expect(differs(evalAt(c, { phase: 0.9 }, 0), evalAt(c, still, 0)), 'phase').toBe(true);
      // Phase p at time 0 is Speed s at time p / s.
      const a = evalAt(c, { phase: 1.3 }, 0);
      const b = evalAt(c, { phaseSpeed: 1.3 }, 1);
      if (c.type !== 'sinWarp3D') expect(differs(a, b)).toBe(false);
    });

    it(`${label(c)}: off 0 they are live uniforms`, () => {
      const { uniforms, patchedNode } = patchNodeParamsForUniforms(node(c.type, { ...c.extra, phase: 0.5, phaseSpeed: 0.25 }), getNodeDefinition(c.type)!);
      const ph = Object.keys(uniforms).find(u => u.endsWith('_phase'))!;
      const sp = Object.keys(uniforms).find(u => u.endsWith('_phaseSpeed'))!;
      expect(uniforms[ph]).toBe(0.5);
      expect(uniforms[sp]).toBe(0.25);
      const r = getNodeDefinition(c.type)!.generateGLSL(patchedNode, { [c.at]: 'P', ...(c.wires ?? {}) });
      expect(r.code).toContain(ph);
      expect(r.code).toContain(`u_time * ${sp}`);
    });

    it(`${label(c)}: a wire into Phase takes over the slider`, () => {
      const r = getNodeDefinition(c.type)!.generateGLSL(node(c.type, { ...c.extra }), { [c.at]: 'P', ...(c.wires ?? {}), phase: 'myPhase' });
      expect(r.code).toContain('myPhase');
    });
  }
});

describe('the displace nodes compile in a graph with Phase and Speed', () => {
  it('2D: UV → each warp → Output', () => {
    for (const c of NODES.filter(x => Array.isArray(x.value) && (x.value as number[]).length === 2)) {
      const nodes = [
        n('uv', 'u', 0, 0),
        n(c.type, 'w', 200, 0, { ...c.extra, phase: 0.4, phaseSpeed: 0.7 }, { [c.at]: ['u', 'uv'] }),
        n('splitVec2', 's', 400, 0, {}, { v: ['w', c.out] }),
        n('makeVec3', 'm', 500, 0, {}, { r: ['s', 'x'], g: ['s', 'y'] }),
        n('output', 'out', 600, 0, {}, { color: ['m', 'rgb'] }),
      ];
      const r = compileGraph({ nodes });
      expect(r.success, `${label(c)}: ${r.errors?.join()}`).toBe(true);
      expect(r.fragmentShader).toMatch(/u_time \* u_p_\w+_phaseSpeed/);
    }
  });
});

describe('Scene Builder: Displace (and Sine / Noise warp) take Phase and Speed', () => {
  it('the Displace card lists Phase and Speed after Amplitude and Frequency', () => {
    expect(WARP_BY_KIND.displace.params.map(p => p.label)).toEqual(['Amplitude', 'Frequency', 'Phase', 'Speed']);
    expect(WARP_BY_KIND.sine.params.map(p => p.key)).toEqual(expect.arrayContaining(['phase', 'speed']));
    expect(WARP_BY_KIND.noise.params.map(p => p.key)).toEqual(expect.arrayContaining(['phase', 'speed']));
  });

  it('the recipe reads and writes phase= and speed=, and leaves them out at 0', () => {
    const r = parseRecipe('sphere r=0.6 @displace(0.08 freq=6 phase=1.5 speed=0.75)');
    expect(r.errors ?? []).toEqual([]);
    const disp = findDisplace(r.spec!);
    expect(disp.values).toMatchObject({ amp: 0.08, freq: 6, phase: 1.5, speed: 0.75 });
    const text = printRecipe(r.spec!);
    expect(text).toContain('phase=1.5');
    expect(text).toContain('speed=0.75');
    const plain = printRecipe(parseRecipe('sphere r=0.6 @displace(0.08 freq=6)').spec!);
    expect(plain).not.toMatch(/phase|speed/);
  });

  it('a built Displace without them is the same node as before; with Speed it moves', () => {
    const spec = starterSpec();
    const sh = newShape('sphere', 's9');
    sh.warps.push(newWarp('displace', 'w1'));
    spec.root.children = [sh];
    const before = buildStandaloneGraph(spec).nodes;
    const nodeOf = (nodes: GraphNode[]) => {
      const all = nodes.flatMap(x => [x, ...(((x.params.subgraph as { nodes?: GraphNode[] } | undefined)?.nodes) ?? [])]);
      return all.find(x => x.type === 'displace3D')!;
    };
    const d0 = nodeOf(before);
    expect(d0.params.phase ?? 0).toBe(0);
    expect(d0.params.phaseSpeed ?? 0).toBe(0);
    expect(String(d0.params._sbNote ?? '')).not.toMatch(/Phase|Speed/);
    sh.warps[0].values.speed = 0.5;
    const d1 = nodeOf(buildStandaloneGraph(spec).nodes);
    expect(d1.params.phaseSpeed).toBe(0.5);
    const r = compileGraph({ nodes: buildStandaloneGraph(spec).nodes });
    expect(r.success, r.errors?.join()).toBe(true);
    expect(r.fragmentShader).toMatch(/u_time \* u_p_\w+_phaseSpeed/);
  });
});

function findDisplace(spec: ReturnType<typeof starterSpec>) {
  const walk = (it: { warps: Array<{ kind: string; values: Record<string, unknown> }>; children?: unknown[] }): { kind: string; values: Record<string, unknown> } | undefined =>
    it.warps.find(w => w.kind === 'displace') ?? (it.children ?? []).map(c => walk(c as never)).find(Boolean);
  return walk(spec.root as never)!;
}
