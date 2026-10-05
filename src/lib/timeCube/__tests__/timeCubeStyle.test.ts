/**
 * Time Cube View's look and the source's frame order (docs/time-cube.md, "Shape, glow and
 * highlights", "Flow", "Key pulse", "Depth of field", "Frame order and Frames from"): the maths in
 * lib/timeCube/style.ts and order.ts that the GLSL and the volume builder use, and how the view
 * compiles with them (every new slider a live uniform).
 */
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });

import {
  bump, combDistance, cornerRadius, coverage, flowPlace, flowTime, highlightComb, highlightTimes, hueTurn, keyVisibility,
  motionReach, moveUv, pulseBand, pulsePhase, rimGlow, roundBox, shapeDistance, stepInHighlight, warpUv,
} from '../style';
import {
  buildEstimate, combineFrames, combineKey, combineSettingsOf, frameMotion, frameOrder, frameStat, orderKey, orderSettingsOf, seededRandom,
  subFrameTimes, type FrameStat,
} from '../order';
import { volumeKey, baseVolumeKey } from '../volumes';
import { compileGraph } from '../../../compiler/graphCompiler';
import { buildTimeCubeExamples, TIME_CUBE_EXAMPLE_INDEX } from '../../../store/timeCubeExamples';
import { n } from '../../../store/graphBuilder';
import type { GraphNode } from '../../../types/nodeGraph';

const near = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('the shape', () => {
  const B = [0.9, 0.5, 0.8];
  it('roundness 0 is the plain box: inside negative, the distance to the nearest face; outside, to the box', () => {
    near(roundBox([0, 0, 0], B, 0), -0.5);
    near(roundBox([0.9, 0, 0], B, 0), 0);
    near(roundBox([1.2, 0, 0], B, 0), 0.3);
    near(roundBox([1.2, 0.9, 0], B, 0), Math.hypot(0.3, 0.4));
  });
  it('rounding pulls the corners in by r(√2 − 1) on an edge; the faces stay put', () => {
    const r = 0.2;
    near(roundBox([0.9, 0, 0], B, r), 0);
    // The point on the old sharp edge is outside the rounded one.
    near(roundBox([0.9, 0.5, 0], B, r), r * (Math.SQRT2 - 1));
    // Roundness 1 rounds by the smallest half size: a pill across the frame's height.
    expect(cornerRadius(1, B)).toBe(0.5);
    expect(cornerRadius(0.4, B)).toBeCloseTo(0.2);
    near(shapeDistance([0, 0.5, 0], B, 0.5, 0), 0);
    expect(shapeDistance([0.9, 0.5, 0], B, 0.5, 0)).toBeGreaterThan(0.2);
  });
  it('bulge puffs a face out at its middle, not at its rim', () => {
    expect(shapeDistance([0, 0.55, 0], B, 0, 0.1)).toBeLessThan(0);
    near(shapeDistance([0.9, 0.5, 0.8], B, 0, 0.1), 0, 1e-9);
  });
});

describe('edge softness and the rim', () => {
  it('coverage: whole deep inside, none outside, a ramp over the feather (never under a pixel)', () => {
    expect(coverage(-1, 0.1, 0.004)).toBe(1);
    expect(coverage(0.01, 0.1, 0.004)).toBe(0);
    const ramp = [0, -0.025, -0.05, -0.075, -0.1].map(md => coverage(md, 0.1, 0.004));
    for (let i = 1; i < ramp.length; i++) expect(ramp[i]).toBeGreaterThan(ramp[i - 1]);
    expect(ramp[4]).toBe(1);
    // Feather 0: one pixel wide, anti-aliased.
    expect(coverage(-0.004, 0, 0.004)).toBe(1);
    expect(coverage(-0.001, 0, 0.004)).toBeGreaterThan(0);
    expect(coverage(-0.001, 0, 0.004)).toBeLessThan(1);
  });
  it('the rim glow is brightest on the silhouette and the same either side of it', () => {
    expect(rimGlow(0, 0.5, 0.1)).toBe(0.5);
    near(rimGlow(0.1, 1, 0.1), rimGlow(-0.1, 1, 0.1));
    expect(rimGlow(0.5, 1, 0.1)).toBeLessThan(0.01);
  });
});

describe('highlights', () => {
  const N = 129; // frames: one frame is 1/128 of the box
  it('travel with the slice: the comb starts at Offset + Start frames, Spacing frames apart', () => {
    const c = highlightComb('loop', 0.5, 2, 5, 3, N);
    near(c.start, 0.5 + 2 / 128);
    near(c.spacing, 5 / 128);
    expect(highlightTimes(c).map(t => Math.round(t * 128))).toEqual([66, 71, 76]);
    // Fixed: counted from the first frame, whatever the slice.
    expect(highlightTimes(highlightComb('fixed', 0.9, 2, 5, 3, N)).map(t => Math.round(t * 128))).toEqual([2, 7, 12]);
  });
  it('loop: past the end of the box they wrap round to the front (modular), so a scan keeps meeting them', () => {
    const c = highlightComb('loop', 0.95, 0, 4, 3, N);
    expect(highlightTimes(c).map(t => Math.round(t * 128))).toEqual([2, 122, 126]);
    // The distance to the nearest highlighted frame wraps too.
    near(combDistance(0.0, c), 0.0 - (0.95 + 8 / 128 - 1), 1e-9);
    near(combDistance(0.95, c), 0, 1e-9);
    // Following without looping: the frames past the end are gone.
    expect(highlightTimes(highlightComb('follow', 0.95, 0, 4, 3, N)).map(t => Math.round(t * 128))).toEqual([122, 126]);
  });
  it('the signed distance to the nearest highlighted frame', () => {
    const c = highlightComb('fixed', 0, 10, 20, 4, N);
    near(combDistance(12 / 128, c), 2 / 128, 1e-9);
    near(combDistance(28 / 128, c), -2 / 128, 1e-9);
    // Beyond the last one, the last is nearest.
    near(combDistance(80 / 128, c), 10 / 128, 1e-9);
  });
  it('a ray crosses a whole highlighted frame however finely it is stepped', () => {
    const c = highlightComb('fixed', 0, 30, 20, 1, N);
    const thick = 2 / 128;
    for (const steps of [3, 7, 20]) {
      let crossed = 0;
      const a = 29 / 128, b = 33 / 128;
      for (let i = 0; i < steps; i++) crossed += stepInHighlight(a + (b - a) * i / steps, a + (b - a) * (i + 1) / steps, c, thick).crossed;
      near(crossed, 1, 1e-9);
    }
    const s = stepInHighlight(30 / 128 - 0.0001, 30 / 128 + 0.0001, c, thick);
    expect(s.share).toBe(1);
    expect(stepInHighlight(0.6, 0.7, c, thick).share).toBe(0);
  });
});

describe('frame motion', () => {
  it('the bump: 1 at the slice, easing to 0 at the falloff, the same either side', () => {
    expect(bump(0, 0.1)).toBe(1);
    near(bump(0.1, 0.1), 0);
    near(bump(0.2, 0.1), 0);
    near(bump(0.05, 0.1), 0.5);
    near(bump(-0.03, 0.1), bump(0.03, 0.1));
  });
  it('reading is the inverse of the move: a lifted, scaled, turned frame point reads back where it came from', () => {
    const m = { side: 0.2, up: 0.3, scale: 0.5, turn: 0.7 };
    for (const [u, v, b] of [[0.2, 0.3, 1], [0.9, 0.6, 0.4], [0.5, 0.5, 0]] as const) {
      const [mu, mv] = moveUv(u, v, b, m, 16 / 9);
      const [ru, rv] = warpUv(mu, mv, b, m, 16 / 9);
      near(ru, u, 1e-9); near(rv, v, 1e-9);
    }
    // Lift: the frame at the top of the bump reads its middle from half a lift below.
    const [, rv] = warpUv(0.5, 0.8, 1, { side: 0, up: 0.3, scale: 0, turn: 0 }, 1.5);
    near(rv, 0.5);
  });
  it('the march grows by how far moved frames reach', () => {
    expect(motionReach({ side: 0, up: 0, scale: 0, turn: 0 }, 1.78)).toBe(0);
    near(motionReach({ side: 0.1, up: -0.2, scale: 0.5, turn: 0 }, 2), 0.3 + 0.5);
  });
});

describe('flow', () => {
  it('the frame plays the clip, and the rest drifts through the box and wraps round', () => {
    near(flowTime(0.3, 0.3, 0.25), 0.25);
    near(flowTime(0.3, 0.3, 1.25), 0.25);
    // Behind the frame: later in the clip; in front: earlier.
    near(flowTime(0.5, 0.3, 0.25), 0.45);
    near(flowTime(0.1, 0.3, 0.25), 0.05);
    near(flowTime(0.0, 0.3, 0.25), 0.95);
    // A frame of the clip moves toward the front as the flow goes on, and comes round at the back.
    near(flowPlace(0.45, 0.3, 0.25), 0.5);
    near(flowPlace(0.45, 0.3, 0.35), 0.4);
    near(flowPlace(0.45, 0.3, 0.80), 0.95);
    for (const z of [0, 0.2, 0.77]) near(flowPlace(flowTime(z, 0.4, 3.3), 0.4, 3.3), z, 1e-9);
  });
});

describe('key pulse', () => {
  it('pulse bands: Count of them along the box, each Width of their spacing, moving with the phase', () => {
    const at = (phase: number) => Array.from({ length: 400 }, (_, i) => pulseBand((i + 0.5) / 400, 4, 0.25, 0, phase));
    const lit = at(0).filter(v => v > 0.5).length / 400;
    near(lit, 0.25, 0.015);
    // Phase 1 moves them one spacing on: the same picture.
    const a = at(0.3), b = at(1.3);
    for (let i = 0; i < a.length; i++) near(a[i], b[i], 1e-6);
    // Backward mirrors forward; Outward is symmetric about the slice.
    near(pulseBand(0.2, 3, 0.2, 0.3, 0.1, 'backward'), pulseBand(0.8, 3, 0.2, 0.3, 0.1, 'forward'));
    near(pulseBand(0.4, 3, 0.2, 0.3, 0.1, 'outward', 0.5), pulseBand(0.6, 3, 0.2, 0.3, 0.1, 'outward', 0.5));
  });
  it('bounce runs the phase up and back down', () => {
    near(pulsePhase('bounce', 0, 1, 0.5, 1), 0.5);
    near(pulsePhase('bounce', 0, 1, 1, 1), 1);
    near(pulsePhase('bounce', 0, 1, 1.5, 1), 0.5);
    near(pulsePhase('forward', 0.2, 0.5, 2, 3), 1.2);
  });
  it('visibility: Pulse 0 shows all of the key, Pulse 1 only the bands', () => {
    expect(keyVisibility(0, 0)).toBe(1);
    expect(keyVisibility(0, 1)).toBe(0);
    expect(keyVisibility(0.3, 0.5)).toBeCloseTo(0.65, 12);
  });
  it('the key colour turns round the wheel: a whole turn is the same colour, half a turn its opposite hue', () => {
    const c = [0.8, 0.2, 0.1];
    const whole = hueTurn(c, 1);
    for (let i = 0; i < 3; i++) near(whole[i], c[i], 1e-9);
    expect(hueTurn(c, 0.5)[2]).toBeGreaterThan(0.3);
  });
});

describe('frame order and frames from (the source)', () => {
  const stats = (vals: number[]): FrameStat[] => vals.map(v => ({ brightness: v, hue: 1 - v, saturation: v, motion: v, key: v }));
  it('time, reverse; shuffle is a permutation, the same for the same seed', () => {
    const o = orderSettingsOf({});
    expect(frameOrder(5, o)).toEqual([0, 1, 2, 3, 4]);
    expect(frameOrder(5, { ...o, order: 'reverse' })).toEqual([4, 3, 2, 1, 0]);
    const a = frameOrder(32, { ...o, order: 'shuffle', seed: 3 }), b = frameOrder(32, { ...o, order: 'shuffle', seed: 3 });
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual(Array.from({ length: 32 }, (_, i) => i));
    expect(a).not.toEqual(frameOrder(32, { ...o, order: 'shuffle', seed: 4 }));
    expect(seededRandom(9)()).toBe(seededRandom(9)());
  });
  it('sort: ascending by the chosen number, equal ones in time order; Invert flips it, still stable', () => {
    const o = { ...orderSettingsOf({}), order: 'sort' as const };
    const s = stats([0.5, 0.2, 0.9, 0.2, 0.1]);
    expect(frameOrder(5, o, s)).toEqual([4, 1, 3, 0, 2]);
    expect(frameOrder(5, { ...o, invert: true }, s)).toEqual([2, 0, 1, 3, 4]);
    expect(frameOrder(5, { ...o, sortBy: 'hue' }, s)).toEqual([2, 0, 1, 3, 4]);
  });
  it('combine: average, brightest, darkest, motion and median of small pictures', () => {
    const px = (...v: number[]) => new Uint8ClampedArray(v.flatMap(x => [x, x, x, 255]));
    const f = [px(10, 200), px(30, 100), px(20, 0)];
    const ch = (a: Uint8ClampedArray) => [a[0], a[4]];
    expect(ch(combineFrames(f, 'average'))).toEqual([20, 100]);
    expect(ch(combineFrames(f, 'max'))).toEqual([30, 200]);
    expect(ch(combineFrames(f, 'min'))).toEqual([10, 0]);
    expect(ch(combineFrames(f, 'difference'))).toEqual([20, 100]);
    expect(ch(combineFrames(f, 'median'))).toEqual([20, 100]);
    expect(ch(combineFrames([px(1, 1), px(9, 9), px(5, 5), px(7, 7)], 'median'))).toEqual([6, 6]);
    expect(combineFrames(f, 'average')[3]).toBe(255);
    // Pick: the middle one.
    expect(ch(combineFrames(f, 'pick'))).toEqual([30, 100]);
  });
  it('sub-frames spread over a tile\'s slot, inside the video', () => {
    expect(subFrameTimes(1, 0.4, 1, 10)).toEqual([1]);
    const t = subFrameTimes(1, 0.4, 4, 10);
    t.forEach((v, i) => near(v, 0.85 + 0.1 * i));
    expect(subFrameTimes(0.05, 0.4, 4, 10)[0]).toBe(0);
  });
  it('per-frame numbers: brightness, hue, saturation, key share; motion from the frames either side', () => {
    const red = new Uint8ClampedArray(Array.from({ length: 16 }, () => [255, 0, 0, 255]).flat());
    const { stat } = frameStat(red, { color: [1, 0, 0], tolerance: 0.1 }, 1);
    near(stat.brightness, 0.299, 1e-6);
    near(stat.saturation, 1);
    near(stat.hue, 0);
    near(stat.key, 1);
    const L = (v: number) => new Float32Array([v, v]);
    expect(frameMotion([L(0), L(0.5), L(0.5)])).toEqual([0.5, 0.25, 0]);
  });
  it('the defaults keep the old volume keys; a reorder keeps the same frames (base key) so nothing is decoded again', () => {
    expect(combineKey(combineSettingsOf({}))).toBe('');
    expect(orderKey(orderSettingsOf({}))).toBe('');
    const plain = n('timeCube', 'a', 0, 0);
    expect(volumeKey(plain)).toBe('demo|256x144|9x15|128|0.0000-4.0000');
    const sorted = n('timeCube', 'b', 0, 0, { order: 'sort', sortBy: 'motion' });
    expect(volumeKey(sorted)).not.toBe(volumeKey(plain));
    expect(baseVolumeKey(sorted)).toBe(baseVolumeKey(plain));
    const avg = n('timeCube', 'c', 0, 0, { combine: 'average', subFrames: 6 });
    expect(baseVolumeKey(avg)).toBe('demo|256x144|9x15|128|0.0000-4.0000|c:averagex6');
    expect(buildEstimate(128, 6, false)).toEqual({ decoded: 768, seconds: 768 * 0.026 });
  });
});

describe('the view compiles', () => {
  const ex = buildTimeCubeExamples();
  const LIVE = ['slice', 'before', 'after', 'sliceOpacity', 'tiltX', 'tiltY', 'roundness', 'feather', 'bulge', 'rimStrength', 'rimWidth', 'rimColor',
    'tintAmount', 'tintFrom', 'tintTo', 'shadow', 'shadowSoftness', 'shadowGap', 'hlCount', 'hlStart', 'hlSpacing', 'hlThickness', 'hlOpacity', 'hlTint',
    'hlColor', 'hlEdge', 'hlOthers', 'sendThrough', 'motionWidth', 'liftUp', 'liftSide', 'frameScale', 'frameTurn', 'frameFade',
    'timeFeather', 'featherSide', 'featherCurve', 'depth', 'size', 'brightness', 'contrast', 'darkClear', 'background', 'edgeWidth', 'edgeOpacity', 'sliceEdge', 'edgeColor',
    'camDist', 'camAngle', 'camElevation', 'rotSpeed', 'ortho', 'fov', 'camX', 'camY', 'camZ'];

  it('every new example compiles, has a note on every node, and is listed', () => {
    for (const k of ['timeCubeSoftPill', 'timeCubeHighlights', 'timeCubeFlow', 'timeCubePulse', 'timeCubeFlyThrough', 'timeCubeLongExposure']) {
      expect(TIME_CUBE_EXAMPLE_INDEX[k], k).toBeTruthy();
      const r = compileGraph({ nodes: ex[k].nodes });
      expect(r.errors ?? [], k).toEqual([]);
      expect(r.success, k).toBe(true);
      for (const nd of ex[k].nodes) expect(String(nd.params.__comment ?? '').length, `${k}/${nd.id}`).toBeGreaterThan(10);
    }
  });

  it('every look slider is a live uniform (no recompile), in slice and flow mode, with a key', () => {
    const nodes = (params: Record<string, unknown>): GraphNode[] => [
      n('timeCube', 'src', 0, 0),
      n('timeCubeView', 'v', 300, 0, params, { volume: ['src', 'volume'] }),
      n('output', 'out', 600, 0, {}, { color: ['v', 'color'] }),
    ];
    const slice = compileGraph({ nodes: nodes({ highlights: true, motion: true }) });
    for (const k of LIVE) expect(slice.paramBindings[`v::${k}`], k).toBeTruthy();
    const flow = compileGraph({ nodes: nodes({ timeMode: 'flow', keyMode: 'hue', keyAnimate: true, highlights: true }) });
    for (const k of ['framePos', 'flowSpeed', 'flowTime', 'keyColor', 'keyTolerance', 'keyHueShift', 'keyHueDrift', 'pulse', 'pulseSpeed', 'pulsePhase',
      'pulseCount', 'pulseWidth', 'pulseSoftness', 'hlStart', 'camX', 'camY', 'camZ']) {
      expect(flow.paramBindings[`v::${k}`], k).toBeTruthy();
    }
    expect(flow.fragmentShader).toContain('tcPulse(');
    expect(flow.fragmentShader).toMatch(/fract\(\w+_wv\.z \+ \w+_fsh\)/);
  });

  it('optional features stay out of the march until switched on (the plain view keeps its speed)', () => {
    const code = (params: Record<string, unknown>) => compileGraph({ nodes: [
      n('timeCube', 'src', 0, 0), n('timeCubeView', 'v', 300, 0, params, { volume: ['src', 'volume'] }), n('output', 'out', 600, 0, {}, { color: ['v', 'color'] }),
    ] });
    const off = code({});
    expect(off.fragmentShader).not.toMatch(/tcComb\(\w+_gm/);
    expect(off.fragmentShader).not.toMatch(/tcShapeAt\(\w+_pm/);
    for (const k of ['hlCount', 'liftUp']) expect(off.paramBindings[`v::${k}`], k).toBeUndefined();
    const on = code({ highlights: true, motion: true });
    expect(on.fragmentShader).toMatch(/tcComb\(\w+_gm/);
    expect(on.fragmentShader).toMatch(/tcShapeAt\(\w+_pm/);
  });

  it('Flow time takes a wire in place of its slider', () => {
    const r = compileGraph({ nodes: [
      n('timeCube', 'src', 0, 0),
      n('lfo', 'l', 0, 300),
      n('timeCubeView', 'v', 300, 0, { timeMode: 'flow' }, { volume: ['src', 'volume'], flowTime: ['l', 'value'] }),
      n('output', 'out', 600, 0, {}, { color: ['v', 'color'] }),
    ] });
    expect(r.success).toBe(true);
    expect(r.fragmentShader).toMatch(/_tau = lfo_\d+_value \+ u_time \*/);
  });

  it('choices change the code: the outline, the highlights\' anchor, the pulse direction', () => {
    const code = (params: Record<string, unknown>) => compileGraph({ nodes: [
      n('timeCube', 'src', 0, 0), n('timeCubeView', 'v', 300, 0, params, { volume: ['src', 'volume'] }), n('output', 'out', 600, 0, {}, { color: ['v', 'color'] }),
    ] }).fragmentShader;
    const plain = code({});
    expect(plain).not.toContain('tcRaySeg(u_');
    expect(code({ outline: 'edges' })).toMatch(/tcRaySeg\(\w+_ro, \w+_rd/);
    expect(code({ outline: 'silhouette' })).toMatch(/_eF = .*tcLine\(abs\(/);
    expect(code({ highlights: true, hlMode: 'fixed' })).toMatch(/_h0 = 0\.0 \+/);
    expect(code({ keyMode: 'luma', pulseDir: 'outward' })).toMatch(/tcPulse\(abs\(\w+_gv - \w+_sl0\)/);
  });

  it('the pulsing key\'s Play panel drives the key colour, its hue and the pulse, with an LFO on the hue', () => {
    const play = ex.timeCubePulse.play!;
    expect(play.controls.map(c => c.target)).toEqual(expect.arrayContaining(['tuView::keyColor', 'tuView::keyHueShift', 'tuView::keyHueDrift', 'tuView::keyTolerance']));
    expect(play.controls.find(c => c.target === 'tuView::keyColor')?.kind).toBe('color');
    expect(play.mappings[0].source.kind).toBe('lfo');
    const r = compileGraph({ nodes: ex.timeCubePulse.nodes });
    for (const c of play.controls) expect(r.paramBindings[c.target], c.target).toBeTruthy();
  });
});
