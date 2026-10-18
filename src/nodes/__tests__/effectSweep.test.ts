/**
 * The 2026-10-17 effects sweep (docs/node-retirements.md): duplicate effect nodes folded into one
 * survivor each. For every family:
 *  - an old graph (saved JSON with the retired type) still loads, resolves and compiles;
 *  - a type merged into a survivor migrates to it (NODE_ALIASES) with the same settings, and the
 *    survivor's GLSL for that mode is the old node's maths (run on the CPU with glslEval.ts);
 *  - a retired type that couldn't map exactly stays registered but is offered nowhere.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import type { GraphNode } from '../../types/nodeGraph';
import { migrateNodeParams } from '../../types/nodeGraph';
import { getNodeDefinition, getOfferedDefinitions, NODE_REGISTRY } from '../definitions';
import { NODE_ALIASES, resolveNodeAliases } from '../definitions/aliases';
import { RETIRED_TYPES } from '../notOffered';
import { HIDDEN_NODES } from '../../components/NodeGraph/libraryRows';
import { compileGraph } from '../../compiler/graphCompiler';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { runGlsl, type Val } from '../../compiler/__tests__/glslEval';

/** A saved node as an old graph holds it: no definition lookup, just type, sockets and params. */
function saved(type: string, id: string, params: Record<string, unknown>, inputs: Record<string, [string, string] | null>, outputs: string[], extra: Partial<GraphNode> = {}): GraphNode {
  return {
    id, type, position: { x: 0, y: 0 }, params,
    inputs: Object.fromEntries(Object.entries(inputs).map(([k, w]) => [k, { type: 'float', label: k, ...(w ? { connection: { nodeId: w[0], outputKey: w[1] } } : {}) }])),
    outputs: Object.fromEntries(outputs.map(k => [k, { type: 'float', label: k }])),
    ...extra,
  } as GraphNode;
}

/** Load as the store does: aliases, then each node's param migration. */
const load = (nodes: GraphNode[]) => resolveNodeAliases(nodes, getNodeDefinition).map(nd => migrateNodeParams(nd, getNodeDefinition));

const compiles = (nodes: GraphNode[]) => {
  const r = compileGraph({ nodes: load(nodes) });
  expect(r.errors ?? []).toEqual([]);
  expect(r.success).toBe(true);
  return r;
};

/** A node's own emitted code run on the CPU; returns its outputs. */
function runNode(nd: GraphNode, inputs: Record<string, string>, env: Record<string, Val | ((...a: Val[]) => Val)>): Record<string, Val> {
  const { code, outputVars } = getNodeDefinition(nd.type)!.generateGLSL(nd, inputs);
  const out = runGlsl(code, env);
  return Object.fromEntries(Object.entries(outputVars).map(([k, v]) => [k, out[v] as Val]));
}

const near = (a: Val, b: Val, eps = 1e-9) => {
  const A = Array.isArray(a) ? a : [a as number], B = Array.isArray(b) ? b : [b as number];
  expect(A.length).toBe(B.length);
  A.forEach((x, i) => expect(Math.abs(x - B[i]), `${A} vs ${B}`).toBeLessThan(eps));
};

/** Retired in the sweep and kept registered (hidden): no exact mapping onto the survivor. */
const SWEPT_HIDDEN: string[] = [];
/** Merged into a survivor: gone from the registry, migrated on load. */
const SWEPT_MERGED = ['smoothWarp', 'curlWarp', 'swirlWarp', 'swirlSpace'];

describe('retired types are offered nowhere but still registered', () => {
  it('every retired type keeps a definition and is out of the library', () => {
    const offered = new Set(getOfferedDefinitions().filter(d => !HIDDEN_NODES.has(d.type)).map(d => d.type));
    for (const t of SWEPT_HIDDEN) expect(RETIRED_TYPES, t).toContain(t);
    for (const t of RETIRED_TYPES) {
      expect(NODE_REGISTRY[t], t).toBeTruthy();
      expect(offered.has(t), t).toBe(false);
    }
  });
  it('a merged type is gone from the registry and resolves to its survivor', () => {
    for (const t of ['smoothWarp', 'curlWarp', 'swirlWarp', 'swirlSpace']) {
      expect(NODE_REGISTRY[t], t).toBeUndefined();
      expect(NODE_ALIASES[t]?.to, t).toBe('uvWarp');
      expect(getNodeDefinition(t)?.type, t).toBe('uvWarp');
    }
  });
  it('no example uses a retired or merged type', () => {
    const gone = new Set([...SWEPT_HIDDEN, ...SWEPT_MERGED]);
    const walk = (nodes: GraphNode[], out: string[]) => { for (const nd of nodes) { out.push(nd.type); const sg = nd.params?.subgraph as { nodes?: GraphNode[] } | undefined; if (sg?.nodes) walk(sg.nodes, out); } return out; };
    for (const [k, g] of Object.entries(EXAMPLE_GRAPHS)) {
      const used = walk(g.nodes, []).filter(t => gone.has(t));
      expect(used, k).toEqual([]);
    }
  });
});

// ── UV Warp ──────────────────────────────────────────────────────────────────

const glslHash2 = (p: number[]): number[] => {
  const q = [p[0] * 127.1 + p[1] * 311.7, p[0] * 269.5 + p[1] * 183.3];
  return q.map(x => { const v = Math.sin(x) * 43758.5453; return (v - Math.floor(v)) * 2 - 1; });
};
/** JS mirrors of the warp helpers' GLSL (transforms.ts), to run the emitted call. */
const WARP_ENV = {
  uvWarpOffset: (uv: Val, scale: Val, t: Val, speed: Val) => {
    const p = (uv as number[]).map(x => x * (scale as number) + (t as number) * (speed as number));
    const h = glslHash2(p.map(x => Math.floor(x) + 0.5));
    return h.map((x, i) => x * (p[i] + 0.5 - Math.floor(p[i] + 0.5)));
  },
  swirlWarpOffset: (uv: Val, cx: Val, cy: Val, twist: Val, falloff: Val, t: Val, speed: Val) => {
    const [x, y] = uv as number[];
    const d = [x - (cx as number), y - (cy as number)];
    const r = Math.hypot(d[0], d[1]);
    const a = (twist as number) * Math.exp(-r * (falloff as number)) + (t as number) * (speed as number) * 0.5;
    return [d[0] * Math.cos(a) - d[1] * Math.sin(a) + (cx as number) - x, d[0] * Math.sin(a) + d[1] * Math.cos(a) + (cy as number) - y];
  },
};

describe('UV Warp: one node, Kind = Smooth / Jitter / Curl / Swirl', () => {
  it('each old warp type migrates with its settings and kind', () => {
    const [sm, cu, sw, sv] = load([
      saved('smoothWarp', 'a', { strength: 0.18, scale: 2.5, speed: 0.3 }, { input: null, time: null, strength: null }, ['output']),
      saved('curlWarp', 'b', { strength: 0.2 }, { input: null }, ['output']),
      saved('swirlWarp', 'c', { strength: 3, falloff: 2, cx: 0.1, cy: -0.2, speed: 0.4 }, { input: null }, ['output']),
      saved('swirlSpace', 'd', { strength: 1.5, falloff: 0.7 }, { input: null, strength: null, falloff: null }, ['output']),
    ]);
    expect(sm.type).toBe('uvWarp');
    expect(sm.params).toMatchObject({ kind: 'smooth', strength: 0.18, scale: 2.5, speed: 0.3 });
    expect(cu.params).toMatchObject({ kind: 'curl', strength: 0.2, scale: 3, speed: 0.4 });
    expect(sw.params).toMatchObject({ kind: 'swirl', strength: 3, falloff: 2, cx: 0.1, cy: -0.2, speed: 0.4 });
    expect(sv.params).toMatchObject({ kind: 'swirl', strength: 1.5, falloff: 0.7, cx: 0, cy: 0, speed: 0 });
  });

  it('an old UV Warp (Jitter) saved before Kind stays Jitter; a new one starts Smooth', () => {
    const [old] = load([saved('uvWarp', 'j', { strength: 0.05, scale: 8, speed: 1, _schemaVersion: 1 }, { input: null }, ['output'])]);
    expect(old.params.kind).toBe('jitter');
    expect(getNodeDefinition('uvWarp')!.defaultParams!.kind).toBe('smooth');
  });

  it('each kind emits exactly the old node\'s call', () => {
    const def = getNodeDefinition('uvWarp')!;
    const code = (kind: string, params: Record<string, unknown>) => def.generateGLSL({ ...saved('uvWarp', 'w', { kind, ...params }, {}, ['output']) }, { input: 'P', time: 'T' }).code;
    expect(code('jitter', { strength: 0.05, scale: 8, speed: 1 })).toBe('    vec2 w_output = P + uvWarpOffset(P, 8.0, T, 1.0) * 0.05;\n');
    expect(code('smooth', { strength: 0.1, scale: 4, speed: 0.5 })).toBe('    vec2 w_output = P + smoothWarpOffset(P, 4.0, T, 0.5) * 0.1;\n');
    expect(code('curl', { strength: 0.15, scale: 3, speed: 0.4 })).toBe('    vec2 w_output = P + curlWarpOffset(P, 3.0, T, 0.4) * 0.15;\n');
    expect(code('swirl', { strength: 2, falloff: 4, cx: 0, cy: 0, speed: 0.3 })).toBe('    vec2 w_output = P + swirlWarpOffset(P, 0.0, 0.0, 2.0, 4.0, T, 0.3);\n');
    // Only the kind's own helper goes into the shader.
    expect(def.glslFunctionsFor!(saved('uvWarp', 'w', { kind: 'curl' }, {}, [])).join('')).toContain('curlWarpOffset');
    expect(def.glslFunctionsFor!(saved('uvWarp', 'w', { kind: 'curl' }, {}, [])).join('')).not.toContain('smoothWarpOffset');
  });

  it('Swirl (from Swirl / Vortex) matches the old Swirl / Vortex maths numerically', () => {
    // The old swirlSpace GLSL, as it emitted.
    const oldCode = (s: number, f: number) => [
      `    float o_r  = length(P);\n`,
      `    float o_sa = ${s.toFixed(1)} * exp(-o_r * ${f.toFixed(1)});\n`,
      `    float o_sc = cos(o_sa); float o_ss = sin(o_sa);\n`,
      `    vec2 o_output = vec2(P.x * o_sc - P.y * o_ss, P.x * o_ss + P.y * o_sc);\n`,
    ].join('');
    const [migrated] = load([saved('swirlSpace', 'w', { strength: 1.5, falloff: 0.5 }, { input: null }, ['output'])]);
    for (const P of [[0.3, -0.2], [0, 0.9], [-1.2, 0.4], [0.01, 0.02]]) {
      const old = runGlsl(oldCode(1.5, 0.5), { P }).o_output as Val;
      const now = runNode(migrated, { input: 'P' }, { P, ...WARP_ENV }).output;
      near(now, old, 1e-12);
    }
  });

  it('Jitter runs the old jitter offset', () => {
    const nd = load([saved('uvWarp', 'w', { strength: 0.07, scale: 5, speed: 1 }, { input: null }, ['output'])])[0];
    const P = [0.31, -0.42];
    const got = runNode(nd, { input: 'P', time: 'T' }, { P, T: 1.7, ...WARP_ENV }).output as number[];
    const off = WARP_ENV.uvWarpOffset(P, 5, 1.7, 1) as number[];
    near(got, [P[0] + off[0] * 0.07, P[1] + off[1] * 0.07]);
  });

  it('old graphs with each warp compile', () => {
    for (const t of ['uvWarp', 'smoothWarp', 'curlWarp', 'swirlWarp', 'swirlSpace']) {
      compiles([
        saved('uv', 'uv', {}, {}, ['uv']),
        saved(t, 'w', {}, { input: ['uv', 'uv'] }, ['output']),
        saved('circleSDF', 'c', { radius: 0.4 }, { position: ['w', 'output'] }, ['distance']),
        saved('output', 'out', {}, { color: ['c', 'distance'] }, []),
      ]);
    }
  });
});
