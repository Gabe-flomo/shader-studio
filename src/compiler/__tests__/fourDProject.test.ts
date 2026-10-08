/**
 * 4D phase 3 (docs/4d.md): projection. The polytope lists, the projection maths, the wireframe, the
 * solid shadow and the stereographic map, each run through its real GLSL on the CPU (glslRun.ts) and
 * compared with plain TypeScript maths and brute force.
 */
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });

import { compileGraph } from '../graphCompiler';
import { getNodeDefinition, resolveNodeAliases } from '../../nodes/definitions';
import {
  POLYTOPES, polytope, project4, rotatePlane, stereoForward, stereoInverse, stereoStretch, wireframeFunction, projectFunction,
} from '../../nodes/definitions/fourDProject';
import { n } from '../../store/graphBuilder';
import type { GraphNode } from '../../types/nodeGraph';
import { compileFragment, type Val } from './glslRun';

/** Compile a node's real GLSL (with its per-instance helper functions) once; call it with inputs to get every variable it set. */
function node(type: string, params: Record<string, unknown>, inputNames: string[]): (inputs: Record<string, Val>, u_time?: number) => Record<string, Val> {
  const def = getNodeDefinition(type)!;
  const nd = n(type, 'nd', 0, 0, params);
  const inputVars: Record<string, string> = {};
  for (const k of inputNames) inputVars[k] = `in_${k}`;
  const { code } = def.generateGLSL(nd, inputVars as never);
  const fns = [def.glslFunction, ...(def.glslFunctions ?? []), ...(def.glslFunctionsFor?.(nd) ?? [])].filter(Boolean).join('\n');
  const prog = compileFragment(`${fns}\nvoid main() {\n${code}\n}`);
  return (inputs, u_time = 0) => prog.run({ u_time, ...Object.fromEntries(Object.entries(inputs).map(([k, v]) => [`in_${k}`, v])) } as never) as Record<string, Val>;
}

const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const len = (v: number[]) => Math.hypot(...v);
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const DEG = Math.PI / 180;
function segDist(p: number[], a: number[], b: number[]): number {
  const pa = sub(p, a), ba = sub(b, a);
  const h = Math.min(1, Math.max(0, dot(pa, ba) / Math.max(dot(ba, ba), 1e-12)));
  return len(sub(pa, ba.map(x => x * h)));
}
function rng(seed: number) { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; }

// ── Polytopes ─────────────────────────────────────────────────────────────────

describe('polytope lists', () => {
  const COUNTS: Record<string, [number, number]> = { tesseract: [16, 32], cell5: [5, 10], cell16: [8, 24], cell24: [24, 96] };
  it.each(POLYTOPES)('%s has the right number of corners and edges', kind => {
    const { vertices, edges } = polytope(kind);
    expect([vertices.length, edges.length]).toEqual(COUNTS[kind]);
  });
  it.each(POLYTOPES)('%s: corners are on the unit 3-sphere, every edge has the same length, every corner has the same degree', kind => {
    const { vertices, edges } = polytope(kind);
    for (const v of vertices) expect(len(v)).toBeCloseTo(1, 9);
    const lens = edges.map(([a, b]) => len(sub(vertices[a], vertices[b])));
    for (const l of lens) expect(l).toBeCloseTo(lens[0], 9);
    const deg = vertices.map((_, i) => edges.filter(e => e.includes(i)).length);
    for (const d of deg) expect(d).toBe(deg[0]);
  });
  it('edge lengths and degrees match the known polytopes (circumradius 1)', () => {
    const e = (k: string) => { const { vertices, edges } = polytope(k); return [len(sub(vertices[edges[0][0]], vertices[edges[0][1]])), edges.filter(x => x.includes(0)).length]; };
    expect(e('tesseract')[0]).toBeCloseTo(1, 9); expect(e('tesseract')[1]).toBe(4);
    expect(e('cell5')[0]).toBeCloseTo(Math.sqrt(2.5), 9); expect(e('cell5')[1]).toBe(4);
    expect(e('cell16')[0]).toBeCloseTo(Math.SQRT2, 9); expect(e('cell16')[1]).toBe(6);
    expect(e('cell24')[0]).toBeCloseTo(1, 9); expect(e('cell24')[1]).toBe(8);
  });
});

// ── Projection maths ──────────────────────────────────────────────────────────

describe('projection on the CPU', () => {
  it('perspective: xyz * d / (d - w); w = 0 keeps its size, near w grows, far w shrinks', () => {
    expect(project4([1, 2, 3, 0], 3, true)).toEqual([1, 2, 3]);
    const near = project4([1, 0, 0, 1], 3, true), far = project4([1, 0, 0, -1], 3, true);
    expect(near[0]).toBeCloseTo(1.5, 9);
    expect(far[0]).toBeCloseTo(0.75, 9);
  });
  it('orthographic drops w', () => {
    expect(project4([1, 2, 3, 99], 3, false)).toEqual([1, 2, 3]);
  });
  it('the cube-in-a-cube: the tesseract\'s two w = +-1 cubes project to a big cube and a small one', () => {
    const { vertices } = polytope('tesseract');
    const near = vertices.filter(v => v[3] > 0).map(v => project4(v.map(x => x * 2), 3, true));
    const far = vertices.filter(v => v[3] < 0).map(v => project4(v.map(x => x * 2), 3, true));
    for (const q of near) expect(Math.abs(q[0])).toBeCloseTo(1.5, 9);
    for (const q of far) expect(Math.abs(q[0])).toBeCloseTo(0.75, 9);
  });
});

// ── The wireframe ─────────────────────────────────────────────────────────────

/** The projected corners of a polytope for the node's settings (two turns, then the projection), in TypeScript. */
function projectedCorners(kind: string, R: number, camD: number, persp: boolean, pl1: string, a1: number, pl2: string, a2: number): number[][] {
  return polytope(kind).vertices.map(v => project4(rotatePlane(rotatePlane(v.map(x => x * R), pl1, a1 * DEG), pl2, a2 * DEG), camD, persp));
}

describe('4D Wireframe', () => {
  const er = 0.03, vr = 0.06;
  for (const kind of POLYTOPES) for (const projection of ['perspective', 'orthographic']) {
    it(`${kind}, ${projection}: the tube's centre (-edge radius) at every edge midpoint, and brute force agrees`, () => {
      const params = { polytope: kind, projection, radius: 0.9, camDist: 2.6, edge: er, vertex: vr, plane1: 'xw', angle1: 35, plane2: 'yz', angle2: 20 };
      const f = node('wireframe4D', params, ['pos']);
      const dist = (q: number[]) => f({ pos: q }).nd_dist as number;
      const corners = projectedCorners(kind, 0.9, 2.6, projection === 'perspective', 'xw', 35, 'yz', 20);
      const { edges } = polytope(kind);
      const brute = (q: number[]) => Math.min(
        Math.min(...edges.map(([a, b]) => segDist(q, corners[a], corners[b]))) - er,
        Math.min(...corners.map(c => len(sub(q, c)))) - vr);
      for (let k = 0; k < edges.length; k += Math.max(1, Math.floor(edges.length / 12))) {
        const [a, b] = edges[k];
        const mid = corners[a].map((x, i) => (x + corners[b][i]) / 2);
        expect(dist(mid), `${kind} edge ${k}`).toBeLessThanOrEqual(-er + 1e-6);
        expect(dist(mid)).toBeCloseTo(brute(mid), 5);
      }
      const R = rng(11);
      for (let i = 0; i < 30; i++) {
        const q = [0, 0, 0].map(() => (R() * 2 - 1) * 2.2);
        const want = brute(q);
        const got = dist(q);
        // The bounding-sphere early-out returns a lower bound (never more than the true distance) far away; near the shape it is exact.
        if (len(q) < 1.1) expect(got).toBeCloseTo(want, 5); else expect(got).toBeLessThanOrEqual(want + 1e-6);
      }
    });
  }

  it('an xw turn changes the picture', () => {
    const at = (a1: number) => node('wireframe4D', { polytope: 'tesseract', projection: 'perspective', radius: 0.9, camDist: 2.6, plane1: 'xw', angle1: a1, plane2: 'yz', angle2: 0, edge: 0.02, vertex: 0.05 }, ['pos']);
    const q = [0.45, 0.45, 0.45];
    expect(Math.abs((at(0)({ pos: q }).nd_dist as number) - (at(45)({ pos: q }).nd_dist as number))).toBeGreaterThan(0.01);
  });

  it('spin uses time: the same as the angle it adds up to', () => {
    const base = { polytope: 'cell16', projection: 'perspective', radius: 0.9, camDist: 2.6, plane1: 'xw', plane2: 'yz', angle2: 0, edge: 0.02, vertex: 0.05 };
    const a = node('wireframe4D', { ...base, angle1: 10, spin1: 20 }, ['pos']), b = node('wireframe4D', { ...base, angle1: 50, spin1: 0 }, ['pos']);
    const q = [0.3, 0.2, 0.5];
    expect(a({ pos: q }, 2).nd_dist as number).toBeCloseTo(b({ pos: q }, 0).nd_dist as number, 8);
  });

  it('the source has one segment test per edge and one corner per vertex, at most 96 edges, and a bounding-sphere early-out', () => {
    for (const kind of POLYTOPES) {
      const src = wireframeFunction(kind);
      const { vertices, edges } = polytope(kind);
      expect((src.match(/sdf4d_seg2\(/g) ?? []).length).toBe(edges.length);
      expect((src.match(/vec3 q\d+ =/g) ?? []).length).toBe(vertices.length);
      expect(edges.length).toBeLessThanOrEqual(96);
      expect(src).toContain('if (far > 0.25) return far;');
    }
  });
});

// ── Project 4D: the solid shadow ──────────────────────────────────────────────

describe('Project 4D', () => {
  const duo = (extra: Record<string, unknown> = {}) => node('project4D', { shape: 'duocylinder', size: 0.7, ratio: 0.8, wRange: 1.0, smooth: 0, stepScale: 1, plane1: 'xw', angle1: 0, plane2: 'yz', angle2: 0, ...extra }, ['pos']);
  // The shadow of a duocylinder (disc xy r1 x disc zw r2) along w is a cylinder: radius r1, half height r2 along z.
  const cyl = (q: number[], r1: number, r2: number) => {
    const a = Math.hypot(q[0], q[1]) - r1, b = Math.abs(q[2]) - r2;
    return Math.hypot(Math.max(a, 0), Math.max(b, 0)) + Math.min(Math.max(a, b), 0);
  };
  const r1 = 0.7, r2 = 0.56;
  it('with a sample at every needed w (odd count includes w = 0) it is the exact distance to the cylinder shadow on the z = 0 plane', () => {
    const f = duo({ samples: 41 });
    for (const q of [[1.0, 0, 0], [0.9, 0.5, 0], [0, 1.4, 0], [0.2, 0.1, 0], [0.5, 0.0, 0]]) expect(f({ pos: q }).nd_dist as number, `${q}`).toBeCloseTo(cyl(q, r1, r2), 5);
  });
  it('with fewer samples it never reads less than the true distance, and by no more than the half-spacing step allows', () => {
    const N = 12, h = 2 / (N - 1);
    const f = duo({ samples: N });
    const R = rng(5);
    for (let i = 0; i < 80; i++) {
      const q = [(R() * 2 - 1) * 1.6, (R() * 2 - 1) * 1.6, (R() * 2 - 1) * 1.2];
      const want = cyl(q, r1, r2), got = f({ pos: q }).nd_dist as number;
      if (want > 0) { expect(got).toBeGreaterThanOrEqual(want - 1e-6); expect(got).toBeLessThanOrEqual(Math.sqrt(want * want + (h / 2) ** 2) + 1e-6); }
    }
  });
  it('Step scale only shortens the outside distance; Smooth only lowers it', () => {
    const q = [1.3, 0.2, 0.1];
    const hard = duo({ samples: 9 })({ pos: q }).nd_dist as number;
    expect(duo({ samples: 9, stepScale: 0.5 })({ pos: q }).nd_dist as number).toBeCloseTo(hard * 0.5, 8);
    expect(duo({ samples: 9, smooth: 1 })({ pos: q }).nd_dist as number).toBeLessThanOrEqual(hard + 1e-9);
    expect(duo({ samples: 9, stepScale: 0.5 })({ pos: [0, 0, 0] }).nd_dist as number).toBeLessThan(0);
  });
  it('a hypersphere casts a ball and a turn in xw does not change it', () => {
    const q = [0.9, 0.3, 0.2];
    const mk = (a1: number) => node('project4D', { shape: 'hypersphere', size: 0.6, wRange: 1, samples: 31, smooth: 0, stepScale: 1, plane1: 'xw', angle1: a1, plane2: 'yz', angle2: 0 }, ['pos']);
    expect(mk(0)({ pos: q }).nd_dist as number).toBeCloseTo(Math.hypot(...q) - 0.6, 5);
    expect(mk(70)({ pos: q }).nd_dist as number).toBeCloseTo(mk(0)({ pos: q }).nd_dist as number, 6);
  });
  it('a turn in xw changes the shadow of a tesseract (its corner reaches further along x)', () => {
    const mk = (a1: number) => node('project4D', { shape: 'tesseract', size: 0.5, wRange: 1.2, samples: 25, smooth: 0, stepScale: 1, plane1: 'xw', angle1: a1, plane2: 'yz', angle2: 0 }, ['pos']);
    expect(mk(0)({ pos: [0.8, 0, 0] }).nd_dist as number).toBeGreaterThan(0.25);
    expect(mk(45)({ pos: [0.8, 0, 0] }).nd_dist as number).toBeLessThan(0.15);
  });
  it.each(['duocylinder', 'tesseract', 'hypersphere', 'spherinder', 'cubinder', 'ditorus', 'clifford', 'cell5', 'cell16', 'cell24'])('%s: the function is generated and runs', shape => {
    expect(projectFunction(shape)).toContain(`sdf4d_project_${shape}`);
    const d = node('project4D', { shape, size: 0.7, ratio: 0.8, thick: 0.15, wRange: 1, samples: 5, smooth: 1, stepScale: 0.8, plane1: 'xw', angle1: 10, plane2: 'yz', angle2: 0 }, ['pos'])({ pos: [0.1, 0.2, 0.3] }).nd_dist as number;
    expect(Number.isFinite(d)).toBe(true);
  });
});

// ── Stereographic ─────────────────────────────────────────────────────────────

describe('Stereographic 4D', () => {
  const fix = node('stereoDist4D', {}, ['dist', 'factor', 'scale']);
  /** The whole chain at a 3D point: map it to S3, measure the 4D shape, correct the distance. */
  const correct = (st: ReturnType<typeof node>, sh: ReturnType<typeof node>, x: number[]) => {
    const o = st({ pos: x });
    return fix({ dist: sh({ p4: o.nd_p4 }).nd_dist as number, factor: o.nd_factor, scale: o.nd_s }).nd_dist as number;
  };
  it('the map 3D -> S3 -> 3D round-trips, and always lands on the unit sphere', () => {
    const R = rng(3);
    for (let i = 0; i < 50; i++) {
      const x = [0, 0, 0].map(() => (R() * 2 - 1) * 3);
      const X = stereoInverse(x);
      expect(len(X)).toBeCloseTo(1, 9);
      stereoForward(X).forEach((v, k) => expect(v).toBeCloseTo(x[k], 8));
    }
    expect(stereoInverse([0, 0, 0])).toEqual([0, 0, 0, -1]);
  });
  it('the GLSL maps a point onto the sphere of the chosen radius (scale and radius applied) and matches the TypeScript map', () => {
    const f = node('stereo4D', { scale: 1.5, radius: 0.8, plane1: 'xw', angle1: 0, plane2: 'yz', angle2: 0 }, ['pos']);
    const R = rng(9);
    for (let i = 0; i < 20; i++) {
      const x = [0, 0, 0].map(() => (R() * 2 - 1) * 2.5);
      const out = f({ pos: x }).nd_p4 as number[];
      expect(len(out)).toBeCloseTo(0.8, 6);
      const want = stereoInverse(x.map(v => v / 1.5)).map(v => v * 0.8);
      out.forEach((v, k) => expect(v).toBeCloseTo(want[k], 6));
    }
  });
  it('the turn keeps lengths and turns the point the opposite way (the shape turns forward), like Rotate 4D', () => {
    const f = node('stereo4D', { scale: 1, radius: 1, plane1: 'xw', angle1: 40, plane2: 'yw', angle2: 25 }, ['pos']);
    const x = [0.4, -0.7, 0.2];
    const out = f({ pos: x }).nd_p4 as number[];
    expect(len(out)).toBeCloseTo(1, 6);
    // p' = M^T P with M = turn2 * turn1, so p' = turn1(-) of turn2(-) of P.
    const want = rotatePlane(rotatePlane(stereoInverse(x), 'yw', -25 * DEG), 'xw', -40 * DEG);
    out.forEach((v, k) => expect(v).toBeCloseTo(want[k], 6));
  });
  it('the corrected distance is a safe lower bound on the true 3D distance to a Clifford torus (brute force), and not uselessly small', () => {
    const s = 1.2, rho = 1;
    const sh = node('cliffordTorusSDF', { radius: rho, thickness: 0, balance: 45 }, ['p4']);
    const st = node('stereo4D', { scale: s, radius: rho, plane1: 'xw', angle1: 0, plane2: 'yz', angle2: 0 }, ['pos']);
    const D = (x: number[]) => correct(st, sh, x);
    const surf: number[][] = [];
    const M = 160, c = Math.SQRT1_2;
    for (let i = 0; i < M; i++) for (let j = 0; j < M; j++) {
      const t1 = 2 * Math.PI * i / M, t2 = 2 * Math.PI * j / M;
      surf.push(stereoForward([c * Math.cos(t1), c * Math.sin(t1), c * Math.cos(t2), c * Math.sin(t2)]).map(v => v * s));
    }
    const R = rng(21);
    let tight = 0;
    for (let i = 0; i < 60; i++) {
      const x = [0, 0, 0].map(() => (R() * 2 - 1) * 3);
      const truth = Math.min(...surf.map(q => len(sub(x, q))));
      const got = D(x);
      if (got > 0) {
        expect(got, `${x}`).toBeLessThanOrEqual(truth + 0.02);
        if (got > 0.6 * truth) tight++;
      }
    }
    expect(tight).toBeGreaterThan(5);
  });
  it('the corrected distance is about 1-Lipschitz (nearby points never differ by much more than their separation)', () => {
    const s = 1.2, rho = 1;
    const sh = node('cliffordTorusSDF', { radius: rho, thickness: 0.05, balance: 45 }, ['p4']);
    const st = node('stereo4D', { scale: s, radius: rho, plane1: 'xw', angle1: 20, plane2: 'yz', angle2: 15 }, ['pos']);
    const D = (x: number[]) => correct(st, sh, x);
    const R = rng(17);
    let worst = 0;
    for (let i = 0; i < 200; i++) {
      const a = [0, 0, 0].map(() => (R() * 2 - 1) * 4);
      const dir = [R() - 0.5, R() - 0.5, R() - 0.5]; const l = len(dir) || 1;
      const eps = 0.01 + R() * 0.05;
      const b = a.map((v, k) => v + dir[k] / l * eps);
      const da = D(a), db = D(b);
      if (da > 0 && db > 0) worst = Math.max(worst, Math.abs(da - db) / eps);
    }
    expect(worst).toBeLessThan(1.05);
  });
  it('the stretch of the map matches the finite difference of the inverse map', () => {
    const x = [0.5, -0.3, 0.8], e = 1e-5;
    const a = stereoInverse(x), b = stereoInverse([x[0] + e, x[1], x[2]]);
    // Moving along x: the stretch is the conformal factor in every direction.
    expect(len(sub(b, a)) / e).toBeCloseTo(stereoStretch(x), 4);
  });
});

// ── Hopf circles ──────────────────────────────────────────────────────────────

describe('Hopf Circles SDF', () => {
  const params = { radius: 1, thickness: 0.05, count: 5, latitude: 70, spread: 40, rings: 2, phase: 12 };
  const f = node('hopfCirclesSDF', params, ['p4']);
  it('points on a fibre are -thickness inside', () => {
    const eta = (70 - 20) * DEG, phi = 12 * DEG;
    const ca = Math.cos(eta / 2), sa = Math.sin(eta / 2);
    for (const t of [0, 0.7, 2.1, 4.0]) {
      const P = [ca * Math.cos(t), ca * Math.sin(t), sa * Math.cos(t + phi), sa * Math.sin(t + phi)];
      expect(f({ p4: P }).nd_dist as number).toBeCloseTo(-0.05, 6);
    }
  });
  it('all points of one fibre map to ONE point of the base sphere (the Hopf map), and different fibres to different ones', () => {
    const hopf = (P: number[]) => [2 * (P[0] * P[2] + P[1] * P[3]), 2 * (P[1] * P[2] - P[0] * P[3]), P[0] * P[0] + P[1] * P[1] - P[2] * P[2] - P[3] * P[3]];
    const fibre = (eta: number, phi: number, t: number) => [Math.cos(eta / 2) * Math.cos(t), Math.cos(eta / 2) * Math.sin(t), Math.sin(eta / 2) * Math.cos(t + phi), Math.sin(eta / 2) * Math.sin(t + phi)];
    const h0 = hopf(fibre(1.0, 0.4, 0)), h1 = hopf(fibre(1.0, 0.4, 2.2));
    h0.forEach((v, k) => expect(v).toBeCloseTo(h1[k], 9));
    expect(len(sub(hopf(fibre(1.0, 0.4, 0)), hopf(fibre(1.0, 1.4, 0))))).toBeGreaterThan(0.1);
  });
  it('the distance is exact: the minimum over fibres of the distance to a circle (brute force)', () => {
    const R = rng(33);
    const circles: Array<[number[], number[]]> = [];
    for (let j = 0; j < 2; j++) {
      const eta = (70 + (j - 0.5) * 40) * DEG, ca = Math.cos(eta / 2), sa = Math.sin(eta / 2);
      for (let i = 0; i < 5; i++) {
        const phi = 2 * Math.PI * (i + 0.5 * j) / 5 + 12 * DEG;
        circles.push([[ca, 0, sa * Math.cos(phi), sa * Math.sin(phi)], [0, ca, -sa * Math.sin(phi), sa * Math.cos(phi)]]);
      }
    }
    for (let i = 0; i < 25; i++) {
      const P = [0, 0, 0, 0].map(() => (R() * 2 - 1) * 1.3);
      let best = Infinity;
      for (const [u, v] of circles) {
        for (let k = 0; k < 720; k++) { const t = k / 720 * 2 * Math.PI; best = Math.min(best, len(sub(P, u.map((x, q) => x * Math.cos(t) + v[q] * Math.sin(t))))); }
      }
      expect(f({ p4: P }).nd_dist as number).toBeCloseTo(best - 0.05, 2);
    }
  });
});

// ── Compile ───────────────────────────────────────────────────────────────────

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

describe('phase 3 nodes compile inside a Scene Group', () => {
  it.each(POLYTOPES.flatMap(k => ['perspective', 'orthographic'].map(pj => [k, pj])))('4D Wireframe %s %s', (kind, projection) => {
    const r = compile(sceneWith([n('wireframe4D', 'w', 100, 0, { polytope: kind, projection, spin1: 20 }, { pos: ['sp', 'pos'] })], ['w', 'dist']));
    expect(r.success, (r.errors ?? []).join('; ')).toBe(true);
    expect(r.fragmentShader).toContain(`sdf4d_wire_${kind}(`);
    for (const other of POLYTOPES.filter(k => k !== kind)) expect(r.fragmentShader).not.toContain(`sdf4d_wire_${other}(`);
  });
  it.each(['duocylinder', 'tesseract', 'clifford', 'cell24'])('Project 4D %s', shape => {
    const r = compile(sceneWith([n('project4D', 'p', 100, 0, { shape }, { pos: ['sp', 'pos'] })], ['p', 'dist']));
    expect(r.success, (r.errors ?? []).join('; ')).toBe(true);
    expect(r.fragmentShader).toContain(`sdf4d_project_${shape}(`);
  });
  it('Stereographic 4D + Clifford Torus + Hopf Circles in a union', () => {
    const st = n('stereo4D', 'st', 100, 0, { scale: 1 }, { pos: ['sp', 'pos'] });
    const fx = n('stereoDist4D', 'fx', 400, 0, {}, { dist: ['un', 'dist'], factor: ['st', 'factor'], scale: ['st', 'scale'] });
    const ct = n('cliffordTorusSDF', 'ct', 200, 0, {}, { p4: ['st', 'p4'] });
    const hc = n('hopfCirclesSDF', 'hc', 200, 100, {}, { p4: ['st', 'p4'] });
    const un = n('sdfUnion', 'un', 300, 0, { k: 0 }, { a: ['ct', 'dist'], b: ['hc', 'dist'] });
    const r = compile(sceneWith([st, ct, hc, un, fx], ['fx', 'dist']));
    expect(r.success, (r.errors ?? []).join('; ')).toBe(true);
    expect(r.fragmentShader).toContain('sdf4d_hopf(');
  });
  it('the nodes are registered in the 4D category with a description', () => {
    for (const t of ['wireframe4D', 'project4D', 'stereo4D', 'stereoDist4D', 'hopfCirclesSDF']) {
      const d = getNodeDefinition(t)!;
      expect(d.category).toBe('4D');
      expect((d.description ?? '').length).toBeGreaterThan(40);
    }
  });
});
