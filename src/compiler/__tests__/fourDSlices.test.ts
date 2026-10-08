/**
 * 4D phase 1: slice directions on Lift to 4D, and Play reaching into Scene Groups (docs/4d.md).
 * The shader text is run on the CPU (glslRun.ts), as in fourD.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });

import { compileGraph } from '../graphCompiler';
import { getNodeDefinition, resolveNodeAliases } from '../../nodes/definitions';
import { sliceBasis, sliceNormal } from '../../nodes/definitions/fourD';
import { n } from '../../store/graphBuilder';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { collectPlayCandidates, findTargetNode, locateTarget, readControlValue } from '../../play/playControls';
import { controlItems } from '../../nodes/controlFinder';
import { DEFAULT_RANDOMIZE_OPTIONS } from '../../nodes/randomizeOptions';
import { bindingKeyOf } from '../../lib/playEngine';
import { compileFragment, type Val } from './glslRun';

function runNode(type: string, params: Record<string, unknown>, inputs: Record<string, Val>): Record<string, Val> {
  const def = getNodeDefinition(type)!;
  const node = n(type, 'nd', 0, 0, params);
  const inputVars: Record<string, string> = {};
  for (const k of Object.keys(inputs)) inputVars[k] = `in_${k}`;
  const { code } = def.generateGLSL(node, inputVars as never);
  const fn = typeof def.glslFunction === 'string' ? def.glslFunction : '';
  const env = { u_time: 0, ...Object.fromEntries(Object.entries(inputs).map(([k, v]) => [`in_${k}`, v])) } as Record<string, Val>;
  return compileFragment(`${fn}\nvoid main() {\n${code}\n}`).run(env as never) as Record<string, Val>;
}

const len = (v: number[]) => Math.hypot(...v);
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const POINTS: number[][] = [];
for (let i = 0; i < 30; i++) POINTS.push([Math.sin(i * 1.7) * 1.4, Math.cos(i * 2.3) * 1.2, Math.sin(i * 0.9 + 1) * 1.1, Math.cos(i * 3.1) * 1.3]);

describe('Lift to 4D slice directions', () => {
  const lift = (dir: string, pos: number[], w: number, extra: Record<string, unknown> = {}) =>
    runNode('lift4D', { sliceDir: dir, ...extra }, { pos, w }).nd_p4 as number[];
  const tess = (p4: number[], h: number) => runNode('tesseractSDF', { size: h, rounding: 0 }, { p4 }).nd_dist as number;

  it('face-first is the old (x, y, z, w) and emits the old code', () => {
    expect(lift('face', [0.3, -0.2, 0.5], 0.7)).toEqual([0.3, -0.2, 0.5, 0.7]);
    const def = getNodeDefinition('lift4D')!;
    expect(def.generateGLSL(n('lift4D', 'l', 0, 0, {}), { pos: 'p' } as never).code).toBe('    vec4 l_p4 = vec4(p, 0.0);\n');
  });

  it.each(['edge', 'corner', 'custom'])('%s: lift = basis · pos + n · w, with an orthonormal basis', dir => {
    const extra = dir === 'custom' ? { sliceA: 37, sliceB: 21 } : {};
    const nrm = sliceNormal(dir, 37, 21);
    const { basis, normal } = sliceBasis(nrm);
    expect(len(normal)).toBeCloseTo(1, 9);
    normal.forEach((v, i) => expect(v).toBeCloseTo(nrm[i], 9));
    basis.forEach((b, i) => {
      expect(len(b)).toBeCloseTo(1, 9);
      expect(dot(b, nrm)).toBeCloseTo(0, 9);
      basis.forEach((c, j) => { if (j > i) expect(dot(b, c)).toBeCloseTo(0, 9); });
    });
    for (const q of POINTS) {
      const w = q[3];
      const got = lift(dir, q.slice(0, 3), w, extra);
      const want = [0, 1, 2, 3].map(k => basis[0][k] * q[0] + basis[1][k] * q[1] + basis[2][k] * q[2] + nrm[k] * w);
      got.forEach((v, k) => expect(v).toBeCloseTo(want[k], 5));
      expect(dot(got, nrm)).toBeCloseTo(w, 5);
      expect(len(got) ** 2).toBeCloseTo(len(q.slice(0, 3)) ** 2 + w * w, 4);
    }
  });

  it('custom: tilt 60 / swing 54.74 is corner-first; tilt 45 / swing 0 is an edge-first normal up to symmetry', () => {
    sliceNormal('custom', 60, Math.atan(Math.SQRT2) * 180 / Math.PI).forEach(v => expect(v).toBeCloseTo(0.5, 4));
    const e = sliceNormal('custom', 45, 0);
    expect(e[3]).toBeCloseTo(Math.SQRT1_2, 9);
    expect(e[0]).toBeCloseTo(Math.SQRT1_2, 9);
    expect(sliceNormal('custom', 0, 33)).toEqual([0, 0, 0, 1]);
  });

  // The vertices of the slice of a tesseract of half size h at w: where the hyperplane n · x = w crosses an edge
  // (an edge runs along one axis, the other three coordinates are ±h).
  function sliceVertices(nrm: number[], h: number, w: number): number[][] {
    const out: number[][] = [];
    for (let axis = 0; axis < 4; axis++) for (let m = 0; m < 8; m++) {
      const x = [0, 0, 0, 0]; let b = 0;
      for (let k = 0; k < 4; k++) if (k !== axis) x[k] = ((m >> b++) & 1 ? 1 : -1) * h;
      if (Math.abs(nrm[axis]) < 1e-9) continue;
      const rest = nrm.reduce((s, c, k) => (k === axis ? s : s + c * x[k]), 0);
      x[axis] = (w - rest) / nrm[axis];
      if (Math.abs(x[axis]) > h + 1e-9) continue;
      if (!out.some(o => len(o.map((v, k) => v - x[k])) < 1e-7)) out.push(x);
    }
    return out;
  }

  it('corner-first, w over [-2h, 2h]: point, tetrahedron, truncated tetrahedron, octahedron at 0, and back', () => {
    const h = 0.5, nrm = sliceNormal('corner');
    const count = (w: number) => sliceVertices(nrm, h, w).length;
    expect(count(2 * h)).toBe(1);
    expect(count(1.5 * h)).toBe(4);
    expect(count(0.5 * h)).toBe(12);
    expect(count(0)).toBe(6);
    expect(count(-0.5 * h)).toBe(12);
    expect(count(-1.5 * h)).toBe(4);
    expect(count(-2 * h)).toBe(1);
    expect(count(2.1 * h)).toBe(0);
    // Regular: every vertex of the octahedron and of the tetrahedron is the same distance from the centroid.
    for (const [w, k] of [[0, 6], [1.5 * h, 4]] as const) {
      const vs = sliceVertices(nrm, h, w);
      const c = [0, 1, 2, 3].map(i => vs.reduce((s, v) => s + v[i], 0) / vs.length);
      const rs = vs.map(v => len(v.map((x, i) => x - c[i])));
      expect(vs.length).toBe(k);
      rs.forEach(r => expect(r).toBeCloseTo(rs[0], 7));
    }
  });

  it('the real shader agrees: vertices lie on the surface, the centre is inside, past the end it is empty', () => {
    const h = 0.5;
    for (const dir of ['face', 'edge', 'corner']) {
      const nrm = sliceNormal(dir);
      const { basis } = sliceBasis(nrm);
      for (const w of dir === 'corner' ? [-0.8, -0.3, 0, 0.3, 0.8] : [-0.4, 0, 0.4]) {
        const vs = sliceVertices(nrm, h, w);
        expect(vs.length, `${dir} ${w}`).toBeGreaterThan(0);
        for (const v of vs) {
          const pos = basis.map(b => dot(b, v));
          const p4 = lift(dir, pos, w);
          p4.forEach((c, k) => expect(c).toBeCloseTo(v[k], 5));
          expect(tess(p4, h)).toBeCloseTo(0, 5);
        }
        const cen = [0, 1, 2].map(i => vs.reduce((s, v) => s + dot(basis[i], v), 0) / vs.length);
        expect(tess(lift(dir, cen, w), h)).toBeLessThan(0);
        expect(tess(lift(dir, [3, 3, 3], w), h)).toBeGreaterThan(0);
      }
      const end = dir === 'face' ? 0.55 : dir === 'edge' ? 0.75 : 1.05;
      for (const q of POINTS.slice(0, 10)) expect(tess(lift(dir, q.slice(0, 3), end), h)).toBeGreaterThan(0);
    }
    expect(sliceVertices(sliceNormal('face'), h, 0).length).toBe(8);
    expect(sliceVertices(sliceNormal('edge'), h, 0).length).toBe(8);
    expect(sliceVertices(sliceNormal('corner'), h, 0).length).toBe(6);
  });
});

describe('Play controls inside a Scene Group', () => {
  const nodes = (key = 'fourDHypersphereInTesseract') => resolveNodeAliases(EXAMPLE_GRAPHS[key].nodes, getNodeDefinition);

  it('settings one level into a Scene Group are candidates when live; a port-driven one is not', () => {
    const ns = nodes();
    const r = compileGraph({ nodes: ns });
    const cands = collectPlayCandidates(ns, r.paramBindings);
    const targets = cands.map(c => c.target);
    expect(targets).toContain('scene::rot::angle');
    expect(targets).toContain('scene::lid::height');
    expect(targets).toContain('scene::ball::radius');
    expect(targets).not.toContain('scene::lift::w');
    expect(cands.find(x => x.target === 'scene::rot::angle')!.groupLabel).toBe('Hypersphere in a tesseract');
  });

  it('the binding is the inner node and key, which is what the engine writes', () => {
    expect(bindingKeyOf('scene::rot::angle')).toBe('rot::angle');
    const r = compileGraph({ nodes: nodes() });
    expect(r.paramUniforms[r.paramBindings['rot::angle']]).toBe(0);
  });

  it('reads the control value (a group override wins), finds the node, and keeps the target', () => {
    const ns = nodes();
    expect(readControlValue(ns, 'scene::lid::height')).toBe(0.35);
    const edited = ns.map(x => (x.id === 'scene' ? { ...x, params: { ...x.params, 'lid::height': 0.1 } } : x));
    expect(readControlValue(edited, 'scene::lid::height')).toBe(0.1);
    expect(findTargetNode(ns, 'scene::lid::height')?.type).toBe('planeSDF3D');
    expect(locateTarget(ns, 'scene::lid::height').status).toBe('ok');
  });

  it('a Scene Group override of a slider reaches the shader uniform', () => {
    const ns = nodes().map(x => (x.id === 'scene' ? { ...x, params: { ...x.params, 'lid::height': 0.1 } } : x));
    const r = compileGraph({ nodes: ns });
    expect(r.paramUniforms[r.paramBindings['lid::height']]).toBe(0.1);
  });

  it('Suggest controls offers the settings inside a Scene Group', () => {
    const ns = nodes();
    const r = compileGraph({ nodes: ns });
    const { items } = controlItems(ns, DEFAULT_RANDOMIZE_OPTIONS, collectPlayCandidates(ns, r.paramBindings), new Set());
    const targets = items.map(i => i.target);
    expect(targets).toContain('scene::rot::angle');
    expect(targets).toContain('scene::lid::height');
    expect(targets).not.toContain('scene::lift::w');
    const t = nodes('fourDTesseractSlice');
    const r2 = compileGraph({ nodes: t });
    expect(controlItems(t, DEFAULT_RANDOMIZE_OPTIONS, collectPlayCandidates(t, r2.paramBindings), new Set()).items.map(i => i.target)).toContain('scene::ts::size');
  });
});
