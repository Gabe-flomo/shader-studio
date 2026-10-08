/**
 * 4D phase 2 (docs/4d.md): the new shapes, transforms and noise. Each node compiles inside a Scene Group; its real
 * GLSL is run on the CPU (glslRun.ts) and checked against known distances, against brute force (the polytope
 * bounds never overestimate), for symmetry (repeat, fold) and for determinism (noise).
 */
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });

import { compileGraph } from '../graphCompiler';
import { getNodeDefinition, getOfferedDefinitions, resolveNodeAliases } from '../../nodes/definitions';
import { FOURD_P2_NODES, FOURD_SHAPE_TYPES, twistAxis } from '../../nodes/definitions/fourD';
import { n } from '../../store/graphBuilder';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { buildFollowCounts, rankFits } from '../../structure/relevance';
import { stageOfType } from '../../structure/stages';
import type { GraphNode } from '../../types/nodeGraph';
import { compileFragment, type Val } from './glslRun';

/** Compile a node's real GLSL once; call the result with inputs to get every variable it set. */
function node(type: string, params: Record<string, unknown>, inputNames: string[]): (inputs: Record<string, Val>, u_time?: number) => Record<string, Val> {
  const def = getNodeDefinition(type)!;
  const nd = n(type, 'nd', 0, 0, params);
  const inputVars: Record<string, string> = {};
  for (const k of inputNames) inputVars[k] = `in_${k}`;
  const { code } = def.generateGLSL(nd, inputVars as never);
  const fn = typeof def.glslFunction === 'string' ? def.glslFunction : '';
  const prog = compileFragment(`${fn}\nvoid main() {\n${code}\n}`);
  return (inputs, u_time = 0) => prog.run({ u_time, ...Object.fromEntries(Object.entries(inputs).map(([k, v]) => [`in_${k}`, v])) } as never) as Record<string, Val>;
}
const shape = (type: string, params: Record<string, unknown> = {}) => {
  const f = node(type, params, ['p4']);
  return (q: number[]) => f({ p4: q }).nd_dist as number;
};

const len = (v: number[]) => Math.hypot(...v);
const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
// Deterministic points (a small LCG, so a failure repeats).
function rng(seed: number) { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; }
const R = rng(7);
const pts = (count: number, spread: number): number[][] => Array.from({ length: count }, () => [0, 0, 0, 0].map(() => (R() * 2 - 1) * spread));

// ── Compile: each node inside a Scene Group ───────────────────────────────────

function sceneWith(chain: GraphNode[], dist: [string, string]): GraphNode[] {
  return [
    n('marchCamera', 'cam', 0, 0, {}),
    n('sceneGroup', 'scene', 0, 300, {
      subgraph: {
        nodes: [n('scenePos', 'sp', 0, 0, { _groupOriginal: true }), ...chain, n('sceneOutput', 'so', 900, 0, { _groupOriginal: true }, { dist })],
        inputPorts: [], outputPorts: [],
      },
    }),
    n('marchLoopGroup', 'march', 300, 0, {}, { ro: ['cam', 'ro'], rd: ['cam', 'rd'], scene: ['scene', 'scene'] }),
    n('output', 'out', 600, 0, {}, { color: ['march', 'color'] }),
  ];
}
const compile = (nodes: GraphNode[]) => compileGraph({ nodes: resolveNodeAliases(nodes, getNodeDefinition) });
const lift = () => n('lift4D', 'lift', 100, 0, { w: 0.25 }, { pos: ['sp', 'pos'] });

describe('4D phase 2 nodes compile inside a Scene Group', () => {
  it.each(FOURD_SHAPE_TYPES.slice(2))('%s', type => {
    const r = compile(sceneWith([lift(), n(type, 'sh', 300, 0, {}, { p4: ['lift', 'p4'] })], ['sh', 'dist']));
    expect(r.success, (r.errors ?? []).join('; ')).toBe(true);
    expect(r.fragmentShader).toMatch(/sdf4d_\w+\(/);
  });

  it.each(['repeat4D', 'fold4D', 'scale4D', 'twist4D'])('%s feeds a shape', type => {
    const t = n(type, 't', 200, 0, {}, { p4: ['lift', 'p4'] });
    const r = compile(sceneWith([lift(), t, n('hypersphereSDF', 'sh', 300, 0, {}, { p4: ['t', 'p4'] })], ['sh', 'dist']));
    expect(r.success, (r.errors ?? []).join('; ')).toBe(true);
  });

  it.each(['scale4D', 'twist4D'])('%s corrects the distance coming back', type => {
    const t = n(type, 't', 200, 0, {}, { p4: ['lift', 'p4'], dist: ['sh', 'dist'] });
    const shape = n('hypersphereSDF', 'sh', 300, 0, {});
    shape.inputs.p4 = { type: 'vec4', label: 'p', connection: { nodeId: 'lift', outputKey: 'p4' } };
    const r = compile(sceneWith([lift(), shape, t], ['t', 'dist']));
    expect(r.success, (r.errors ?? []).join('; ')).toBe(true);
  });

  it('Noise 4D displaces a distance', () => {
    const r = compile(sceneWith([lift(), n('hypersphereSDF', 'sh', 300, 0, {}, { p4: ['lift', 'p4'] }), n('noise4D', 'no', 300, 100, { octaves: '3' }, { p4: ['lift', 'p4'] }),
      n('add', 'sum', 500, 0, {}, { a: ['sh', 'dist'], b: ['no', 'signed'] })], ['sum', 'result']));
    expect(r.success, (r.errors ?? []).join('; ')).toBe(true);
    expect(r.fragmentShader).toContain('noise4d_value(');
  });

  it('settings are live uniforms inside the group', () => {
    const r = compile(sceneWith([lift(), n('duocylinderSDF', 'sh', 300, 0, { r1: 0.6 }, { p4: ['lift', 'p4'] })], ['sh', 'dist']));
    expect(r.paramBindings['sh::r1']).toBeTruthy();
    expect(r.paramBindings['sh::r2']).toBeTruthy();
  });

  it('the new nodes are registered, in the 4D category, and the shapes are Objects', () => {
    for (const [type, def] of Object.entries(FOURD_P2_NODES)) {
      expect(getNodeDefinition(type)?.type, type).toBe(def.type);
      expect(def.category).toBe('4D');
      for (const pd of Object.values(def.paramDefs ?? {})) expect(pd.hint, `${type}`).toBeTruthy();
      expect(def.description?.length ?? 0).toBeGreaterThan(80);
    }
    for (const type of FOURD_SHAPE_TYPES) expect(stageOfType(type)).toBe('objects');
  });
});

// ── Exact shapes: known distances ─────────────────────────────────────────────

describe('exact shapes', () => {
  it('hypersphere is length(p) - r', () => {
    const d = shape('hypersphereSDF', { radius: 0.8 });
    for (const q of pts(20, 1.5)) expect(d(q)).toBeCloseTo(len(q) - 0.8, 5);
  });

  it('duocylinder: values at known points', () => {
    const d = shape('duocylinderSDF', { r1: 0.7, r2: 0.55 });
    expect(d([1.0, 0, 0, 0])).toBeCloseTo(0.3, 6);              // outside in xy only
    expect(d([0, 0, 0, 0.95])).toBeCloseTo(0.4, 6);             // outside in zw only
    expect(d([1.0, 0, 0.95, 0])).toBeCloseTo(0.5, 6);           // outside in both: sqrt(0.3² + 0.4²)
    expect(d([0.7, 0, 0.1, 0.1])).toBeCloseTo(0, 6);            // on the xy rim, inside zw
    expect(d([0, 0, 0, 0])).toBeCloseTo(-0.55, 6);              // centre: the nearer rim
    expect(d([0.7 * Math.SQRT1_2, 0.7 * Math.SQRT1_2, 0.55 * Math.SQRT1_2, 0.55 * Math.SQRT1_2])).toBeCloseTo(0, 6);
  });

  it('duocylinder: its slice at w is a cylinder along z of half height sqrt(r2² - w²)', () => {
    const d = shape('duocylinderSDF', { r1: 0.7, r2: 0.55 });
    const w = 0.3, h = Math.sqrt(0.55 ** 2 - w ** 2);
    expect(d([0, 0, h - 0.01, w])).toBeLessThan(0);
    expect(d([0, 0, h + 0.01, w])).toBeGreaterThan(0);
  });

  it('spherinder: a ball of radius r while |w| < half height', () => {
    const d = shape('spherinderSDF', { radius: 0.55, halfHeight: 0.5 });
    for (const q of pts(15, 1)) { const a = len(q.slice(0, 3)) - 0.55; expect(d([q[0], q[1], q[2], 0])).toBeCloseTo(a > 0 ? a : Math.max(a, -0.5), 5); }
    expect(d([0.55, 0, 0, 0.3])).toBeCloseTo(0, 6);
    expect(d([0, 0, 0, 0.6])).toBeCloseTo(0.1, 6);
    expect(d([0.85, 0, 0, 0.8])).toBeCloseTo(Math.hypot(0.3, 0.3), 6);
  });

  it('cubinder (square x disc): values at known points', () => {
    const d = shape('cubinderSDF', { half: 0.5, radius: 0.6 });
    expect(d([0.5, 0, 0.3, 0.2])).toBeCloseTo(0, 6);            // on a square face
    expect(d([0, 0, 0.6, 0])).toBeCloseTo(0, 6);                // on the disc rim
    expect(d([0.8, 0.9, 0, 0])).toBeCloseTo(Math.hypot(0.3, 0.4), 6);   // beyond the square's corner
    expect(d([0, 0, 0, 0])).toBeCloseTo(-0.5, 6);
    expect(d([0.8, 0, 0.9, 0])).toBeCloseTo(Math.hypot(0.3, 0.3), 6);
  });

  it('cylindrical prism (disc x rectangle): values at known points', () => {
    const d = shape('cylPrismSDF', { radius: 0.45, halfZ: 0.6, halfW: 0.4 });
    expect(d([0.45, 0, 0.2, 0.2])).toBeCloseTo(0, 6);
    expect(d([0, 0, 0.6, 0.1])).toBeCloseTo(0, 6);
    expect(d([0, 0, 0.1, 0.4])).toBeCloseTo(0, 6);
    expect(d([0.75, 0, 0.9, 0])).toBeCloseTo(Math.hypot(0.3, 0.3), 6);
    expect(d([0, 0, 0, 0])).toBeCloseTo(-0.4, 6);
  });

  it('ditorus: zero on the tube surface, -r on the core circles', () => {
    const d = shape('ditorusSDF', { R1: 0.7, R2: 0.5, r: 0.18 });
    expect(d([0.7, 0, 0.5, 0])).toBeCloseTo(-0.18, 6);
    expect(d([0.7 + 0.18, 0, 0.5, 0])).toBeCloseTo(0, 6);
    expect(d([0.7 * Math.SQRT1_2, 0.7 * Math.SQRT1_2, 0, 0.5 + 0.18])).toBeCloseTo(0, 6);
    expect(d([0, 0, 0, 0])).toBeCloseTo(Math.hypot(0.7, 0.5) - 0.18, 6);
  });

  it('Clifford torus: balance 45 is a ditorus with both radii s/sqrt(2); the core lies on the 3-sphere', () => {
    const c = shape('cliffordTorusSDF', { radius: 0.9, thickness: 0.16, balance: 45 });
    const t = shape('ditorusSDF', { R1: 0.9 * Math.SQRT1_2, R2: 0.9 * Math.SQRT1_2, r: 0.16 });
    for (const q of pts(25, 1.3)) expect(c(q)).toBeCloseTo(t(q), 5);
    for (const a of [0.3, 1.1, 2.4]) for (const b of [0.2, 0.9, 3.5]) {
      const core = [0.9 * Math.SQRT1_2 * Math.cos(a), 0.9 * Math.SQRT1_2 * Math.sin(a), 0.9 * Math.SQRT1_2 * Math.cos(b), 0.9 * Math.SQRT1_2 * Math.sin(b)];
      expect(len(core)).toBeCloseTo(0.9, 9);
      expect(c(core)).toBeCloseTo(-0.16, 6);
    }
    // Other balances stay on the sphere too: radii s cos a, s sin a.
    const c30 = shape('cliffordTorusSDF', { radius: 1, thickness: 0.1, balance: 30 });
    expect(c30([Math.cos(Math.PI / 6), 0, Math.sin(Math.PI / 6), 0])).toBeCloseTo(-0.1, 6);
  });
});

// ── Polytopes: bounds that never overestimate ─────────────────────────────────

/** An independent description of each polytope as half-spaces n · x <= h (unit n), and its corners, for radius R. */
function polytope(kind: '5' | '16' | '24', Rr: number): { faces: Array<{ n: number[]; h: number }>; corners: number[][] } {
  const signs4 = (): number[][] => { const o: number[][] = []; for (let m = 0; m < 16; m++) o.push([0, 1, 2, 3].map(k => ((m >> k) & 1 ? 1 : -1) * 0.5)); return o; };
  if (kind === '5') {
    const s = Math.sqrt(5) / 4;
    const u = [[s, s, s, -0.25], [s, -s, -s, -0.25], [-s, s, -s, -0.25], [-s, -s, s, -0.25], [0, 0, 0, 1]];
    return { faces: u.map(v => ({ n: v.map(x => -x), h: Rr / 4 })), corners: u.map(v => v.map(x => x * Rr)) };
  }
  if (kind === '16') {
    const corners: number[][] = [];
    for (let k = 0; k < 4; k++) for (const sg of [-1, 1]) { const c = [0, 0, 0, 0]; c[k] = sg * Rr; corners.push(c); }
    return { faces: signs4().map(v => ({ n: v, h: Rr / 2 })), corners };
  }
  const h = Rr / Math.SQRT2;
  const faces: Array<{ n: number[]; h: number }> = signs4().map(v => ({ n: v, h }));
  const corners: number[][] = [];
  for (let k = 0; k < 4; k++) for (const sg of [-1, 1]) { const e = [0, 0, 0, 0]; e[k] = sg; faces.push({ n: e, h }); }
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) for (const si of [-1, 1]) for (const sj of [-1, 1]) { const c = [0, 0, 0, 0]; c[i] = si * h; c[j] = sj * h; corners.push(c); }
  return { faces, corners };
}
const dotp = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

describe.each([['5', 'cell5SDF'], ['16', 'cell16SDF'], ['24', 'cell24SDF']] as const)('%s-cell', (kind, type) => {
  const Rr = 0.9;
  const d = shape(type, { radius: Rr });
  const poly = polytope(kind, Rr);
  const jsSdf = (q: number[]) => Math.max(...poly.faces.map(f => dotp(f.n, q) - f.h));

  it('has the right number of corners and faces, and every corner is at the radius', () => {
    expect(poly.corners.length).toBe({ '5': 5, '16': 8, '24': 24 }[kind]);
    expect(poly.faces.length).toBe({ '5': 5, '16': 16, '24': 24 }[kind]);
    poly.corners.forEach(c => expect(len(c)).toBeCloseTo(Rr, 9));
  });

  it('matches the half-space maximum, is 0 at the corners and -inradius at the centre', () => {
    for (const q of pts(40, 1.6)) expect(d(q)).toBeCloseTo(jsSdf(q), 5);
    poly.corners.forEach(c => expect(d(c)).toBeCloseTo(0, 6));
    expect(d([0, 0, 0, 0])).toBeCloseTo(-poly.faces[0].h, 6);
  });

  it('never overestimates the true distance: brute force against sampled surface points', () => {
    // Surface points: along random rays from the centre, where the half-spaces first all hold with equality.
    const dirs = pts(6000, 1);
    const surf = dirs.map(v => { const t = Math.min(...poly.faces.map(f => (dotp(f.n, v) > 1e-9 ? f.h / dotp(f.n, v) : Infinity))); return v.map(x => x * t); });
    surf.forEach(s => expect(Math.abs(jsSdf(s))).toBeLessThan(1e-9));
    for (const q of pts(60, 1.8)) {
      const nearest = Math.min(...surf.map(s => len(sub(q, s))));
      const v = d(q);
      expect(Math.abs(v), `${q}`).toBeLessThanOrEqual(nearest + 1e-6);   // the true distance is at most the nearest sample
    }
  });

  it('is 1-Lipschitz so marching by it is safe', () => {
    const a = pts(150, 1.8), b = pts(150, 1.8);
    for (let i = 0; i < a.length; i++) expect(Math.abs(d(a[i]) - d(b[i]))).toBeLessThanOrEqual(len(sub(a[i], b[i])) + 1e-6);
  });

  it('is exact inside: matches the nearest-face distance, which equals the nearest surface sample from the nearest-face foot', () => {
    // For a convex polytope the distance from an inside point to the boundary is its distance to the nearest face plane.
    for (const q of pts(60, 0.5)) {
      const v = d(q);
      if (v >= 0) continue;
      const foot = (() => { const f = poly.faces.reduce((best, c) => (dotp(c.n, q) - c.h > dotp(best.n, q) - best.h ? c : best)); return q.map((x, i) => x - (dotp(f.n, q) - f.h) * f.n[i]); })();
      expect(Math.abs(jsSdf(foot))).toBeLessThan(1e-9);
      expect(-v).toBeCloseTo(len(sub(q, foot)), 6);
    }
  });
});

describe('Lipschitz of every shape', () => {
  it.each(FOURD_SHAPE_TYPES.map(t => [t]))('%s: |f(a) - f(b)| <= |a - b|', type => {
    const d = shape(type);
    const a = pts(120, 1.6), b = pts(120, 1.6);
    for (let i = 0; i < a.length; i++) expect(Math.abs(d(a[i]) - d(b[i]))).toBeLessThanOrEqual(len(sub(a[i], b[i])) + 1e-5);
  });
});

// ── Transforms ────────────────────────────────────────────────────────────────

describe('Scale 4D', () => {
  const f = node('scale4D', { scale: 2 }, ['p4', 'dist']);
  it('divides the point and multiplies the distance back: a scaled hypersphere has radius r * scale', () => {
    const sphere = shape('hypersphereSDF', { radius: 0.5 });
    for (const q of pts(20, 2)) {
      const out = f({ p4: q, dist: sphere(q.map(x => x / 2)) });
      expect(out.nd_dist as number).toBeCloseTo(len(q) - 1.0, 5);
    }
  });
});

describe('Repeat 4D', () => {
  const rep = (params: Record<string, unknown>) => { const f = node('repeat4D', params, ['p4']); return (q: number[]) => f({ p4: q }).nd_p4 as number[]; };
  it('lands every repeated coordinate in its cell, and is periodic', () => {
    const r = rep({ cellX: 1, cellY: 0.8, cellZ: 1.2, cellW: 0.6 });
    const cell = [1, 0.8, 1.2, 0.6];
    for (const q of pts(30, 4)) {
      const o = r(q);
      o.forEach((v, i) => expect(Math.abs(v)).toBeLessThanOrEqual(cell[i] / 2 + 1e-9));
      const moved = q.map((x, i) => x + cell[i] * (i + 1));
      r(moved).forEach((v, i) => expect(v).toBeCloseTo(o[i], 5));
    }
  });
  it('an axis switched off is left alone', () => {
    const r = rep({ repW: false, repX: false });
    for (const q of pts(10, 4)) { const o = r(q); expect(o[0]).toBeCloseTo(q[0], 9); expect(o[3]).toBeCloseTo(q[3], 9); expect(Math.abs(o[1])).toBeLessThanOrEqual(0.5 + 1e-9); }
  });
  it('a count limit stops the copies: beyond N cells the point keeps sliding', () => {
    const r = rep({ limit: 2, cellX: 1, cellY: 1, cellZ: 1, cellW: 1 });
    expect(r([2.2, 0, 0, 0])[0]).toBeCloseTo(0.2, 9);
    expect(r([5.2, 0, 0, 0])[0]).toBeCloseTo(3.2, 9);
    expect(r([-5.2, 0, 0, 0])[0]).toBeCloseTo(-3.2, 9);
  });
  it('a lattice of hyperspheres is the same in every cell', () => {
    const rf = node('repeat4D', {}, ['p4']), sp = shape('hypersphereSDF', { radius: 0.3 });
    for (const q of pts(15, 1)) {
      const base = sp(rf({ p4: q }).nd_p4 as number[]);
      expect(sp(rf({ p4: q.map((x, i) => x + (i === 3 ? 3 : -2)) }).nd_p4 as number[])).toBeCloseTo(base, 5);
    }
  });
});

describe('Mirror / Fold 4D', () => {
  const fold = (params: Record<string, unknown>) => { const f = node('fold4D', params, ['p4']); return (q: number[]) => f({ p4: q }).nd_p4 as number[]; };
  it('axis folds are abs, only on the axes switched on', () => {
    const o = fold({ foldX: true, foldY: false, foldZ: true, foldW: false })([-1, -2, -3, -4]);
    expect(o).toEqual([1, -2, 3, -4]);
  });
  it.each(['xy', 'xz', 'xw', 'yz', 'yw', 'zw', 'sum'])('mirror %s: reflecting a point across the plane gives the same result, and the result lies on one side', m => {
    const f = fold({ foldX: false, foldY: false, foldZ: false, foldW: false, mirror: m });
    const nrm = m === 'sum' ? [0.5, 0.5, 0.5, 0.5] : (() => { const v = [0, 0, 0, 0]; v['xyzw'.indexOf(m[0])] = Math.SQRT1_2; v['xyzw'.indexOf(m[1])] = -Math.SQRT1_2; return v; })();
    for (const q of pts(30, 2)) {
      const o = f(q);
      expect(dotp(o, nrm)).toBeGreaterThanOrEqual(-1e-9);
      const refl = q.map((x, i) => x - 2 * dotp(q, nrm) * nrm[i]);
      f(refl).forEach((v, i) => expect(v).toBeCloseTo(o[i], 5));
      expect(len(o)).toBeCloseTo(len(q), 6);                       // a mirror keeps lengths
      f(o).forEach((v, i) => expect(v).toBeCloseTo(o[i], 6));      // and folding twice changes nothing
    }
  });
  it('a folded shape has the symmetry: f(p) = f(reflect p) for an off-centre hypersphere', () => {
    const fo = node('fold4D', {}, ['p4']), sp = shape('hypersphereSDF', { radius: 0.4 }), tr = node('translate4D', { tx: 0.5, ty: 0.3, tz: -0.2, tw: 0.4 }, ['p4']);
    const d = (q: number[]) => sp(tr({ p4: fo({ p4: q }).nd_p4 as number[] }).nd_p4 as number[]);
    for (const q of pts(20, 1.5)) {
      expect(d([-q[0], q[1], q[2], q[3]])).toBeCloseTo(d(q), 6);
      expect(d([q[0], q[1], q[2], -q[3]])).toBeCloseTo(d(q), 6);
    }
  });
});

describe('Twist 4D', () => {
  it('keeps lengths, turns by amount * coordinate, and leaves the twisting coordinate alone', () => {
    const f = node('twist4D', { plane: 'xz', along: 'y', amount: 30, stepScale: 0.5 }, ['p4', 'dist']);
    for (const q of pts(20, 1.5)) {
      const o = f({ p4: q, dist: 1 });
      const p4 = o.nd_p4 as number[];
      expect(len(p4)).toBeCloseTo(len(q), 5);
      expect(p4[1]).toBeCloseTo(q[1], 9);
      expect(p4[3]).toBeCloseTo(q[3], 9);
      expect(o.nd_dist).toBeCloseTo(0.5, 9);
      const t = 30 * Math.PI / 180 * q[1];
      expect(p4[0]).toBeCloseTo(Math.cos(t) * q[0] + Math.sin(t) * q[2], 5);
    }
  });
  it('picks an axis outside the plane when `along` is in it', () => {
    expect(twistAxis('xz', 'y')).toBe('y');
    expect(twistAxis('xz', 'x')).toBe('y');
    expect(twistAxis('xy', 'y')).toBe('z');
    expect(twistAxis('zw', 'w')).toBe('x');
  });
  it('a twisted shape is not 1-Lipschitz by itself, and the step scale makes up for it', () => {
    const tw = node('twist4D', { plane: 'xz', along: 'y', amount: 120, stepScale: 1 }, ['p4']), sp = shape('duocylinderSDF');
    const d = (q: number[]) => sp(tw({ p4: q }).nd_p4 as number[]);
    let worst = 0;
    const a = pts(300, 1.2), b = a.map(q => q.map((x, i) => x + (R() - 0.5) * 0.06 * (i + 1)));
    for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(d(a[i]) - d(b[i])) / len(sub(a[i], b[i])));
    expect(worst).toBeGreaterThan(1.0);                      // the warning is real
    expect(worst).toBeLessThan(1 + 2.1 * 1.2 * 2);          // k = 2.1 rad/unit, reach about 1.2 -> well within 1 + 2 k r
  });
});

// ── Noise ─────────────────────────────────────────────────────────────────────

describe('Noise 4D', () => {
  const noise = (params: Record<string, unknown> = {}) => { const f = node('noise4D', params, ['p4']); return (q: number[]) => { const o = f({ p4: q }); return [o.nd_value as number, o.nd_signed as number]; }; };
  it('is deterministic: the same point gives the same number, and a fresh compile agrees', () => {
    const a = noise({ octaves: '3' }), b = noise({ octaves: '3' });
    for (const q of pts(30, 5)) { expect(a(q)).toEqual(a(q)); expect(b(q)).toEqual(a(q)); }
  });
  it.each(['1', '2', '3', '4'])('octaves %s: value is in [0, 1], signed in [-1, 1] and is value * 2 - 1', oct => {
    const f = noise({ octaves: oct, scale: 3 });
    let lo = 1, hi = 0;
    for (const q of pts(300, 6)) {
      const [v, s] = f(q);
      expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1);
      expect(s).toBeCloseTo(v * 2 - 1, 9);
      lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
    expect(hi - lo).toBeGreaterThan(0.4);                      // it varies
  });
  it('is smooth: a tiny step changes the value a little (also along w)', () => {
    const f = noise({ octaves: '1', scale: 2 });
    for (const q of pts(40, 4)) for (let k = 0; k < 4; k++) {
      const q2 = [...q]; q2[k] += 1e-3;
      expect(Math.abs(f(q)[0] - f(q2)[0])).toBeLessThan(0.02);
    }
  });
  it('time in w evolves a 3D pattern: the same 3D point changes with w, smoothly', () => {
    const f = noise({ octaves: '2', scale: 1.5 });
    const at = (w: number) => f([0.3, -0.7, 1.1, w])[0];
    expect(at(0)).not.toBeCloseTo(at(1.3), 3);
    expect(Math.abs(at(0.5) - at(0.502))).toBeLessThan(0.01);
  });
  it('scale makes it finer', () => {
    const rough = (s: number) => { const f = noise({ octaves: '1', scale: s }); let t = 0; const q = [0.2, 0.4, 0.6, 0.8]; for (let i = 0; i < 200; i++) { const a = [...q]; a[0] += i * 0.01; const b = [...a]; b[0] += 0.01; t += Math.abs(f(a)[0] - f(b)[0]); } return t; };
    expect(rough(6)).toBeGreaterThan(rough(1));
  });
});

// ── Fits here ─────────────────────────────────────────────────────────────────

describe('Fits here', () => {
  const counts = buildFollowCounts(Object.values(EXAMPLE_GRAPHS));
  const defs = getOfferedDefinitions();
  it.each(FOURD_SHAPE_TYPES.map(t => [t]))('%s offers the float combine nodes (Union / Subtract / Intersect)', type => {
    const fits = rankFits(type, 'float', defs, counts, 50).map(d => d.type);
    expect(fits).toContain('sdfUnion');
  });
});
