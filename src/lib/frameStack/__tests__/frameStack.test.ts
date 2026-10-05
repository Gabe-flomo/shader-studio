/**
 * Frame Stack (docs/frame-stack.md): the layout maths (each layout, the morph), scatter by seed,
 * the scan, the highlights' modular maths, the shuffle, the card-count caps, and how the node
 * compiles (one sampler, live uniforms, wires, cameras, only the code a setting needs). Golden
 * shaders for every other graph are compiler/__tests__/goldenShaders.test.ts, unchanged.
 */
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });

import {
  LAYOUTS, MAX_CARDS, cardCount, cardFrame, cross, dot, frameOf, gapShift, gridColumns, hash33, isHighlighted, layoutPose, length, mixPose, morphWeight,
  scanCardOf, scanWeight, scatterOf, sdRoundRect, shufflePlace, type ShapeSettings, type Vec3,
} from '../layout';
import { compileGraph } from '../../../compiler/graphCompiler';
import { buildFrameStackExamples, FRAME_STACK_EXAMPLE_KEYS } from '../../../store/frameStackExamples';
import { EXAMPLE_FOLDERS } from '../../../store/exampleIndex';
import { n } from '../../../store/graphBuilder';
import { planTimeCubeAdd } from '../../timeCube/autoWire';
import { buildMarchRig } from '../../../nodes/scene3dDefaults';
import { FRAME_STACK_DEFAULTS } from '../../../nodes/definitions/frameStack';
import type { GraphNode } from '../../../types/nodeGraph';

const SHAPE: ShapeSettings = { spacing: 0.1, radius: 2, twist: 0, arc: 1, tube: 0, windings: 0, turns: 1, fanAngle: 90, columns: 0 };
const HALF: [number, number] = [0.8, 0.45];
const close = (a: Vec3, b: Vec3, d = 6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], d));

describe('layouts', () => {
  it('stack: a line along z, centred, first card nearest +z, all facing +z', () => {
    const n = 11;
    const first = layoutPose('stack', 0, n, SHAPE, HALF), mid = layoutPose('stack', 5, n, SHAPE, HALF), last = layoutPose('stack', 10, n, SHAPE, HALF);
    close(first.pos, [0, 0, 0.5]);
    close(mid.pos, [0, 0, 0]);
    close(last.pos, [0, 0, -0.5]);
    close(mid.normal, [0, 0, 1]);
    close(mid.up, [0, 1, 0]);
  });

  it('fan: every card the radius from a pivot below, turned by its share of the fan angle', () => {
    const n = 5;
    for (let i = 0; i < n; i++) {
      const pz = layoutPose('fan', i, n, SHAPE, HALF);
      const fromPivot: Vec3 = [pz.pos[0], pz.pos[1] + SHAPE.radius, 0];
      expect(length(fromPivot)).toBeCloseTo(SHAPE.radius);
      const a = ((i - 2) / 4) * 90 * Math.PI / 180;
      close(pz.up, [-Math.sin(a), Math.cos(a), 0]);
    }
  });

  it('ring: on the circle; Face out 0 faces along the ring, 1 outward; a tube makes a torus', () => {
    const n = 12;
    for (let i = 0; i < n; i++) {
      const pz = layoutPose('ring', i, n, SHAPE, HALF);
      expect(Math.hypot(pz.pos[0], pz.pos[2])).toBeCloseTo(2);
      expect(Math.abs(dot(pz.normal, [pz.pos[0] / 2, 0, pz.pos[2] / 2]))).toBeLessThan(1e-9);
      const out = layoutPose('ring', i, n, { ...SHAPE, twist: 1 }, HALF);
      close(out.normal, [out.pos[0] / 2, 0, out.pos[2] / 2]);
    }
    // Arc 0.5: half the circle, so the middle card is a quarter of the way round.
    const half = layoutPose('ring', 6, 12, { ...SHAPE, arc: 0.5 }, HALF);
    close(half.pos, [2, 0, 0], 5);
    // Torus: every card the tube radius from the ring's centre line.
    for (let i = 0; i < 24; i++) {
      const pz = layoutPose('ring', i, 24, { ...SHAPE, tube: 0.5, windings: 3 }, HALF);
      const r = Math.hypot(pz.pos[0], pz.pos[2]);
      expect(Math.hypot(r - 2, pz.pos[1])).toBeCloseTo(0.5);
    }
  });

  it('helix: on a cylinder, rising Spacing a card, Turns times round', () => {
    const n = 9;
    const a = layoutPose('helix', 0, n, { ...SHAPE, turns: 1 }, HALF), b = layoutPose('helix', 8, n, { ...SHAPE, turns: 1 }, HALF);
    expect(Math.hypot(a.pos[0], a.pos[2])).toBeCloseTo(2);
    expect(b.pos[1] - a.pos[1]).toBeCloseTo(0.8);
    close([a.pos[0], 0, a.pos[2]], [b.pos[0], 0, b.pos[2]]);
  });

  it('grid: about square by default, Columns when set, cells a card and a gap apart', () => {
    expect(gridColumns(16, 0, 1)).toBe(4);
    expect(gridColumns(48, 0, 16 / 9)).toBe(5);
    expect(gridColumns(48, 6, 16 / 9)).toBe(6);
    const g = (i: number) => layoutPose('grid', i, 4, { ...SHAPE, columns: 2 }, HALF).pos;
    expect(g(0)[0] - g(1)[0]).toBeCloseTo(2 * HALF[0] + SHAPE.spacing);
    expect(g(0)[1] - g(2)[1]).toBeCloseTo(2 * HALF[1] + SHAPE.spacing);
    close([g(0)[0] + g(3)[0], g(0)[1] + g(3)[1], 0], [0, 0, 0]);
  });

  it('morph: 0 is the layout, 1 the target; Stagger sends the first cards first', () => {
    const A = layoutPose('stack', 3, 8, SHAPE, HALF), B = layoutPose('ring', 3, 8, SHAPE, HALF);
    close(mixPose(A, B, morphWeight(0, 0, 0.4)).pos, A.pos);
    close(mixPose(A, B, morphWeight(1, 0, 0.4)).pos, B.pos);
    expect(morphWeight(0.5, 0, 0.2)).toBeCloseTo(0.5);
    expect(morphWeight(0.5, 2, 0)).toBeGreaterThan(morphWeight(0.5, 2, 1));
    expect(morphWeight(1, 2, 1)).toBe(1);
    // Mid-morph the card's frame is still square.
    const f = frameOf(mixPose(A, B, 0.5));
    expect(length(f.normal)).toBeCloseTo(1);
    expect(dot(f.normal, f.up)).toBeCloseTo(0);
    close(f.right, cross(f.normal, f.up));
  });

  it('every layout gives finite poses for one card and for the most cards', () => {
    for (const l of LAYOUTS) for (const count of [1, MAX_CARDS]) {
      const pz = layoutPose(l, count - 1, count, SHAPE, HALF);
      for (const v of [...pz.pos, ...pz.normal, ...pz.up]) expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('scatter and drift', () => {
  const S = { position: 1, rotation: 0.5, spread: 1, seed: 7, drift: 0, driftSpeed: 0.1 };

  it('is the same for the same seed, different for another', () => {
    for (let i = 0; i < 20; i++) {
      expect(scatterOf(i, S, 0)).toEqual(scatterOf(i, S, 0));
      expect(scatterOf(i, S, 0).offset).not.toEqual(scatterOf(i, { ...S, seed: 8 }, 0).offset);
    }
    expect(scatterOf(1, S, 0).offset).not.toEqual(scatterOf(2, S, 0).offset);
  });

  it('Spread 0 is the tidy layout; offsets stay within Offset × Spread on each axis', () => {
    close(scatterOf(3, { ...S, spread: 0 }, 5).offset, [0, 0, 0]);
    close(scatterOf(3, { ...S, spread: 0 }, 5).turnN, [0, 0, 0]);
    for (let i = 0; i < 50; i++) for (const v of scatterOf(i, { ...S, spread: 0.5 }, 0).offset) expect(Math.abs(v)).toBeLessThanOrEqual(0.5);
  });

  it('drift wanders within Drift and comes back', () => {
    const D = { ...S, spread: 0, drift: 0.2, driftSpeed: 0.5 };
    for (let t = 0; t < 10; t += 0.37) for (const v of scatterOf(4, D, t).offset) expect(Math.abs(v)).toBeLessThanOrEqual(0.2 + 1e-9);
    expect(scatterOf(4, D, 0).offset).not.toEqual(scatterOf(4, D, 1).offset);
  });

  it('hash33 is in 0–1', () => {
    for (let i = 0; i < 200; i++) for (const v of hash33([i, 3, 1])) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });
});

describe('the scan', () => {
  it('Offset 0 is the first card, 1 the last', () => {
    expect(scanCardOf(0, 40)).toBe(0);
    expect(scanCardOf(1, 40)).toBe(39);
    expect(scanCardOf(2, 40)).toBe(39);
  });

  it('lifts the card at the scan fully, its neighbours less, the far ones not at all', () => {
    expect(scanWeight(10, 10, 0)).toBe(1);
    expect(scanWeight(10, 10.3, 0)).toBe(1);
    expect(scanWeight(11, 10, 0)).toBe(0);
    expect(scanWeight(12, 10, 3)).toBeGreaterThan(0);
    expect(scanWeight(12, 10, 3)).toBeLessThan(1);
    expect(scanWeight(20, 10, 3)).toBe(0);
  });

  it('the gap pushes cards away on each side, and keeps them in order', () => {
    expect(gapShift(5, 10, 4, 0)).toBe(-4);
    expect(gapShift(15, 10, 4, 0)).toBe(4);
    expect(gapShift(10, 10, 4, 0)).toBe(0);
    for (const sc of [3, 3.4, 3.5, 3.6]) {
      let prev = -Infinity;
      for (let i = 0; i < 10; i++) { const e = i + gapShift(i, sc, 3, 1); expect(e).toBeGreaterThan(prev); prev = e; }
    }
  });
});

describe('highlights', () => {
  const H = { frame: 2, count: 3, every: 4, loop: false };
  const lit = (n: number, sc: number, h = H) => Array.from({ length: n }, (_, i) => i).filter(i => isHighlighted(i, n, sc, h));

  it('Count cards, Every apart, from the first card', () => {
    expect(lit(20, 0)).toEqual([2, 6, 10]);
    expect(lit(20, 0, { ...H, count: 0 })).toEqual([]);
    expect(lit(20, 0, { ...H, every: 1, count: 2 })).toEqual([2, 3]);
    expect(lit(8, 0, { ...H, count: 10 })).toEqual([2, 6]);
  });

  it('with the scan: counted from the scan card, wrapping round the end', () => {
    expect(lit(20, 0, { ...H, loop: true })).toEqual([2, 6, 10]);
    expect(lit(20, 5, { ...H, loop: true })).toEqual([7, 11, 15]);
    expect(lit(20, 13, { ...H, loop: true })).toEqual([3, 15, 19]);
    // As the scan moves one card, the set moves one card.
    expect(lit(20, 13.6, { ...H, loop: true })).toEqual(lit(20, 14, { ...H, loop: true }));
  });
});

describe('cards', () => {
  it('the count is a whole number from 1 to MAX_CARDS', () => {
    expect(cardCount(48)).toBe(48);
    expect(cardCount(47.6)).toBe(48);
    expect(cardCount(0)).toBe(1);
    expect(cardCount(500)).toBe(MAX_CARDS);
    expect(cardCount('x')).toBe(48);
    expect(MAX_CARDS).toBe(128);
  });

  it('each card shows its own frame, an echo of the video, or one frame', () => {
    const o = { rate: 0, shift: 0, delay: 2, frozen: 0.5, time: 0 };
    expect([0, 1, 2, 3].map(i => cardFrame('own', i, 4, 64, o))).toEqual([0, 21, 42, 63]);
    expect(cardFrame('own', 0, 4, 64, { ...o, rate: 10, time: 1 })).toBe(10);
    expect(cardFrame('own', 3, 4, 64, { ...o, shift: 2 })).toBe(1);
    expect([0, 1, 2].map(i => cardFrame('echo', i, 3, 64, { ...o, rate: 24, time: 1 }))).toEqual([24, 22, 20]);
    expect([0, 5].map(i => cardFrame('frozen', i, 8, 64, o))).toEqual([32, 32]);
  });

  it('the rounded outline: inside negative, a square at corners 0, a capsule at full', () => {
    expect(sdRoundRect(0, 0, [1, 0.5], 0)).toBeCloseTo(-0.5);
    expect(sdRoundRect(1, 0.5, [1, 0.5], 0)).toBeCloseTo(0);
    expect(sdRoundRect(1, 0.5, [1, 0.5], 0.5)).toBeGreaterThan(0);
  });

  it('shuffle: every card its own place, and back', () => {
    for (const count of [1, 2, 3, 7, 40, 48, 100, 127, 128]) for (const seed of [0, 1, 3, 42]) {
      const places = Array.from({ length: count }, (_, i) => shufflePlace(i, count, seed));
      expect(new Set(places).size).toBe(count);
      for (const p of places) { expect(p).toBeGreaterThanOrEqual(0); expect(p).toBeLessThan(count); }
      for (let i = 0; i < count; i++) expect(shufflePlace(places[i], count, seed, true)).toBe(i);
    }
    // It does shuffle.
    const p = Array.from({ length: 40 }, (_, i) => shufflePlace(i, 40, 3));
    expect(p.filter((v, i) => v === i).length).toBeLessThan(10);
  });
});

describe('the node', () => {
  const ex = buildFrameStackExamples();

  it('every example compiles with one sampler (its Time Cube\'s), and every node has a note', () => {
    expect(Object.keys(ex).sort()).toEqual([...FRAME_STACK_EXAMPLE_KEYS].sort());
    expect(EXAMPLE_FOLDERS.find(f => f.label === 'Frame Stack')?.keys).toEqual(FRAME_STACK_EXAMPLE_KEYS);
    for (const [k, g] of Object.entries(ex)) {
      const r = compileGraph({ nodes: g.nodes });
      expect(r.errors ?? [], k).toEqual([]);
      expect(r.success, k).toBe(true);
      const samplers = Object.entries(r.textureUniforms);
      expect(samplers.length, k).toBe(1);
      expect(g.nodes.find(x => x.id === samplers[0][1])?.type).toBe('timeCube');
      expect(r.fragmentShader).toContain(`#define ${samplers[0][0]}_vol vec4(`);
      for (const nd of g.nodes) expect(typeof nd.params.__comment === 'string' && (nd.params.__comment as string).length > 10, `${k}/${nd.id}`).toBe(true);
    }
  });

  it('every slider is a live uniform (no recompile), colours too', () => {
    const nodes = [n('timeCube', 'src', 0, 0), n('frameStack', 'fs', 300, 0, { layoutB: 'ring', order: 'shuffle', dof: 'distance', playback: 'echo', projection: 'ortho' }, { volume: ['src', 'volume'] }), n('output', 'out', 600, 0, {}, { color: ['fs', 'color'] })];
    const r = compileGraph({ nodes });
    expect(r.success).toBe(true);
    const floats = ['morph', 'stagger', 'cards', 'spacing', 'radius', 'twist', 'arc', 'tube', 'windings', 'turns', 'fanAngle', 'columns', 'size', 'aspect', 'corner', 'thickness', 'opacity', 'border', 'shading',
      'spread', 'scatterPos', 'scatterRot', 'seed', 'drift', 'driftSpeed', 'scan', 'lift', 'pull', 'scanScale', 'tilt', 'gap', 'falloff', 'before',
      'hlCount', 'hlFrame', 'hlEvery', 'hlLift', 'hlScale', 'hlOutline', 'hlTint', 'dim', 'shuffle', 'shuffleSeed', 'focus', 'blur', 'maxBlur',
      'rate', 'shift', 'delay', 'brightness', 'contrast', 'camDist', 'viewSize', 'camAngle', 'camElevation', 'rotSpeed', 'fov',
      'borderColor', 'edgeColor', 'hlColor', 'background'];
    for (const k of floats) expect(r.paramBindings[`fs::${k}`], k).toBeTruthy();
    // The source's settings build the volume in JS: none of them is a uniform.
    expect(Object.keys(r.paramBindings).filter(b => b.startsWith('src::'))).toEqual([]);
  });

  it('a slider never changes the shader: two values compile to the same code', () => {
    const at = (params: Record<string, unknown>) => compileGraph({ nodes: [n('timeCube', 'src', 0, 0), n('frameStack', 'fs', 300, 0, params, { volume: ['src', 'volume'] }), n('output', 'out', 600, 0, {}, { color: ['fs', 'color'] })] }).fragmentShader;
    expect(at({ cards: 12, radius: 1, spread: 0.4, scan: 0.1, hlCount: 3 })).toBe(at({ cards: 128, radius: 3, spread: 0, scan: 0.9, hlCount: 0 }));
  });

  it('cards are drawn in one bounded loop, the count clamped to it; four layers composited', () => {
    const r = compileGraph({ nodes: ex.frameStackRing.nodes });
    expect(r.fragmentShader).toMatch(/for \(int framestack_\d+_k = 0; framestack_\d+_k < 128;/);
    expect(r.fragmentShader).toMatch(/floor\(clamp\(u_p_\w+_cards, 1\.0, 128\.0\) \+ 0\.5\)/);
    expect(r.fragmentShader).toMatch(/for \(int framestack_\d+_j = 0; framestack_\d+_j < 4;/);
  });

  it('Offset, Spread, Morph and Shuffle take wires in place of their sliders', () => {
    expect(compileGraph({ nodes: ex.frameStackIsometric.nodes }).fragmentShader).toMatch(/_sc = clamp\(lfo_\d+_value, 0\.0, 1\.0\)/);
    expect(compileGraph({ nodes: ex.frameStackDrift.nodes }).fragmentShader).toMatch(/_sprd = max\(lfo_\d+_value, 0\.0\)/);
    expect(compileGraph({ nodes: ex.frameStackMorph.nodes }).fragmentShader).toMatch(/_mo = clamp\(lfo_\d+_value, 0\.0, 1\.0\)/);
    expect(compileGraph({ nodes: ex.frameStackShuffle.nodes }).fragmentShader).toMatch(/_shf = clamp\(lfo_\d+_value, 0\.0, 1\.0\)/);
  });

  it('only writes the code a setting needs: the shuffle, depth of field, a morph', () => {
    const plain = compileGraph({ nodes: ex.frameStackRing.nodes }).fragmentShader;
    expect(plain).not.toContain('fsPerm');
    expect(plain).not.toContain('_cmx');
    expect(compileGraph({ nodes: ex.frameStackShuffle.nodes }).fragmentShader).toContain('float fsPerm(');
    expect(compileGraph({ nodes: ex.frameStackFocus.nodes }).fragmentShader).toContain('_cmx');
    expect(compileGraph({ nodes: ex.frameStackMorph.nodes }).fragmentShader).toMatch(/_mo \* \(1\.0 \+/);
  });

  it('with nothing wired to Volume it is its background, with no sampler', () => {
    const r = compileGraph({ nodes: [n('frameStack', 'fs', 0, 0), n('output', 'out', 300, 0, {}, { color: ['fs', 'color'] })] });
    expect(r.success).toBe(true);
    expect(r.textureUniforms).toEqual({});
    expect(r.fragmentShader).not.toContain('fsTile(u_');
  });

  it('two stacks of one Time Cube share its sampler and the helpers', () => {
    const nodes: GraphNode[] = [
      n('timeCube', 'src', 0, 0),
      n('frameStack', 'a', 300, 0, { layout: 'grid' }, { volume: ['src', 'volume'] }),
      n('frameStack', 'b', 300, 300, { layout: 'helix', layoutB: 'fan' }, { volume: ['src', 'volume'], background: ['a', 'color'] }),
      n('output', 'out', 600, 0, {}, { color: ['b', 'color'] }),
    ];
    const r = compileGraph({ nodes });
    expect(r.errors ?? []).toEqual([]);
    expect(Object.keys(r.textureUniforms)).toHaveLength(1);
    expect(r.fragmentShader.match(/vec2 fsTile\(/g)?.length).toBe(1);
  });

  it('every layout and morph pair compiles', () => {
    for (const a of LAYOUTS) for (const b of ['none', ...LAYOUTS]) {
      const r = compileGraph({ nodes: [n('timeCube', 'src', 0, 0), n('frameStack', 'fs', 300, 0, { layout: a, layoutB: b }, { volume: ['src', 'volume'] }), n('output', 'out', 600, 0, {}, { color: ['fs', 'color'] })] });
      expect(r.errors ?? [], `${a}→${b}`).toEqual([]);
    }
  });

  it('a March Camera\'s rays and a scene\'s distance replace the built-in camera and far limit', () => {
    const nodes: GraphNode[] = [
      n('timeCube', 'src', 0, 0),
      n('marchCamera', 'cam', 0, 300),
      n('constant', 'far', 0, 600, { value: 3 }),
      n('frameStack', 'fs', 300, 0, { projection: 'ortho' }, { volume: ['src', 'volume'], ro: ['cam', 'ro'], rd: ['cam', 'rd'], sceneDist: ['far', 'value'] }),
      n('output', 'out', 600, 0, {}, { color: ['fs', 'color'] }),
    ];
    const r = compileGraph({ nodes });
    expect(r.success).toBe(true);
    expect(r.fragmentShader).toMatch(/vec3 framestack_\d+_ro = marchcamer\w*_\d+_ro;/);
    expect(r.fragmentShader).not.toContain('_hz = vec3(sin(');
    expect(r.fragmentShader).toMatch(/_far = max\(\w+_\d+_value, 0\.0\);/);
  });

  it('defaults keep everything optional off: no scatter, highlights, shuffle or depth of field', () => {
    expect(FRAME_STACK_DEFAULTS).toMatchObject({ spread: 0, drift: 0, hlCount: 0, order: 'time', dof: 'off', layoutB: 'none' });
    expect(cardCount(FRAME_STACK_DEFAULTS.cards)).toBeLessThanOrEqual(48);
  });
});

describe('adding a Frame Stack', () => {
  let k = 0;
  const nextId = () => `id${++k}`;

  it('brings a Time Cube when there is none, and shows on a free Output', () => {
    const p = planTimeCubeAdd('frameStack', [n('output', 'out', 900, 0)], { x: 400, y: 0 }, nextId)!;
    const src = p.nodes.find(x => x.type === 'timeCube')!;
    const stack = p.nodes.find(x => x.id === p.id)!;
    expect(stack.type).toBe('frameStack');
    expect(stack.inputs.volume.connection).toEqual({ nodeId: src.id, outputKey: 'volume' });
    expect(p.nodes.find(x => x.id === 'out')!.inputs.color.connection).toEqual({ nodeId: stack.id, outputKey: 'color' });
    expect(compileGraph({ nodes: p.nodes }).success).toBe(true);
  });

  it('joins a ray-marched scene: its camera, its picture behind, its distance in front', () => {
    const rig = buildMarchRig(nextId, 'marchLoopGroup', { camera: { x: 0, y: 0 }, scene: { x: 300, y: 0 }, loop: { x: 600, y: 0 } });
    const o = n('output', 'out', 900, 0, {}, { color: [rig.loop.id, 'color'] });
    const p = planTimeCubeAdd('frameStack', [rig.camera, rig.scene, rig.loop, o], { x: 700, y: 300 }, nextId)!;
    const stack = p.nodes.find(x => x.id === p.id)!;
    expect(stack.inputs.ro.connection).toEqual({ nodeId: rig.camera.id, outputKey: 'ro' });
    expect(stack.inputs.background.connection).toEqual({ nodeId: rig.loop.id, outputKey: 'color' });
    expect(stack.inputs.sceneDist.connection).toEqual({ nodeId: rig.loop.id, outputKey: 'dist' });
    const r = compileGraph({ nodes: p.nodes });
    expect(r.errors ?? []).toEqual([]);
  });
});
