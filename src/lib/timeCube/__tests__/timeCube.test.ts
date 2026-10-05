/**
 * Time cube (docs/time-cube.md): frame-stack planning, the transfer function,
 * the slice plane, the box mapping, and how the nodes compile (samplers,
 * defines, live uniforms). The golden shaders for graphs without these nodes
 * are compiler/__tests__/goldenShaders.test.ts, unchanged.
 */
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });

import {
  ATLAS_MAX_SIDE, MAX_FRAMES, VOLUME_MAX_BYTES, atlasUv, boxHalf, boxToVolume, capText, keyMatch, opticalDepth, planFrameStack, rayBox,
  sliceSide, sliceTime, stackSettingsOf, stepAlpha, tileOrigin, voxelOpacity, type KeySettings, type StackSettings, type VoxelLook,
} from '../plan';
import { DEMO_META } from '../frames';
import { timeCubeMeta, timeCubePlan, volumeKey } from '../volumes';
import { compileGraph } from '../../../compiler/graphCompiler';
import { buildTimeCubeExamples } from '../../../store/timeCubeExamples';
import { n } from '../../../store/graphBuilder';
import { bakedVideoIds } from '../../bake/graphOps';
import { planTimeCubeAdd } from '../autoWire';
import { buildMarchRig } from '../../../nodes/scene3dDefaults';
import type { GraphNode } from '../../../types/nodeGraph';

const S = (o: Partial<StackSettings> = {}): StackSettings => ({ frames: 128, width: 256, start: 0, end: 0, spacing: 'count', step: 0.1, ...o });
const HD = { width: 1920, height: 1080, duration: 10 };

describe('frame-stack planning', () => {
  it('lays out the default stack: 256 × 144, 128 frames, a near-square atlas', () => {
    const p = planFrameStack(HD, S());
    expect([p.tileW, p.tileH, p.frames, p.capped]).toEqual([256, 144, 128, null]);
    expect(p.cols * p.rows).toBeGreaterThanOrEqual(128);
    expect(p.cols * (p.rows - 1)).toBeLessThan(128);
    expect([p.atlasW, p.atlasH]).toEqual([p.cols * 256, p.rows * 144]);
    expect(Math.max(p.atlasW, p.atlasH) / Math.min(p.atlasW, p.atlasH)).toBeLessThan(1.3);
    expect(p.bytes).toBe(p.atlasW * p.atlasH * 4);
    expect(p.bytes).toBeLessThan(21 * 1024 * 1024);
  });

  it('spreads frames evenly, each in the middle of its slot, from Start to End', () => {
    const p = planFrameStack(HD, S({ frames: 4, start: 2, end: 6 }));
    expect(p.times).toEqual([2.5, 3.5, 4.5, 5.5]);
    expect(p.every).toBe(1);
    const all = planFrameStack(HD, S({ frames: 10 }));
    expect(all.times[0]).toBeCloseTo(0.5);
    expect(all.times[9]).toBeCloseTo(9.5);
  });

  it('End 0 (or before Start) means the end of the video; Start is clamped into it', () => {
    expect(planFrameStack(HD, S({ start: 3, end: 0 })).end).toBe(10);
    expect(planFrameStack(HD, S({ start: 3, end: 2 })).end).toBe(10);
    expect(planFrameStack(HD, S({ start: 50 })).start).toBeLessThan(10);
    expect(planFrameStack(HD, S({ end: 99 })).end).toBe(10);
  });

  it('spacing by step: one frame every so many seconds', () => {
    const p = planFrameStack(HD, S({ spacing: 'step', step: 0.25 }));
    expect(p.requested).toBe(40);
    expect(p.frames).toBe(40);
    expect(p.every).toBeCloseTo(0.25);
  });

  it('caps: at most 256 frames, no more than the clip has, an atlas no bigger than 4096, memory under 64 MB', () => {
    const many = planFrameStack(HD, S({ spacing: 'step', step: 0.02 }));
    expect([many.frames, many.capped]).toEqual([MAX_FRAMES, 'frames']);
    const short = planFrameStack({ width: 640, height: 360, duration: 1 }, S({ frames: 200 }));
    expect([short.frames, short.capped]).toEqual([60, 'duration']);
    const big = planFrameStack(HD, S({ width: 512, frames: 256 }));
    expect(big.capped === 'atlas' || big.capped === 'memory').toBe(true);
    expect(big.frames * big.tileW * big.tileH * 4).toBeLessThanOrEqual(VOLUME_MAX_BYTES);
    expect(Math.max(big.atlasW, big.atlasH)).toBeLessThanOrEqual(ATLAS_MAX_SIDE);
    expect(capText(big)).toMatch(/^\d+ of 256 frames/);
    expect(capText(planFrameStack(HD, S()))).toBe('');
    // A tighter memory budget caps by memory.
    const mem = planFrameStack(HD, S(), { maxBytes: 8 * 1024 * 1024 });
    expect(mem.capped).toBe('memory');
    expect(mem.frames * mem.tileW * mem.tileH * 4).toBeLessThanOrEqual(8 * 1024 * 1024);
  });

  it('tiles are whole blocks of 8 pixels and keep the video\'s shape', () => {
    for (const [w, h] of [[1920, 1080], [1080, 1920], [640, 480], [1000, 1000], [3840, 1600]]) {
      const p = planFrameStack({ width: w, height: h, duration: 5 }, S());
      expect(p.tileW % 8).toBe(0);
      expect(p.tileH % 8).toBe(0);
      expect(Math.abs(p.tileW / p.tileH - w / h) / (w / h)).toBeLessThan(0.06);
      expect(p.aspect).toBeCloseTo(w / h);
      expect(Math.max(p.atlasW, p.atlasH)).toBeLessThanOrEqual(ATLAS_MAX_SIDE);
    }
  });

  it('reads a node\'s settings defensively', () => {
    expect(stackSettingsOf({})).toEqual({ frames: 128, width: 256, start: 0, end: 0, spacing: 'count', step: 1 / 30 });
    expect(stackSettingsOf({ frames: 9999, frameWidth: '384', start: -4, spacing: 'step', step: 0 })).toMatchObject({ frames: 256, width: 384, start: 0, spacing: 'step' });
    expect(stackSettingsOf({ frames: 'x', frameWidth: 'big' }).frames).toBe(128);
  });

  it('a frame\'s tile on the canvas is where the shader reads it (texture flipped, v up)', () => {
    const p = planFrameStack(HD, S());
    for (const f of [0, 1, p.cols - 1, p.cols, 77, p.frames - 1]) {
      const o = tileOrigin(p, f);
      for (const [u, v] of [[0.5, 0.5], [0.1, 0.9], [0.9, 0.1]]) {
        const [x, y] = atlasUv(p, f, u, v);
        // Canvas pixel from the flipped texture coordinate: y down from the top.
        const px = x * p.atlasW, py = (1 - y) * p.atlasH;
        expect(px).toBeCloseTo(o.x + u * p.tileW, 6);
        expect(py).toBeCloseTo(o.y + (1 - v) * p.tileH, 6);
      }
    }
  });
});

describe('transfer function', () => {
  it('opacity is what the region hides looking through its whole length in time', () => {
    expect(opticalDepth(0)).toBe(0);
    for (const o of [0.05, 0.3, 0.5, 0.9]) expect(stepAlpha(o, 2, 2)).toBeCloseTo(o, 9);
    // Split into steps, it adds up to the same.
    const a = stepAlpha(0.3, 0.1, 2);
    expect(1 - (1 - a) ** 20).toBeCloseTo(0.3, 9);
  });

  it('rises steadily and is a hard surface at 1', () => {
    let last = -1;
    for (let o = 0; o <= 1.0001; o += 0.01) { const d = opticalDepth(o); expect(d).toBeGreaterThanOrEqual(last); last = d; }
    expect(opticalDepth(0.95 + 1e-9)).toBeCloseTo(opticalDepth(0.95), 5);
    expect(stepAlpha(1, 0.01, 1.6)).toBeGreaterThan(0.99);
    expect(opticalDepth(2)).toBe(opticalDepth(1));
  });

  const key = (o: Partial<KeySettings> = {}): KeySettings => ({ mode: 'off', color: [0.85, 0.12, 0.12], tolerance: 0.08, softness: 0.06, lumaLo: 0.6, lumaHi: 1, ...o });
  const look = (o: Partial<VoxelLook> = {}): VoxelLook => ({ before: 0.2, after: 1, darkClear: 0, key: key(), keyOpacity: 1, othersOpacity: 0.2, ...o });
  const RED = [0.85, 0.12, 0.12], DARK_RED = [0.45, 0.05, 0.06], GREY = [0.5, 0.5, 0.5], BLUE = [0.16, 0.44, 0.88], BLACK = [0, 0, 0];

  it('before the slice: Before opacity; after it: After opacity', () => {
    expect(voxelOpacity(GREY, -0.1, look())).toBe(0.2);
    expect(voxelOpacity(GREY, 0.1, look())).toBe(1);
  });

  it('Dark is clear thins dark voxels', () => {
    expect(voxelOpacity(BLACK, 0.1, look({ darkClear: 1 }))).toBe(0);
    expect(voxelOpacity([1, 1, 1], 0.1, look({ darkClear: 1 }))).toBe(1);
    expect(voxelOpacity(BLACK, 0.1, look({ darkClear: 0.5 }))).toBeCloseTo(0.5);
  });

  it('a key keeps its colour solid on both sides and fades the rest', () => {
    const L = look({ key: key({ mode: 'hue' }) });
    expect(voxelOpacity(RED, -0.3, L)).toBeCloseTo(1);
    expect(voxelOpacity(DARK_RED, -0.3, L)).toBeCloseTo(1);
    expect(voxelOpacity(GREY, -0.3, L)).toBeCloseTo(0.2 * 0.2);
    expect(voxelOpacity(BLUE, 0.3, L)).toBeCloseTo(1 * 0.2);
  });

  it('key modes: a colour, a hue at any brightness, a brightness range', () => {
    expect(keyMatch(RED, key({ mode: 'color' }))).toBe(1);
    expect(keyMatch(DARK_RED, key({ mode: 'color' }))).toBe(0);
    expect(keyMatch(DARK_RED, key({ mode: 'hue' }))).toBe(1);
    expect(keyMatch(GREY, key({ mode: 'hue' }))).toBe(0);
    expect(keyMatch(BLUE, key({ mode: 'hue' }))).toBe(0);
    // Hue wraps round: a red just the other side of 0 matches.
    expect(keyMatch([0.85, 0.12, 0.2], key({ mode: 'hue' }))).toBeGreaterThan(0.9);
    expect(keyMatch([0.9, 0.9, 0.9], key({ mode: 'luma' }))).toBe(1);
    expect(keyMatch([0.2, 0.2, 0.2], key({ mode: 'luma' }))).toBe(0);
    expect(keyMatch(RED, key())).toBe(0);
  });
});

describe('slice plane and box', () => {
  it('Offset is the slice\'s time; tilts make time run across the frame', () => {
    expect(sliceTime(0.5, 0.5, 0.4, 30, -20)).toBeCloseTo(0.4);
    expect(sliceTime(0, 0.5, 0.5, 45, 0)).toBeCloseTo(0);
    expect(sliceTime(1, 0.5, 0.5, 45, 0)).toBeCloseTo(1);
    expect(sliceTime(0.5, 1, 0.5, 0, -45)).toBeCloseTo(0);
    expect(sliceSide(0.5, 0.5, 0.3, 0.5, 0, 0)).toBeLessThan(0);
    expect(sliceSide(0.5, 0.5, 0.7, 0.5, 0, 0)).toBeGreaterThan(0);
    // Clamped short of 90°.
    expect(Number.isFinite(sliceTime(1, 0.5, 0.5, 90, 0))).toBe(true);
  });

  it('the box: frame aspect wide, 1 high, time stretched along the stack axis', () => {
    expect(boxHalf('z', 16 / 9, 1.6, 1)).toEqual([8 / 9, 0.5, 0.8]);
    expect(boxHalf('x', 2, 3, 2)).toEqual([3, 1, 2]);
    expect(boxHalf('y', 2, 3, 2)).toEqual([2, 3, 1]);
  });

  it('time starts at the face toward the default camera; frames read the right way round from there', () => {
    // A ray from the front (+z) straight in: enters at t = 0, leaves at t = 1.
    const half = boxHalf('z', 16 / 9, 1.6, 1);
    const hit = rayBox([0, 0, 5], [0, 0, -1], half)!;
    expect(hit[0]).toBeCloseTo(5 - 0.8);
    expect(hit[1]).toBeCloseTo(5 + 0.8);
    const q = (z: number) => [0.5, 0.5, (z + half[2]) / (2 * half[2])];
    expect(boxToVolume('z', q(0.8))[2]).toBeCloseTo(0);
    expect(boxToVolume('z', q(-0.8))[2]).toBeCloseTo(1);
    // Screen right is −x for the app's cameras looking down −z, so u grows toward −x.
    expect(boxToVolume('z', [0, 0.5, 1])[0]).toBe(1);
    expect(boxToVolume('x', [1, 0.5, 0.25])).toEqual([0.25, 0.5, 0]);
    expect(boxToVolume('y', [0.25, 1, 0])).toEqual([0.75, 1, 0]);
    expect(rayBox([0, 0, 5], [0, 1, 0], half)).toBeNull();
  });
});

describe('nodes', () => {
  const ex = buildTimeCubeExamples();

  it('every example compiles, with one sampler per Time Cube and its layout defines', () => {
    for (const [k, g] of Object.entries(ex)) {
      const r = compileGraph({ nodes: g.nodes });
      expect(r.success, k).toBe(true);
      const samplers = Object.entries(r.textureUniforms);
      expect(samplers.length, k).toBe(1);
      const [name, id] = samplers[0];
      expect(g.nodes.find(x => x.id === id)?.type).toBe('timeCube');
      expect(r.fragmentShader.match(new RegExp(`uniform sampler2D ${name};`, 'g'))?.length).toBe(1);
      expect(r.fragmentShader).toContain(`#define ${name}_vol vec4(`);
      expect(r.fragmentShader).toContain(`#define ${name}_volpx vec2(`);
      expect(r.videoUniforms).toEqual({});
      // Every node carries a note.
      for (const nd of g.nodes) expect(typeof nd.params.__comment === 'string' && (nd.params.__comment as string).length > 10, `${k}/${nd.id}`).toBe(true);
    }
  });

  it('the layout define is the plan: columns, rows, frames, aspect', () => {
    const r = compileGraph({ nodes: ex.timeCubeBox.nodes });
    const p = planFrameStack(DEMO_META, stackSettingsOf({}));
    expect(r.fragmentShader).toMatch(new RegExp(`_vol vec4\\(${p.cols}\\.0, ${p.rows}\\.0, ${p.frames}\\.0, 1\\.7777`));
  });

  it('two views and a slice of one Time Cube share its one sampler', () => {
    const nodes: GraphNode[] = [
      n('timeCube', 'src', 0, 0),
      n('timeCubeView', 'v2', 300, 300, { axis: 'y', keyMode: 'luma' }, { volume: ['src', 'volume'] }),
      n('timeSlice', 's', 300, 600, { mode: 'row' }, { volume: ['src', 'volume'] }),
      n('add', 'a1', 600, 300, {}, { a: ['v2', 'alpha'], b: ['s', 'value'] }),
      n('timeCubeView', 'v1', 800, 0, {}, { volume: ['src', 'volume'], slice: ['a1', 'result'] }),
      n('output', 'out', 1000, 0, {}, { color: ['v1', 'color'] }),
    ];
    const r = compileGraph({ nodes });
    expect(r.errors ?? []).toEqual([]);
    expect(r.success).toBe(true);
    expect(Object.keys(r.textureUniforms)).toHaveLength(1);
    expect(r.fragmentShader.match(/uniform sampler2D u_tex_/g)?.length).toBe(1);
    // The shared helpers are written once.
    expect(r.fragmentShader.match(/vec3 tcSample\(/g)?.length).toBe(1);
  });

  it('with nothing wired to Volume, the view is its background and the slice black: no sampler', () => {
    const r = compileGraph({ nodes: [n('timeCubeView', 'v', 0, 0), n('output', 'out', 300, 0, {}, { color: ['v', 'color'] })] });
    expect(r.success).toBe(true);
    expect(r.textureUniforms).toEqual({});
    expect(r.fragmentShader).not.toContain('tcSample(u_');
  });

  it('every slider of the view and the slice is a live uniform (no recompile), colours too', () => {
    const r = compileGraph({ nodes: ex.timeCubeKey.nodes });
    for (const k of ['slice', 'before', 'after', 'sliceOpacity', 'tiltX', 'tiltY', 'depth', 'size', 'brightness', 'contrast', 'darkClear', 'background',
      'keyColor', 'keyTolerance', 'keySoftness', 'keyOpacity', 'othersOpacity', 'othersGrey', 'edgeWidth', 'edgeOpacity', 'sliceEdge', 'edgeColor',
      'camDist', 'camAngle', 'camElevation', 'rotSpeed', 'fov']) {
      expect(r.paramBindings[`tkView::${k}`], k).toBeTruthy();
    }
    const s = compileGraph({ nodes: ex.timeCubeSlitScan.nodes });
    for (const k of ['slice', 'tiltX', 'tiltY', 'delayAmount', 'brightness', 'contrast']) expect(s.paramBindings[`tsSlice::${k}`], k).toBeTruthy();
    // The source's settings build the volume in JS: none of them is a uniform.
    expect(Object.keys(r.paramBindings).filter(b => b.startsWith('tkSource::'))).toEqual([]);
  });

  it('Offset takes a wire (Time, an LFO) in place of its slider', () => {
    const r = compileGraph({ nodes: ex.timeCubeBox.nodes });
    expect(r.fragmentShader).toMatch(/float timecubevi_\d+_sl0 = lfo_\d+_value;/);
  });

  it('a March Camera\'s rays and a scene\'s distance replace the built-in camera and far limit', () => {
    const nodes: GraphNode[] = [
      n('timeCube', 'src', 0, 0),
      n('marchCamera', 'cam', 0, 300),
      n('constant', 'far', 0, 600, { value: 3 }),
      n('timeCubeView', 'v', 300, 0, {}, { volume: ['src', 'volume'], ro: ['cam', 'ro'], rd: ['cam', 'rd'], sceneDist: ['far', 'value'] }),
      n('output', 'out', 600, 0, {}, { color: ['v', 'color'] }),
    ];
    const r = compileGraph({ nodes });
    expect(r.success).toBe(true);
    expect(r.fragmentShader).toMatch(/vec3 timecubevi_\d+_ro = marchcamer\w*_\d+_ro;/);
    expect(r.fragmentShader).not.toContain('_hz = vec3(sin(');
    expect(r.fragmentShader).toMatch(/_scn = max\(\w+_\d+_value, 0\.0\);/);
  });
});

describe('adding a view or a slice', () => {
  let k = 0;
  const nextId = () => `id${++k}`;
  const out = () => n('output', 'out', 900, 0);

  it('brings a Time Cube when there is none, and shows on a free Output', () => {
    const p = planTimeCubeAdd('timeCubeView', [out()], { x: 400, y: 0 }, nextId)!;
    const src = p.nodes.find(x => x.type === 'timeCube')!;
    const view = p.nodes.find(x => x.id === p.id)!;
    expect(view.inputs.volume.connection).toEqual({ nodeId: src.id, outputKey: 'volume' });
    expect(p.nodes.find(x => x.id === 'out')!.inputs.color.connection).toEqual({ nodeId: view.id, outputKey: 'color' });
    expect(compileGraph({ nodes: p.nodes }).success).toBe(true);
  });

  it('reads the Time Cube already there, and leaves an Output that shows something else alone', () => {
    const before = [n('timeCube', 'cube', 0, 0), n('uv', 'u', 0, 300), n('output', 'out', 900, 0, {}, { color: ['u', 'uv'] })];
    const p = planTimeCubeAdd('timeSlice', before, { x: 400, y: 0 }, nextId)!;
    expect(p.nodes.filter(x => x.type === 'timeCube')).toHaveLength(1);
    expect(p.nodes.find(x => x.id === p.id)!.inputs.volume.connection?.nodeId).toBe('cube');
    expect(p.nodes.find(x => x.id === 'out')!.inputs.color.connection?.nodeId).toBe('u');
  });

  it('joins a ray-marched scene: its camera, its picture behind, its distance in front', () => {
    const rig = buildMarchRig(nextId, 'marchLoopGroup', { camera: { x: 0, y: 0 }, scene: { x: 300, y: 0 }, loop: { x: 600, y: 0 } });
    const o = n('output', 'out', 900, 0, {}, { color: [rig.loop.id, 'color'] });
    const p = planTimeCubeAdd('timeCubeView', [rig.camera, rig.scene, rig.loop, o], { x: 700, y: 300 }, nextId)!;
    const view = p.nodes.find(x => x.id === p.id)!;
    expect(view.inputs.ro.connection).toEqual({ nodeId: rig.camera.id, outputKey: 'ro' });
    expect(view.inputs.rd.connection).toEqual({ nodeId: rig.camera.id, outputKey: 'rd' });
    expect(view.inputs.background.connection).toEqual({ nodeId: rig.loop.id, outputKey: 'color' });
    expect(view.inputs.sceneDist.connection).toEqual({ nodeId: rig.loop.id, outputKey: 'dist' });
    expect(p.nodes.find(x => x.id === 'out')!.inputs.color.connection?.nodeId).toBe(view.id);
    const r = compileGraph({ nodes: p.nodes });
    expect(r.errors ?? []).toEqual([]);
    expect(r.success).toBe(true);
  });

  it('only for the view and the slice', () => {
    expect(planTimeCubeAdd('timeCube', [], { x: 0, y: 0 }, nextId)).toBeNull();
    expect(planTimeCubeAdd('circle', [], { x: 0, y: 0 }, nextId)).toBeNull();
  });
});

describe('the source node', () => {
  it('the test clip needs no file; a library video needs its size before it can plan', () => {
    const demo = n('timeCube', 'a', 0, 0);
    expect(timeCubeMeta(demo)).toEqual(DEMO_META);
    expect(timeCubePlan(demo)?.frames).toBe(128);
    expect(volumeKey(demo)).toMatch(/^demo\|256x144\|/);
    const lib = n('timeCube', 'b', 0, 0, { source: 'library', videoId: 'vid_1' });
    expect(timeCubePlan(lib)).toBeNull();
    expect(volumeKey(lib)).toBeNull();
    const ready = n('timeCube', 'c', 0, 0, { source: 'library', videoId: 'vid_1', _meta: { width: 1280, height: 720, duration: 8 } });
    expect(volumeKey(ready)).toMatch(/^vid:vid_1\|256x144\|/);
    // Settings that make the same stack share one build; a different one doesn't.
    expect(volumeKey(n('timeCube', 'd', 0, 0, { source: 'library', videoId: 'vid_1', _meta: { width: 1280, height: 720, duration: 8 } }))).toBe(volumeKey(ready));
    expect(volumeKey(n('timeCube', 'e', 0, 0, { source: 'library', videoId: 'vid_1', frames: 64, _meta: { width: 1280, height: 720, duration: 8 } }))).not.toBe(volumeKey(ready));
  });

  it('counts as a use of its Library video (Clean up keeps it)', () => {
    expect(bakedVideoIds([n('timeCube', 'a', 0, 0, { source: 'library', videoId: 'vid_9' }), n('timeCube', 'b', 0, 0)])).toEqual(['vid_9']);
  });
});
