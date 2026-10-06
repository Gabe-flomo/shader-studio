/**
 * The clip editor's settings (lib/media/clip.ts) and how the Time Cube plans with them: sample
 * times with segments (proportional and equal), reverse, speed ramp, rounding and boundaries; the
 * Start / End migration; crop and rotate maths; and the volume key following the clip.
 */
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });

import {
  allocateFrames, clipDrawParams, clipOutputSize, clipParams, clipSettingsOf, cleanCrop, cleanTransform, defaultClip, outputToSource,
  planSampleTimes, rampPosition, resolveSegments, sourceToOutput, type ClipTransform,
} from '../../media/clip';
import { planFrameStack, stackSettingsOf } from '../plan';
import { volumeKey, baseVolumeKey } from '../volumes';
import { migrateTimeCubeSource, TimeCubeNode, TIME_CUBE_SOURCE_VERSION } from '../../../nodes/definitions/timeCube';
import { migrateNodeParams, type GraphNode } from '../../../types/nodeGraph';
import { getNodeDefinition } from '../../../nodes/definitions';
import { n } from '../../../store/graphBuilder';

const HD = { width: 1920, height: 1080, duration: 10 };
const seg = (a: number, b: number, reverse = false) => ({ in: a, out: b, reverse });
const near = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9));

describe('sharing frames between segments', () => {
  it('proportional: by length, adding up exactly (largest remainder), at least one each', () => {
    expect(allocateFrames([1, 1], 10, 'proportional')).toEqual([5, 5]);
    expect(allocateFrames([3, 1], 8, 'proportional')).toEqual([6, 2]);
    const got = allocateFrames([1, 1, 1], 128, 'proportional');
    expect(got.reduce((a, b) => a + b)).toBe(128);
    expect(Math.max(...got) - Math.min(...got)).toBeLessThanOrEqual(1);
    // A tiny segment still gets a frame.
    expect(allocateFrames([9.99, 0.01], 10, 'proportional')).toEqual([9, 1]);
  });
  it('equal: the same each, the first ones take the remainder', () => {
    expect(allocateFrames([5, 1, 1], 10, 'equal')).toEqual([4, 3, 3]);
    expect(allocateFrames([5, 1], 128, 'equal')).toEqual([64, 64]);
  });
  it('fewer frames than segments: one each from the first', () => {
    expect(allocateFrames([1, 1, 1], 2, 'proportional')).toEqual([1, 1, 0]);
    expect(allocateFrames([], 4, 'equal')).toEqual([]);
  });
});

describe('sample times', () => {
  it('one plain segment: start + (i + ½) × span / n, as the Time Cube always planned', () => {
    const p = planSampleTimes([seg(2, 6)], 4, 'proportional', 'none');
    near(p.times, [2.5, 3.5, 4.5, 5.5]);
    near(p.slots, [1, 1, 1, 1]);
    expect(p.span).toBe(4);
  });
  it('segments play one after another, each with its share of the frames', () => {
    const p = planSampleTimes([seg(0, 3), seg(8, 9)], 8, 'proportional', 'none');
    expect(p.segments.map(s => [s.first, s.frames])).toEqual([[0, 6], [6, 2]]);
    near(p.times, [0.25, 0.75, 1.25, 1.75, 2.25, 2.75, 8.25, 8.75]);
    // Proportional keeps the spacing the same in both: the frames flow at one speed.
    expect(p.slots[0]).toBeCloseTo(p.slots[7], 9);
  });
  it('equal frames per segment: a short one is sampled densely', () => {
    const p = planSampleTimes([seg(0, 3), seg(8, 9)], 8, 'equal', 'none');
    near(p.times, [0.375, 1.125, 1.875, 2.625, 8.125, 8.375, 8.625, 8.875]);
  });
  it('a reversed segment runs from its out back to its in', () => {
    const p = planSampleTimes([seg(0, 2), seg(4, 6, true)], 4, 'proportional', 'none');
    near(p.times, [0.5, 1.5, 5.5, 4.5]);
  });
  it('the order of segments is the order of frames, not their place in the video', () => {
    const p = planSampleTimes([seg(5, 6), seg(0, 1)], 2, 'proportional', 'none');
    near(p.times, [5.5, 0.5]);
  });
  it('speed ramp: ease-in is dense at the start, ease-out at the end; slots still cover the segment', () => {
    const inn = planSampleTimes([seg(0, 10)], 10, 'proportional', 'easeIn');
    const out = planSampleTimes([seg(0, 10)], 10, 'proportional', 'easeOut');
    expect(inn.times[1] - inn.times[0]).toBeLessThan(inn.times[9] - inn.times[8]);
    expect(out.times[1] - out.times[0]).toBeGreaterThan(out.times[9] - out.times[8]);
    for (const p of [inn, out]) {
      expect(p.slots.reduce((a, b) => a + b)).toBeCloseTo(10, 9);
      for (let i = 1; i < p.times.length; i++) expect(p.times[i]).toBeGreaterThan(p.times[i - 1]);
      expect(p.times[0]).toBeGreaterThan(0); expect(p.times[9]).toBeLessThan(10);
    }
    // A reversed, ramped segment is dense at the start of its playing (the out end in the video).
    const rev = planSampleTimes([seg(0, 10, true)], 10, 'proportional', 'easeIn');
    expect(rev.times[0] - rev.times[1]).toBeLessThan(rev.times[8] - rev.times[9]);
    expect([rampPosition(0, 'easeIn'), rampPosition(1, 'easeOut'), rampPosition(0.5, 'none')]).toEqual([0, 1, 0.5]);
  });
  it('places segments in the video: out at or before in runs to the end, clamps, drops empties', () => {
    expect(resolveSegments([seg(3, 0)], 10)).toEqual([seg(3, 10)]);
    expect(resolveSegments([seg(3, 2)], 10)).toEqual([seg(3, 10)]);
    expect(resolveSegments([seg(2, 99)], 10)).toEqual([seg(2, 10)]);
    expect(resolveSegments([seg(1, 1.00001), seg(4, 5)], 10)).toEqual([seg(4, 5)]);
    expect(resolveSegments([seg(50, 60)], 10)[0].in).toBeLessThan(10);
    // Nothing left: the whole video.
    expect(resolveSegments([seg(1, 1.00001)], 10)).toEqual([seg(0, 10)]);
  });
});

describe('Time Cube planning with a clip', () => {
  const clip = (o: Partial<ReturnType<typeof defaultClip>> = {}) => ({ ...defaultClip(), ...o });
  it('the plan has exactly Frames times, inside the kept segments', () => {
    const s = { ...stackSettingsOf({ frames: 101 }), clip: clip({ segments: [seg(1, 2), seg(6, 9, true), seg(3, 3.5)] }) };
    const p = planFrameStack(HD, s);
    expect(p.times.length).toBe(101);
    expect(p.slots.length).toBe(101);
    for (const t of p.times) expect(p.segments.some(g => t >= g.in && t <= g.out)).toBe(true);
    expect(p.every).toBeCloseTo(4.5 / 101, 9);
  });
  it('step spacing counts the kept seconds only', () => {
    const s = { ...stackSettingsOf({ spacing: 'step', step: 0.5 }), clip: clip({ segments: [seg(0, 2), seg(5, 6)] }) };
    expect(planFrameStack(HD, s).frames).toBe(6);
  });
  it('crop and rotation set the tile shape', () => {
    const rot = planFrameStack(HD, { ...stackSettingsOf({}), clip: clip({ xf: { ...defaultClip().xf, rotate: 90 } }) });
    expect(rot.aspect).toBeCloseTo(1080 / 1920, 9);
    expect(rot.tileH).toBeGreaterThan(rot.tileW);
    const sq = planFrameStack(HD, { ...stackSettingsOf({}), clip: clip({ xf: { ...defaultClip().xf, crop: { x: 0.2, y: 0, w: 1080 / 1920, h: 1 } } }) });
    expect(sq.aspect).toBeCloseTo(1, 6);
    expect([sq.tileW, sq.tileH]).toEqual([256, 256]);
  });
  it('reads clip params defensively and writes them back the same', () => {
    const c = clipSettingsOf({ segments: [{ in: -3, out: 'x' }, null, { in: 2, out: 3, reverse: true }], clip: { distribute: 'equal', ramp: 'easeOut', rotate: 450, flipX: true, crop: { x: 0.9, y: -1, w: 0.5, h: 0 } } });
    expect(c.segments).toEqual([{ in: 0, out: 0 }, { in: 2, out: 3, reverse: true }]);
    expect([c.distribute, c.ramp, c.xf.rotate, c.xf.flipX, c.xf.flipY]).toEqual(['equal', 'easeOut', 90, true, false]);
    expect(c.xf.crop).toEqual({ x: 0.5, y: 0, w: 0.5, h: 0.05 });
    const p = clipParams(c);
    expect(clipSettingsOf(p)).toEqual(c);
    // Before segments: Start / End.
    expect(clipSettingsOf({ start: 2, end: 6 }).segments).toEqual([{ in: 2, out: 6 }]);
  });
});

describe('migration from Start / End', () => {
  it('an old node\'s Start / End becomes one segment; End 0 still means the end', () => {
    expect(migrateTimeCubeSource({ start: 2, end: 6, frames: 64 }, 0)).toEqual({ segments: [{ in: 2, out: 6 }], frames: 64 });
    expect(migrateTimeCubeSource({ start: 3, end: 0 }, 1)).toEqual({ segments: [{ in: 3, out: 0 }] });
    expect(migrateTimeCubeSource({}, 0)).toEqual({ segments: [{ in: 0, out: 0 }] });
    const keep = { segments: [{ in: 1, out: 2 }], start: 5 };
    expect(migrateTimeCubeSource(keep, 0).segments).toEqual([{ in: 1, out: 2 }]);
    expect(migrateTimeCubeSource({ start: 9 }, TIME_CUBE_SOURCE_VERSION)).toEqual({ start: 9 });
  });
  it('a saved graph loads with the same frames it had', () => {
    const saved = n('timeCube', 'old', 0, 0, { start: 2, end: 6, frames: 4 }) as GraphNode;
    delete saved.params._schemaVersion; delete saved.params.segments; delete saved.params.clip;
    const before = planFrameStack(HD, stackSettingsOf({ start: 2, end: 6, frames: 4 }));
    const loaded = migrateNodeParams(saved, getNodeDefinition);
    expect(loaded.params._schemaVersion).toBe(2);
    expect(loaded.params.start).toBeUndefined();
    expect(planFrameStack(HD, stackSettingsOf(loaded.params)).times).toEqual(before.times);
    expect(TimeCubeNode.paramDefs?.start).toBeUndefined();
  });
});

describe('crop, rotate and flip maths', () => {
  const xf = (o: Partial<ClipTransform>): ClipTransform => ({ crop: { x: 0, y: 0, w: 1, h: 1 }, rotate: 0, flipX: false, flipY: false, ...o });
  it('output size: the crop, then width and height swap for a quarter turn', () => {
    expect(clipOutputSize(1920, 1080, xf({ crop: { x: 0, y: 0, w: 0.5, h: 0.5 } }))).toEqual([960, 540]);
    expect(clipOutputSize(1920, 1080, xf({ rotate: 270 }))).toEqual([1080, 1920]);
    expect(clipOutputSize(1920, 1080, xf({ rotate: 180 }))).toEqual([1920, 1080]);
  });
  it('a quarter turn clockwise puts the top-left of the picture at the top-right', () => {
    expect(sourceToOutput(xf({ rotate: 90 }), 0, 0)).toEqual([1, 0]);
    expect(outputToSource(xf({ rotate: 90 }), 1, 0)).toEqual([0, 0]);
    expect(outputToSource(xf({ rotate: 270 }), 0, 1)).toEqual([0, 0]);
    expect(outputToSource(xf({ flipX: true }), 0, 0.25)).toEqual([1, 0.25]);
    expect(outputToSource(xf({ crop: { x: 0.25, y: 0.5, w: 0.5, h: 0.5 } }), 0.5, 0.5)).toEqual([0.5, 0.75]);
  });
  it('sourceToOutput undoes outputToSource for every rotation and flip', () => {
    for (const rotate of [0, 90, 180, 270] as const) for (const flipX of [false, true]) for (const flipY of [false, true]) {
      const x = xf({ rotate, flipX, flipY, crop: { x: 0.1, y: 0.2, w: 0.6, h: 0.5 } });
      for (const [u, v] of [[0, 0], [1, 0], [0.3, 0.8], [1, 1]]) {
        const [sx, sy] = outputToSource(x, u, v);
        const [u2, v2] = sourceToOutput(x, sx, sy);
        expect(u2).toBeCloseTo(u, 9); expect(v2).toBeCloseTo(v, 9);
      }
    }
  });
  it('the canvas transform draws each corner of the crop where outputToSource reads it', () => {
    for (const rotate of [0, 90, 180, 270] as const) for (const flipX of [false, true]) {
      const x = xf({ rotate, flipX, crop: { x: 0.25, y: 0, w: 0.5, h: 1 } });
      const d = clipDrawParams(x, 200, 100, 10, 20, 64, 48);
      const [a, b, c, dd, e, f] = d.matrix;
      for (const [cx, cy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        // Destination point of the drawn image, through the matrix, onto the canvas.
        const px = cx * d.dw, py = cy * d.dh;
        const X = a * px + c * py + e, Y = b * px + dd * py + f;
        const [sx, sy] = outputToSource(x, (X - 10) / 64, (Y - 20) / 48);
        expect(sx).toBeCloseTo(0.25 + cx * 0.5, 9); expect(sy).toBeCloseTo(cy, 9);
      }
    }
  });
  it('cleans a crop and a rotation', () => {
    expect(cleanCrop({ x: 0.8, y: 0.5, w: 0.5, h: 2 })).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 });
    expect(cleanTransform({ rotate: -90 }).rotate).toBe(270);
    expect(cleanTransform({ rotate: 44 }).rotate).toBe(0);
  });
});

describe('the volume key follows the clip', () => {
  const node = (params: Record<string, unknown> = {}) => n('timeCube', 'c', 0, 0, params) as GraphNode;
  it('changes with segments, reverse, distribution, ramp, crop, rotate and flip', () => {
    const base = volumeKey(node())!;
    const keys = [
      node({ segments: [{ in: 0, out: 2 }] }),
      node({ segments: [{ in: 0, out: 2 }, { in: 3, out: 4 }] }),
      node({ segments: [{ in: 0, out: 2 }, { in: 3, out: 4 }], clip: { distribute: 'equal' } }),
      node({ segments: [{ in: 0, out: 2, reverse: true }] }),
      node({ clip: { ramp: 'easeIn' } }),
      node({ clip: { crop: { x: 0.1, y: 0, w: 0.5, h: 1 } } }),
      node({ clip: { rotate: 180 } }),
      node({ clip: { flipX: true } }),
    ].map(k => volumeKey(k));
    expect(new Set([base, ...keys]).size).toBe(keys.length + 1);
    // Reordering frames (Frame order) still shares the decoded base.
    expect(baseVolumeKey(node({ clip: { rotate: 180 } }))).toBe(baseVolumeKey(node({ clip: { rotate: 180 }, order: 'reverse' })));
  });
  it('the default clip keeps the key a Start / End node had', () => {
    expect(volumeKey(node())).toBe(volumeKey(node({ segments: undefined, start: 0, end: 0 })));
    expect(volumeKey(node())).toContain('|0.0000-4.0000');
  });
});
