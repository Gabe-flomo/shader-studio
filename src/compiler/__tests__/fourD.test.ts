/**
 * The 4D nodes (docs/4d.md): each compiles inside a Scene Group, and the emitted GLSL is run on the
 * CPU (glslRun.ts) against plain maths: the hypersphere's slice vanishes at w = r, the tesseract's
 * slice at w = 0 is the 3D box, and every rotation plane keeps lengths.
 */
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });

import { compileGraph } from '../graphCompiler';
import { getNodeDefinition, resolveNodeAliases } from '../../nodes/definitions';
import { ROTATION_PLANES_4D } from '../../nodes/definitions/fourD';
import { n } from '../../store/graphBuilder';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { EXAMPLE_FOLDERS, EXAMPLE_INDEX } from '../../store/exampleIndex';
import { FOURD_EXAMPLE_KEYS } from '../../store/fourDExamples';
import { collectPlayCandidates } from '../../play/playControls';
import type { GraphNode } from '../../types/nodeGraph';
import { compileFragment, type Val } from './glslRun';

// ── A node's real GLSL, run on the CPU ───────────────────────────────────────

/** Run `type` with `params`, its inputs bound to `in_<name>` variables from `inputs`; returns every variable it set. */
function runNode(type: string, params: Record<string, unknown>, inputs: Record<string, Val>): Record<string, Val> {
  const def = getNodeDefinition(type)!;
  const node = n(type, 'nd', 0, 0, params);
  const inputVars: Record<string, string> = {};
  for (const k of Object.keys(inputs)) inputVars[k] = `in_${k}`;
  const { code } = def.generateGLSL(node, inputVars as never);
  const fn = typeof def.glslFunction === 'string' ? def.glslFunction : '';
  const src = `${fn}\nvoid main() {\n${code}\n}`;
  const env = { u_time: 0, ...Object.fromEntries(Object.entries(inputs).map(([k, v]) => [`in_${k}`, v])) } as Record<string, Val>;
  return compileFragment(src).run(env as never) as Record<string, Val>;
}

const len = (v: number[]) => Math.hypot(...v);
// A small deterministic spread of points (no RNG, so a failure repeats).
const POINTS: number[][] = [];
for (let i = 0; i < 40; i++) POINTS.push([Math.sin(i * 1.7) * 1.4, Math.cos(i * 2.3) * 1.2, Math.sin(i * 0.9 + 1) * 1.1, Math.cos(i * 3.1) * 1.3]);

// ── Compile: each node inside a Scene Group ───────────────────────────────────

/** Scene Pos → `chain` → Scene Output inside a Scene Group, with a camera and loop around it. */
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

describe('4D nodes compile inside a Scene Group', () => {
  it('Lift to 4D builds a vec4 from the point and w', () => {
    const r = compile(sceneWith([lift(), n('hypersphereSDF', 'hs', 300, 0, {}, { p4: ['lift', 'p4'] })], ['hs', 'dist']));
    expect(r.errors ?? []).toEqual([]);
    expect(r.success).toBe(true);
    expect(r.fragmentShader).toMatch(/vec4\s+\w+_p4 = vec4\(p, /);
  });

  it('Hypersphere SDF', () => {
    const r = compile(sceneWith([lift(), n('hypersphereSDF', 'hs', 300, 0, { radius: 0.7 }, { p4: ['lift', 'p4'] })], ['hs', 'dist']));
    expect(r.success, (r.errors ?? []).join('; ')).toBe(true);
    expect(r.fragmentShader).toContain('sdf4d_hypersphere(');
  });

  it('Tesseract SDF', () => {
    const r = compile(sceneWith([lift(), n('tesseractSDF', 'ts', 300, 0, { size: 0.5, rounding: 0.1 }, { p4: ['lift', 'p4'] })], ['ts', 'dist']));
    expect(r.success, (r.errors ?? []).join('; ')).toBe(true);
    expect(r.fragmentShader).toContain('sdf4d_tesseract(');
  });

  it('Translate 4D', () => {
    const r = compile(sceneWith([lift(), n('translate4D', 'tr', 200, 0, { tw: 0.3 }, { p4: ['lift', 'p4'] }),
      n('hypersphereSDF', 'hs', 300, 0, {}, { p4: ['tr', 'p4'] })], ['hs', 'dist']));
    expect(r.success, (r.errors ?? []).join('; ')).toBe(true);
    expect(r.fragmentShader).toMatch(/vec4\s+\w+_p4 = \w+_p4 - vec4\(/);
  });

  it.each([...ROTATION_PLANES_4D])('Rotate 4D in the %s plane', plane => {
    const r = compile(sceneWith([lift(), n('rotate4D', 'rot', 200, 0, { plane, angle: 30, spin: 10 }, { p4: ['lift', 'p4'] }),
      n('tesseractSDF', 'ts', 300, 0, {}, { p4: ['rot', 'p4'] })], ['ts', 'dist']));
    expect(r.success, (r.errors ?? []).join('; ')).toBe(true);
    expect(r.fragmentShader).toMatch(/\w+_c \* \w+_q\./);
  });

  it('the angle and the slice are live uniforms inside the group', () => {
    const r = compile(sceneWith([lift(), n('rotate4D', 'rot', 200, 0, { angle: 30 }, { p4: ['lift', 'p4'] }),
      n('tesseractSDF', 'ts', 300, 0, {}, { p4: ['rot', 'p4'] })], ['ts', 'dist']));
    expect(r.paramBindings['lift::w']).toBeTruthy();
    expect(r.paramBindings['rot::angle']).toBeTruthy();
    expect(r.paramBindings['rot::spin']).toBeTruthy();
  });
});

// ── The maths, on the CPU ─────────────────────────────────────────────────────

describe('hypersphere', () => {
  const dist = (p4: number[], radius: number) => runNode('hypersphereSDF', { radius }, { p4 }).nd_dist as number;

  it('is length(p4) - r', () => {
    for (const q of POINTS) expect(dist(q, 0.8)).toBeCloseTo(len(q) - 0.8, 5);
  });

  it('its slice at w = r is a single point (zero size)', () => {
    const r = 0.7;
    // The one 3D point with distance <= 0 at w = r is the origin, where the distance is exactly 0.
    expect(dist([0, 0, 0, r], r)).toBeCloseTo(0, 6);
    for (const q of POINTS) {
      if (len(q.slice(0, 3)) < 1e-3) continue;
      expect(dist([q[0], q[1], q[2], r], r)).toBeGreaterThan(0);
    }
    // Past it the slice is empty; before it, it is a ball of radius sqrt(r² - w²).
    expect(dist([0, 0, 0, r + 0.1], r)).toBeGreaterThan(0);
    const w = 0.4;
    expect(dist([Math.sqrt(r * r - w * w), 0, 0, w], r)).toBeCloseTo(0, 5);
    expect(dist([0, 0, 0, 0], r)).toBeCloseTo(-r, 6);
  });
});

describe('tesseract', () => {
  const dist = (p4: number[], size: number, rounding = 0) => runNode('tesseractSDF', { size, rounding }, { p4 }).nd_dist as number;
  const box3 = (p: number[], h: number) => {
    const d = p.map(v => Math.abs(v) - h);
    return len(d.map(v => Math.max(v, 0))) + Math.min(Math.max(...d), 0);
  };
  const roundedBox3 = (p: number[], h: number, r: number) => box3(p, h - r) - r;

  it('at w = 0 with no rotation its slice is the 3D box SDF', () => {
    for (const q of POINTS) expect(dist([q[0], q[1], q[2], 0], 0.6)).toBeCloseTo(box3(q.slice(0, 3), 0.6), 5);
  });

  it('rounding matches a rounded 3D box in the w = 0 slice', () => {
    for (const q of POINTS) expect(dist([q[0], q[1], q[2], 0], 0.6, 0.15)).toBeCloseTo(roundedBox3(q.slice(0, 3), 0.6, 0.15), 5);
  });

  it('is zero on the 4D faces and negative inside', () => {
    expect(dist([0.6, 0, 0, 0], 0.6)).toBeCloseTo(0, 6);
    expect(dist([0, 0, 0, 0.6], 0.6)).toBeCloseTo(0, 6);
    expect(dist([0, 0, 0, 0], 0.6)).toBeCloseTo(-0.6, 6);
    // Past the w face the slice is empty.
    expect(dist([0, 0, 0, 0.9], 0.6)).toBeGreaterThan(0);
  });

  it('turned 45 degrees in the xw plane, the slice at w = 0 reaches further along x than the cube does', () => {
    const rot = (p4: number[]) => runNode('rotate4D', { plane: 'xw', angle: 45 }, { p4 }).nd_p4 as number[];
    const at = (x: number) => dist(rot([x, 0, 0, 0]), 0.6);
    // On the x axis the turned point is (x cos, 0, 0, -x sin): the face is at x = 0.6 / cos45 = 0.849.
    expect(at(0.84)).toBeLessThan(0);
    expect(at(0.86)).toBeGreaterThan(0);
  });
});

describe('Rotate 4D', () => {
  const rot = (plane: string, angle: number, p4: number[], extra: Record<string, unknown> = {}, u_time = 0) => {
    const def = getNodeDefinition('rotate4D')!;
    const node = n('rotate4D', 'nd', 0, 0, { plane, angle, ...extra });
    const { code } = def.generateGLSL(node, { p4: 'in_p4' } as never);
    return compileFragment(`void main() {\n${code}\n}`).run({ u_time, in_p4: p4 } as never).nd_p4 as number[];
  };

  it.each([...ROTATION_PLANES_4D])('%s keeps lengths (orthonormal) at any angle', plane => {
    for (const a of [0, 17, 45, 90, 133, -60, 270]) for (const q of POINTS) expect(len(rot(plane, a, q))).toBeCloseTo(len(q), 5);
  });

  it.each([...ROTATION_PLANES_4D])('%s changes only its two axes, and undoing the angle returns the point', plane => {
    const idx = ['x', 'y', 'z', 'w'];
    for (const q of POINTS.slice(0, 10)) {
      const r = rot(plane, 37, q);
      idx.forEach((ax, i) => { if (!plane.includes(ax)) expect(r[i]).toBeCloseTo(q[i], 6); });
      const back = rot(plane, -37, r);
      back.forEach((v, i) => expect(v).toBeCloseTo(q[i], 5));
    }
  });

  it('a quarter turn in xw swaps x into w (the first axis turns toward the second)', () => {
    const r = rot('xw', 90, [1, 2, 3, 0]);
    // The point moves the opposite way, as Rotate 3D does: x -> -w.
    expect(r[0]).toBeCloseTo(0, 6); expect(r[3]).toBeCloseTo(-1, 6); expect(r[1]).toBe(2); expect(r[2]).toBe(3);
  });

  it('Spin adds time x spin degrees to the angle', () => {
    const a = rot('xw', 10, [1, 0, 0, 0], { spin: 20 }, 2);   // 10 + 20 * 2 = 50 degrees
    const b = rot('xw', 50, [1, 0, 0, 0]);
    a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));
  });
});

// ── The examples ──────────────────────────────────────────────────────────────

describe('4D examples', () => {
  it('are listed in a 4D folder', () => {
    const f = EXAMPLE_FOLDERS.find(x => x.label === '4D')!;
    expect(f.keys).toEqual(FOURD_EXAMPLE_KEYS);
    expect(FOURD_EXAMPLE_KEYS.length).toBe(14);
    for (const k of FOURD_EXAMPLE_KEYS) expect(EXAMPLE_GRAPHS[k].label).toBe(EXAMPLE_INDEX[k].label);
  });

  it.each(FOURD_EXAMPLE_KEYS)('%s compiles, uses the 4D nodes and has live Play controls', key => {
    const nodes = resolveNodeAliases(EXAMPLE_GRAPHS[key].nodes, getNodeDefinition);
    const r = compileGraph({ nodes });
    expect(r.errors ?? []).toEqual([]);
    expect(r.success).toBe(true);
    expect(r.fragmentShader).toContain('sdf4d_');
    const play = EXAMPLE_GRAPHS[key].play!;
    for (const part of ['**What it shows.**', '**How it is built.**', '**Try.**']) expect(play.notes, part).toContain(part);
    const live = new Set(collectPlayCandidates(nodes, r.paramBindings).map(c => c.target));
    for (const c of play.controls) expect(live.has(c.target), `${c.label} → ${c.target}`).toBe(true);
  });

  it('every node in the 4D examples carries a comment', () => {
    for (const key of FOURD_EXAMPLE_KEYS) {
      const walk = (ns: GraphNode[]) => ns.forEach(nd => {
        if (nd.params._groupOriginal) return;
        expect(nd.params.__comment, `${key}: ${nd.id}`).toBeTruthy();
        const sg = nd.params.subgraph as { nodes: GraphNode[] } | undefined;
        if (sg) walk(sg.nodes);
      });
      walk(EXAMPLE_GRAPHS[key].nodes.filter(nd => nd.type !== 'time' || nd.params.__comment));
    }
  });
});
