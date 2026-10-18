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
const SWEPT_HIDDEN: string[] = ['light2d'];
/** Merged into a survivor: gone from the registry, migrated on load (old type → survivor). */
const MERGED_INTO: Record<string, string> = {
  smoothWarp: 'uvWarp', curlWarp: 'uvWarp', swirlWarp: 'uvWarp', swirlSpace: 'uvWarp',
  glowLayer: 'light', distanceFalloff: 'light', deepGlow: 'light',
};
const SWEPT_MERGED = Object.keys(MERGED_INTO);

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
    for (const [t, to] of Object.entries(MERGED_INTO)) {
      expect(NODE_REGISTRY[t], t).toBeUndefined();
      expect(NODE_ALIASES[t]?.to, t).toBe(to);
      expect(getNodeDefinition(t)?.type, t).toBe(to);
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

// ── SDF Glow ─────────────────────────────────────────────────────────────────

const pw = (a: Val, b: Val) => (Array.isArray(a) ? a.map((x, i) => Math.pow(x, Array.isArray(b) ? b[i] : b as number)) : Math.pow(a as number, b as number));
const smoothstep = (e0: Val, e1: Val, x: Val) => { const t = Math.min(1, Math.max(0, ((x as number) - (e0 as number)) / ((e1 as number) - (e0 as number)))); return t * t * (3 - 2 * t); };
const stepFn = (e: Val, x: Val) => ((x as number) >= (e as number) ? 1 : 0);
/** JS mirror of the old (SDF) Deep Glow's deep_glow() (combiners.ts before the sweep). */
const deepGlowJs = (d: number, c: number[], I: number, R: number, S: number, E: number) => {
  const core = smoothstep(E, 0, d) as number;
  const glow = I / Math.pow(Math.max(d, 0) / Math.max(R, 0.0001) + 1, 2);
  return c.map(ch => { const h = ch * core + Math.pow(Math.max(ch, 0), S) * glow; return h / (h + 1); });
};
const GLOW_ENV = {
  pow: pw, smoothstep, step: stepFn,
  deep_glow: (d: Val, c: Val, I: Val, R: Val, S: Val, E: Val) => deepGlowJs(d as number, c as number[], I as number, R as number, S as number, E as number),
};

/** The old Glow Layer's formula for each Type (amount i, power p), as it was written. */
function oldGlowLayer(type: string, d: number, i: number, p: number): number {
  const x = Math.max(d, 0) / Math.max(i, 1e-5);
  switch (type) {
    case 'soft': return Math.pow(1 / (1 + x), p);
    case 'exp': return Math.exp(-0.35 * x * p);
    case 'gauss': return Math.exp(-0.0625 * x * x * p);
    case 'neon': return 0.6 * Math.pow(1 / (1 + x), p) + 1.2 * Math.exp(-Math.abs(d) / Math.max(0.35 * i, 1e-5));
    case 'rim': return Math.pow(1 / (1 + Math.abs(d) / Math.max(i, 1e-5)), p);
    case 'invsq': return Math.pow(1 / (1 + x * x), p);
    default: return Math.pow(i / Math.max(Math.abs(d), 0.0001), p);
  }
}
/** The old Distance Falloff for each mode (rate k, power p). */
function oldFalloff(mode: string, d: number, k: number, p: number): number {
  if (mode === 'gaussian') return Math.exp(-d * d * k);
  if (mode === 'linear') return Math.max(0, 1 - d * k);
  if (mode === 'wyvill') return Math.pow(Math.max(0, 1 - d * d * k), 3);
  return 1 / (1 + Math.pow(Math.max(d, 0), p) * k);
}
/** The old Point Light 2D's falloff of a distance. */
function oldPoint(model: string, d: number, I: number, R: number, gamma: boolean): number {
  if (model === 'inverse') return gamma ? I * Math.pow(1 / Math.max(d, 0.001), 1 / 2.2) : I / Math.max(d, 0.001);
  if (model === 'linear') return I * Math.max(1 - d * R, 0);
  return I * Math.pow(Math.max(1 - d * R, 0), 2);
}
const DISTANCES = [-0.3, -0.02, 0, 0.004, 0.05, 0.21, 0.8, 2.5];

describe('SDF Glow: every distance falloff in one Mode list', () => {
  it('Glow Layer migrates (Type → mode, Intensity → Reach, Color → Tint, Glow → Tinted) and matches every type', () => {
    for (const type of ['halo', 'soft', 'exp', 'gauss', 'neon', 'rim', 'invsq']) {
      const [nd] = load([saved('glowLayer', 'g', { mode: type, intensity: 0.03, power: 1.3, color: [0.2, 0.9, 1] }, { d: null, color: null, intensity: null, power: null }, ['result'])]);
      expect(nd.type).toBe('light');
      expect(nd.params).toMatchObject({ mode: type, reach: 0.03, power: 1.3, tint: [0.2, 0.9, 1], perDistance: false });
      expect(Object.keys(nd.outputs)).toContain('tinted');
      for (const D of DISTANCES) {
        const out = runNode(nd, { distance: 'D' }, { D, ...GLOW_ENV });
        const g = oldGlowLayer(type, D, 0.03, 1.3);
        near(out.glow, g, 1e-9 * Math.max(1, Math.abs(g)));
        near(out.tinted, [0.2, 0.9, 1].map(c => c * g), 1e-9 * Math.max(1, Math.abs(g)));
      }
    }
  });

  it('a Glow Layer with no Type is Halo, with no colour white, and its gradient carries over', () => {
    const [nd] = load([saved('glowLayer', 'g', { intensity: 0.01, power: 1, color__grad: { on: true, along: 'surface', interp: 'smooth', n: 2 }, color__gc0: [1, 0, 0], color__gc1: [0, 0, 1] }, { d: null }, ['result'])]);
    expect(nd.params.mode).toBe('halo');
    expect(nd.params.tint).toEqual([1, 1, 1]);
    expect(nd.params.tint__grad).toEqual({ on: true, along: 'surface', interp: 'smooth', n: 2 });
    expect(nd.params.tint__gc1).toEqual([0, 0, 1]);
    expect(nd.params.color__grad).toBeUndefined();
    const code = getNodeDefinition('light')!.generateGLSL(nd, { distance: 'D' }).code;
    expect(code).toContain('pfGradient(');
  });

  it('Distance Falloff migrates (Rate → Falloff) and matches every mode', () => {
    for (const mode of ['bounded_inv_sq', 'gaussian', 'linear', 'wyvill']) {
      const [nd] = load([saved('distanceFalloff', 'f', { mode, k: 3.5, power: 2.5 }, { distance: null, k: null }, ['falloff'])]);
      expect(nd.type).toBe('light');
      expect(nd.params.brightness).toBe(3.5);
      for (const D of DISTANCES) near(runNode(nd, { distance: 'D' }, { D, ...GLOW_ENV }).glow, oldFalloff(mode, D, 3.5, 2.5));
    }
  });

  it('a wire into Distance Falloff\'s Rate becomes a wire into Falloff, and its output wire follows', () => {
    const nodes = load([
      saved('time', 't', {}, {}, ['time']),
      saved('distanceFalloff', 'f', { mode: 'linear' }, { distance: null, k: ['t', 'time'] }, ['falloff']),
      saved('output', 'out', {}, { color: ['f', 'falloff'] }, []),
    ]);
    expect(nodes[1].inputs.brightness.connection).toEqual({ nodeId: 't', outputKey: 'time' });
    expect(nodes[2].inputs.color.connection).toEqual({ nodeId: 'f', outputKey: 'glow' });
  });

  it('Deep Glow (SDF) migrates to Deep glow mode and matches its core + bleed', () => {
    const [nd] = load([saved('deepGlow', 'd', { intensity: 2, radius: 0.1, saturation: 1.5, edgeSoftness: 0.02 }, { d: null, color: null }, ['result'])]);
    expect(nd.params).toMatchObject({ mode: 'deep', intensity: 2, radius: 0.1, saturation: 1.5, edgeSoftness: 0.02, tint: [1, 1, 1] });
    const C = [0.9, 0.4, 0.2];
    for (const D of DISTANCES) near(runNode(nd, { distance: 'D', tint: 'C' }, { D, C, ...GLOW_ENV }).tinted, deepGlowJs(D, C, 2, 0.1, 1.5, 0.02));
    // Its helper is the old one, written out the same.
    const fns = getNodeDefinition('light')!.glslFunctionsFor!(nd).join('');
    expect(fns).toContain('float glow = intensity / pow(max(d, 0.0) / max(radius, 0.0001) + 1.0, 2.0);');
    expect(fns).toContain('return hdrColor / (hdrColor + vec3(1.0));');
  });

  it('Point light mode is Point Light 2D\'s falloff of the distance', () => {
    for (const [model, gamma] of [['squared', false], ['linear', false], ['inverse', false], ['inverse', true]] as const) {
      const nd = migrateNodeParams(saved('light', 'p', { mode: 'point', pointModel: model, intensity: 1.7, lightRadius: 1.4, pointGamma: gamma ? 'true' : 'false', tint: [1, 1, 1] }, { distance: null }, ['glow', 'tinted']), getNodeDefinition);
      for (const D of DISTANCES.filter(x => x >= 0)) near(runNode(nd, { distance: 'D' }, { D, ...GLOW_ENV }).glow, oldPoint(model, D, 1.7, 1.4, gamma), 1e-9 * Math.max(1, oldPoint(model, D, 1.7, 1.4, gamma)));
    }
  });

  it('the classic modes compile exactly as before (no new helper, same lines)', () => {
    const nd = migrateNodeParams(saved('light', 'l', { mode: 'glow', brightness: 12, tint: [1, 0.85, 0.6] }, { distance: null }, ['glow']), getNodeDefinition);
    const { code } = getNodeDefinition('light')!.generateGLSL(nd, { distance: 'D' });
    expect(code).toBe('    float l_glow = exp(-clamp(12.0, 0.1, 100.0) * D);\n'
      + '    float l_glow_inner = exp(-clamp(8.0, 0.1, 100.0) * max(-(D), 0.0)) * step(D, 0.0);\n'
      + '    vec3 l_glow_tinted = vec3(1.0, 0.85, 0.6) * l_glow;\n');
    expect(getNodeDefinition('light')!.glslFunctionsFor!(nd)).toEqual([]);
  });

  it('old graphs with Glow Layer, Distance Falloff, Deep Glow and Point Light 2D compile', () => {
    const shape = saved('circleSDF', 'c', { radius: 0.3 }, { position: ['uv', 'uv'] }, ['distance']);
    const uv = saved('uv', 'uv', {}, {}, ['uv']);
    compiles([uv, shape, saved('glowLayer', 'g', { mode: 'neon' }, { d: ['c', 'distance'] }, ['result']), saved('output', 'out', {}, { color: ['g', 'result'] }, [])]);
    compiles([uv, shape, saved('distanceFalloff', 'g', {}, { distance: ['c', 'distance'] }, ['falloff']), saved('output', 'out', {}, { color: ['g', 'falloff'] }, [])]);
    compiles([uv, shape, saved('deepGlow', 'g', {}, { d: ['c', 'distance'] }, ['result']), saved('output', 'out', {}, { color: ['g', 'result'] }, [])]);
    compiles([uv, saved('light2d', 'g', {}, { uv: ['uv', 'uv'] }, ['light']), saved('output', 'out', {}, { color: ['g', 'light'] }, [])]);
  });
});
