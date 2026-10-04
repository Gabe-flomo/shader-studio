/**
 * The Motion layer (docs/motion-layer.md): the readings' maths on synthetic
 * frames (amount, area, where, direction, delay, smoothing, pause), the
 * matte's alpha and feather, the saved form, its readings in the pickers,
 * the record edits (Where it moves, removing a source), the Motion
 * behaviours, the kit (readings reported, matte cut, particles born where it
 * moves, the same every run) and the web page carrying it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MT_READS, mtBlur, mtCreate, mtFlow, mtGridSize, mtLuma, mtMaskAlpha, mtReadGrid, mtSampleSize, mtStep, mtThreshold, type MtState } from '../kit/motion.js';
import { createLayerKit } from '../kit/kit.js';
import { ANCHOR_KINDS, defaultLayer, emptyPlayRecord, parseLayer, parsePlayRecord, sensorReadsFor, type MotionLayer, type PlayLayer, type PlayRecord } from '../../types/play';
import { motionWatchers, runsWhileHidden } from '../../types/playLayers';
import { layerPorts, readingRange } from '../layerPorts';
import { SENSOR_HINTS, SENSOR_LABELS } from '../playSources';
import { addMatteMotion } from '../mattes';
import { motionSourceChoices, motionSourceStart, newMotionLayer } from '../motionLayers';
import { removeLayer } from '../../components/play/layerOps';
import { BUILT_IN_BEHAVIOURS, applyBehaviour } from '../behaviours';
import { kitScript, playUsesCamera } from '../exportHtml';

// ── Synthetic frames ─────────────────────────────────────────────────────────

const W = 64, H = 36;
/** An RGBA frame from a brightness function of the pixel (0..1). */
function frame(w: number, h: number, lum: (x: number, y: number) => number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = Math.round(Math.max(0, Math.min(1, lum(x, y))) * 255), i = (y * w + x) * 4; out[i] = out[i + 1] = out[i + 2] = v; out[i + 3] = 255; }
  return out;
}
/** A white square of side `s` at (x0, y0) on black (row 0 at the top). */
const square = (x0: number, y0: number, s: number) => frame(W, H, (x, y) => (x >= x0 && x < x0 + s && y >= y0 && y < y0 + s ? 1 : 0));
/** A smooth pattern (blobs) moved by (dx, dy) pixels: for the flow estimate. */
const blobs = (dx: number, dy: number) => frame(W, H, (x, y) => 0.5 + 0.25 * Math.sin((x - dx) * 0.35) + 0.25 * Math.cos((y - dy) * 0.4));
const opts = { sensitivity: 0.5, delay: 1, smoothing: 0, cell: 0.1, aspect: W / H, dt: 1 / 60 };
const feed = (frames: Uint8ClampedArray[], o: Partial<typeof opts> = {}): MtState => {
  const st = mtCreate();
  for (const f of frames) mtStep(st, f, W, H, { ...opts, ...o });
  return st;
};

describe('sizes and the threshold', () => {
  it('samples at 144 rows (fewer for very wide pictures), whatever the resolution', () => {
    expect(mtSampleSize(16 / 9)).toEqual({ w: 256, h: 144 });
    expect(mtSampleSize(4)).toEqual({ w: 320, h: 80 });
    expect(mtSampleSize(NaN)).toEqual({ w: 256, h: 144 });
  });
  it('Sensitivity lowers the threshold: 0.215 at 0, 0.065 at a half, 0.015 at 1', () => {
    expect(mtThreshold(0)).toBeCloseTo(0.215);
    expect(mtThreshold(0.5)).toBeCloseTo(0.065);
    expect(mtThreshold(1)).toBeCloseTo(0.015);
    expect(mtThreshold(2)).toBeCloseTo(0.015);
  });
  it('Cell size picks about 1 / cell rows of square cells, at least 2 pixels a cell', () => {
    expect(mtGridSize(0.1, 256, 144, 16 / 9)).toEqual({ cols: 18, rows: 10 });
    expect(mtGridSize(0.001, 64, 36, 16 / 9)).toEqual({ cols: 32, rows: 18 });
  });
});

describe('the readings', () => {
  it('still frames read nothing: Amount and Area 0, centre and direction in the middle', () => {
    const st = feed([square(40, 10, 8), square(40, 10, 8), square(40, 10, 8)]);
    expect(st.reads).toEqual({ motion: 0, area: 0, moveX: 0.5, moveY: 0.5, dirX: 0.5, dirY: 0.5 });
  });

  it('a square that jumps reads Amount and Area, and Where is where it moved (y up)', () => {
    const st = feed([square(44, 4, 8), square(48, 4, 8)]);
    expect(st.reads.motion).toBeGreaterThan(0.1);
    expect(st.reads.area).toBeGreaterThan(0);
    expect(st.reads.area).toBeLessThan(0.2);
    expect(st.reads.moveX).toBeGreaterThan(0.65);
    expect(st.reads.moveY).toBeGreaterThan(0.6);
    // Every reading is 0..1.
    for (const k of MT_READS) { expect(st.reads[k]).toBeGreaterThanOrEqual(0); expect(st.reads[k]).toBeLessThanOrEqual(1); }
  });

  it('the whole frame changing reads Amount 1 and Area 1', () => {
    const st = feed([frame(W, H, () => 0), frame(W, H, () => 1)]);
    expect(st.reads.motion).toBeCloseTo(1);
    expect(st.reads.area).toBeCloseTo(1);
  });

  it('Sensitivity: a faint change counts only when sensitive', () => {
    const faint = [frame(W, H, () => 0.5), frame(W, H, () => 0.56)];
    expect(feed(faint, { sensitivity: 0.2 }).reads.motion).toBe(0);
    expect(feed(faint, { sensitivity: 1 }).reads.motion).toBeGreaterThan(0.5);
  });

  it('Direction follows the flow: right reads above 0.5 across, up reads above 0.5 up', () => {
    const right = feed([blobs(0, 0), blobs(1, 0)]);
    expect(right.reads.dirX).toBeGreaterThan(0.6);
    expect(Math.abs(right.reads.dirY - 0.5)).toBeLessThan(0.05);
    const left = feed([blobs(0, 0), blobs(-1, 0)]);
    expect(left.reads.dirX).toBeLessThan(0.4);
    // Rows go down the frame, so moving to a smaller row is up the picture.
    const up = feed([blobs(0, 0), blobs(0, -1)]);
    expect(up.reads.dirY).toBeGreaterThan(0.6);
    expect(Math.abs(up.reads.dirX - 0.5)).toBeLessThan(0.05);
  });

  it('the flow is in sample pixels per step, about the shift', () => {
    const a = blobs(0, 0), b = blobs(1, 0);
    const f = mtFlow(mtLuma(b, W * H), mtLuma(a, W * H), W, H, 0.01);
    expect(f.x).toBeGreaterThan(0.6);
    expect(f.x).toBeLessThan(1.4);
    expect(Math.abs(f.y)).toBeLessThan(0.2);
  });

  it('Delay compares with that many frames back', () => {
    // The square moves at frame 1 and stays: with Delay 1 the third frame is still; with Delay 2 it still sees the move.
    const frames = [square(10, 10, 8), square(14, 10, 8), square(14, 10, 8)];
    expect(feed(frames, { delay: 1 }).reads.motion).toBe(0);
    expect(feed(frames, { delay: 2 }).reads.motion).toBeGreaterThan(0.1);
  });

  it('Smoothing makes it linger, frame-rate independent; a paused clock holds everything', () => {
    const frames = [square(10, 10, 8), square(14, 10, 8), square(14, 10, 8)];
    const raw = feed(frames, { smoothing: 0 }), slow = feed(frames, { smoothing: 0.9 });
    expect(raw.reads.motion).toBe(0);
    expect(slow.reads.motion).toBeGreaterThan(0);
    // Two steps at 60 Hz ease as far as one at 30 Hz.
    const a = feed([square(10, 10, 8), square(14, 10, 8), square(14, 10, 8), square(14, 10, 8)], { smoothing: 0.8, dt: 1 / 60 });
    const b = feed([square(10, 10, 8), square(14, 10, 8), square(14, 10, 8)], { smoothing: 0.8, dt: 1 / 30 });
    const a2 = feed([square(10, 10, 8), square(14, 10, 8)], { smoothing: 0.8, dt: 1 / 60 });
    const b2 = feed([square(10, 10, 8), square(14, 10, 8)], { smoothing: 0.8, dt: 1 / 30 });
    expect(b2.grid![0]).toBe(0);
    expect(a.grid!.reduce((s, v) => s + v, 0) / a2.grid!.reduce((s, v) => s + v, 0)).toBeCloseTo(b.grid!.reduce((s, v) => s + v, 0) / b2.grid!.reduce((s, v) => s + v, 0), 5);
    const held = feed([square(10, 10, 8), square(14, 10, 8)]);
    const before = { ...held.reads };
    mtStep(held, square(30, 20, 8), W, H, { ...opts, dt: 0 });
    expect(held.reads).toEqual(before);
  });

  it('is the same every run (a take or a render repeats it)', () => {
    const frames = [blobs(0, 0), blobs(1, 0.5), blobs(2, 1), square(20, 5, 9), square(22, 7, 9)];
    expect(feed(frames).reads).toEqual(feed(frames).reads);
    expect(Array.from(feed(frames).grid!)).toEqual(Array.from(feed(frames).grid!));
  });

  it('Where holds while nothing moves', () => {
    const g = new Float32Array(4 * 2);
    expect(mtReadGrid(g, 4, 2, { motion: 0, area: 0, moveX: 0.8, moveY: 0.2, dirX: 0.5, dirY: 0.5 })).toMatchObject({ moveX: 0.8, moveY: 0.2 });
    g[3] = 1; // top-right cell
    expect(mtReadGrid(g, 4, 2, null)).toMatchObject({ moveX: 0.875, moveY: 0.75, area: 1 / 8 });
  });

  it('keeps a table to be born from: the last with movement in it', () => {
    const st = feed([square(44, 4, 8), square(48, 4, 8)]);
    expect(st.cdf!.total).toBeGreaterThan(0.5);
    const t = st.cdf!.total;
    mtStep(st, square(48, 4, 8), W, H, opts);
    expect(st.cdf!.total).toBe(t);
  });
});

describe('the matte', () => {
  it('solid where a cell is half moving, nothing where still; Feather spreads it, still within 0..1', () => {
    const st = feed([square(44, 4, 8), square(48, 4, 8)]);
    const hard = mtMaskAlpha(st, 0, 0.1);
    expect(Math.max(...hard)).toBe(1);
    expect(hard.filter(v => v > 0).length).toBeLessThan(hard.length / 4);
    const soft = mtMaskAlpha(st, 0.2, 0.1);
    expect(soft.filter(v => v > 0).length).toBeGreaterThan(hard.filter(v => v > 0).length);
    expect(Math.max(...soft)).toBeLessThanOrEqual(1);
    expect(Math.min(...soft)).toBeGreaterThanOrEqual(0);
  });
  it('the blur spreads a cell evenly, two cells each way for a radius of 1 (two passes)', () => {
    const a = new Float32Array(49); a[24] = 1;
    mtBlur(a, 7, 7, 1);
    expect(a[24]).toBeCloseTo(1 / 9);
    expect(a[24 - 16]).toBeGreaterThan(0); // two up, two left
    expect(a[0]).toBe(0);
    expect(a[23]).toBeCloseTo(a[25]);
    expect(a.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 5);
  });
});

// ── The saved form, the pickers, the record edits ────────────────────────────

const L = (kind: PlayLayer['kind'], id: string, over: Record<string, unknown> = {}) => ({ ...defaultLayer(kind, id, id), ...over } as PlayLayer);
const rec = (layers: PlayLayer[]): PlayRecord => ({ ...emptyPlayRecord(), layers });

describe('saved form', () => {
  it('a Motion layer round-trips; bad values fall back, numbers clamp', () => {
    const m = L('motion', 'm', { readFrom: 'layer', sourceId: 'v', sensitivity: 0.7, delay: 4, smoothing: 0.3, cell: 0.05, show: 'heat', look: 'grey', feather: 0.1 });
    expect(parseLayer(JSON.parse(JSON.stringify(m)))).toEqual(m);
    const bad = parseLayer({ id: 'm', kind: 'motion', readFrom: 'tv', show: 'all', delay: 99.4, smoothing: 5, sensitivity: -1, cell: 0, feather: 'soft' }) as MotionLayer;
    expect(bad.readFrom).toBe('camera');
    expect(bad.show).toBe('extract');
    expect(bad.delay).toBe(30);
    expect(bad.smoothing).toBe(0.99);
    expect(bad.sensitivity).toBe(0);
    expect(bad.cell).toBe(0.005);
    expect(bad.feather).toBe(0.03);
  });
  it('particles keep which Motion layer they are born in; older files load with none', () => {
    const p = L('particles', 'p', { spawn: 'motion', motionId: 'm' });
    expect((parseLayer(JSON.parse(JSON.stringify(p))) as { motionId: string }).motionId).toBe('m');
    expect((parseLayer({ id: 'p', kind: 'particles', spawn: 'motion' }) as { motionId: string }).motionId).toBe('');
  });
  it('a setup with a Motion layer as a matte loads with it', () => {
    const p = addMatteMotion(rec([L('text', 't')]), 't').play;
    const back = parsePlayRecord(JSON.parse(JSON.stringify(p)))!;
    expect(back.layers.map(l => l.kind)).toEqual(['text', 'motion']);
    expect(back.layers[0].trackMatte?.id).toBe(back.layers[1].id);
  });
});

describe('readings in the pickers', () => {
  it('Amount, Area, Where X/Y and Direction X/Y, each 0..1, labelled and explained; it is an anchor', () => {
    const m = L('motion', 'm');
    expect(layerPorts(m).readings).toEqual(['motion', 'area', 'moveX', 'moveY', 'dirX', 'dirY']);
    expect(sensorReadsFor(m)).toContain('distance');
    for (const r of layerPorts(m).readings) { expect(readingRange(r)).toEqual([0, 1]); expect(SENSOR_LABELS[r]).toBeTruthy(); expect(SENSOR_HINTS[r]).toBeTruthy(); }
    expect(SENSOR_LABELS.moveX).toBe('Where X');
    expect(ANCHOR_KINDS).toContain('motion');
    expect(layerPorts(m).props.map(p => p.key)).toEqual(['sensitivity', 'delay', 'smoothing', 'cell', 'gain', 'feather', 'opacity']);
  });
  it('a mapping from a Motion reading survives the file', () => {
    const p: PlayRecord = { ...rec([L('motion', 'm')]), controls: [{ id: 'c', target: 'n::r', kind: 'float', label: 'R', min: 0, max: 1 }], mappings: [{ id: 'mp', controlId: 'c', source: { kind: 'sensor', layerId: 'm', read: 'dirX', otherId: '' }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true }] };
    const back = parsePlayRecord(JSON.parse(JSON.stringify(p)))!;
    expect(back.mappings[0].source).toEqual({ kind: 'sensor', layerId: 'm', read: 'dirX', otherId: '' });
  });
});

describe('record edits', () => {
  it('a new Motion layer watches the camera when there is one, else the first video, else the camera', () => {
    expect(motionSourceStart([L('camera', 'c'), L('video', 'v')])).toEqual({ readFrom: 'camera', sourceId: '' });
    expect(motionSourceStart([L('text', 't'), L('video', 'v')])).toEqual({ readFrom: 'layer', sourceId: 'v' });
    expect(motionSourceStart([])).toEqual({ readFrom: 'camera', sourceId: '' });
    expect(newMotionLayer([L('video', 'v')], 'm', 'M').sourceId).toBe('v');
    expect(motionSourceChoices([L('null', 'n'), L('video', 'v'), L('motion', 'm'), L('motion', 'm2')], 'm').map(l => l.id)).toEqual(['v']);
  });
  it('Where it moves: a hidden Motion layer right above, as an Alpha matte, showing its matte', () => {
    const p = addMatteMotion(rec([L('text', 't'), L('video', 'v')]), 't');
    const m = p.play.layers[1] as MotionLayer;
    expect(m.kind).toBe('motion');
    expect(m.visible).toBe(false);
    expect(m.show).toBe('mask');
    expect(m.readFrom).toBe('layer');
    expect(m.sourceId).toBe('v');
    expect(p.play.layers[0].trackMatte).toEqual({ id: p.id, mode: 'alpha', invert: false });
    // A Motion layer is a matte, not matted.
    expect(addMatteMotion(p.play, p.id).id).toBe('');
  });
  it('a watched layer runs while hidden; removing it, or the Motion layer, lets go everywhere', () => {
    const p = rec([L('video', 'v', { visible: false }), L('motion', 'm', { readFrom: 'layer', sourceId: 'v' }), L('particles', 'p', { spawn: 'motion', motionId: 'm' })]);
    expect(runsWhileHidden(p.layers, 'v')).toBe(true);
    expect(motionWatchers(p.layers, 'v').map(l => l.id)).toEqual(['m']);
    expect((removeLayer(p, 'v').layers.find(l => l.id === 'm') as MotionLayer).sourceId).toBe('');
    expect((removeLayer(p, 'm').layers.find(l => l.id === 'p') as { motionId: string }).motionId).toBe('');
  });
});

describe('Motion behaviours', () => {
  const base = () => rec([L('particles', 'p', { emit: 'burst' }), L('text', 'w'), L('motion', 'm')]);
  it('Motion starts, Big movement and Motion stops watch the Motion layer’s readings', () => {
    const find = (id: string) => BUILT_IN_BEHAVIOURS.find(b => b.id === id)!;
    const starts = applyBehaviour(base(), find('b_motion_starts'), { motion: 'm', layer: 'w' }).play.signals![0];
    expect(starts.inputs![0]).toEqual({ kind: 'trigger', trigger: { on: 'value', value: 'read:m::motion', cmp: 'crossUp', threshold: 0.15, hysteresis: 0.05, tolerance: 0.01 } });
    expect(starts.do![0]).toMatchObject({ layerId: 'w', do: 'next' });
    const big = applyBehaviour(base(), find('b_motion_big'), { motion: 'm', layer: 'p' }).play.signals![0];
    expect(big.inputs![0]).toMatchObject({ trigger: { value: 'read:m::area', cmp: 'crossUp' } });
    expect(big.do![0]).toMatchObject({ do: 'burst', layerId: 'p', amount: 80 });
    const stops = applyBehaviour(base(), find('b_motion_stops'), { motion: 'm', layer: 'w' }).play.signals![0];
    expect(stops.inputs![0]).toMatchObject({ trigger: { value: 'read:m::motion', cmp: 'crossDown' } });
    expect(stops.do![0]).toMatchObject({ do: 'hide' });
  });
});

// ── The kit, on canvases whose pixels come from a frame function ────────────

type Call = { fn: string; op: string; src?: FakeCanvas };
interface FakeCanvas { width: number; height: number; calls: Call[]; getContext: () => unknown }
/** The picture now, as the fake canvases hand it back (getImageData of any size). */
let picture: (x: number, y: number) => number = () => 0;
function fakeCanvas(): FakeCanvas {
  const calls: Call[] = [];
  const state: Record<string, unknown> = { globalCompositeOperation: 'source-over', globalAlpha: 1 };
  const ctx: unknown = new Proxy(state, {
    get(t, k: string) {
      if (k in t) return t[k];
      if (k === 'getImageData') return (_x: number, _y: number, w: number, h: number) => ({ data: frame(w, h, (x, y) => picture(x / w, y / h)), width: w, height: h });
      if (k === 'createImageData') return (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'isPointInStroke' || k === 'isPointInPath') return () => false;
      return (...args: unknown[]) => { calls.push({ fn: k, op: String(t.globalCompositeOperation), src: args[0] as FakeCanvas }); };
    },
    set(t, k: string, v) { t[k] = v; return true; },
  });
  return { width: 0, height: 0, calls, getContext: () => ctx };
}

describe('the kit', () => {
  const g = globalThis as Record<string, unknown>;
  const saved = { document: g.document, Path2D: g.Path2D };
  beforeAll(() => {
    g.document = { createElement: () => fakeCanvas() };
    g.Path2D = class { moveTo() {} lineTo() {} arcTo() {} arc() {} closePath() {} rect() {} };
  });
  afterAll(() => { g.document = saved.document; g.Path2D = saved.Path2D; });

  const num = (l: PlayLayer, k: string) => (l as unknown as Record<string, number>)[k];
  /** Run frames of a setup; a bright square jumps right in the top-right quarter each frame. */
  const run = (layers: PlayLayer[], frames = 4, seed = 0) => {
    const kit = createLayerKit();
    kit.reset(seed);
    const sensors = new Map<string, number>();
    let main = fakeCanvas();
    for (let i = 0; i < frames; i++) {
      const x0 = 0.6 + i * 0.05;
      picture = (x, y) => (x >= x0 && x < x0 + 0.12 && y < 0.3 ? 1 : 0);
      main = fakeCanvas();
      kit.frame(main.getContext() as CanvasRenderingContext2D, rec(layers), {
        gl: fakeCanvas(), W: 160, H: 90, dpr: 1, time: i / 60, dt: 1 / 60, value: num,
        pointer: { x: 0.5, y: 0.5, over: false, down: false }, markers: false, editing: false, hidden: false, backdrop: [0, 0, 0],
        audio: null, camera: null, image: () => null, sensor: (k: string, v: number) => sensors.set(k, v), override: () => {},
      } as never);
    }
    return { sensors, main, kit };
  };
  const watcher = (over: Record<string, unknown> = {}) => L('motion', 'm', { readFrom: 'picture', smoothing: 0, delay: 1, cell: 0.05, ...over });

  it('reports the readings and its anchor, hidden or not, and the same every run', () => {
    const a = run([watcher({ visible: false })]).sensors, b = run([watcher({ visible: false })]).sensors;
    expect(a.get('m::motion')).toBeGreaterThan(0.1);
    expect(a.get('m::moveX')).toBeGreaterThan(0.6);
    expect(a.get('m::moveY')).toBeGreaterThan(0.6);
    expect(a.get('m::dirX')).toBeGreaterThanOrEqual(0.5);
    expect(a.get('m::ax')).toBe(a.get('m::moveX'));
    expect([...a]).toEqual([...b]);
  });

  it('without a camera it reads still (a page whose visitor says no)', () => {
    const s = run([watcher({ readFrom: 'camera' })]).sensors;
    expect(s.get('m::motion')).toBe(0);
    expect(s.get('m::area')).toBe(0);
  });

  it('as a matte: the layer is cut by its "where it moves" canvas (destination-in), and the matte itself stays off the picture', () => {
    const { main } = run([L('shape', 'a', { action: 'none', fillOpacity: 1, strokeWidth: 0, trackMatte: { id: 'm', mode: 'alpha', invert: false } }), watcher({ visible: false, feather: 0.05 })]);
    const blits = main.calls.filter(c => c.fn === 'drawImage');
    expect(blits).toHaveLength(1);
    const cut = blits[0].src!.calls.find(c => c.fn === 'drawImage')!;
    expect(cut.op).toBe('destination-in');
    // The matte canvas was drawn from the small grid (putImageData there, then scaled up).
    const scaled = cut.src!.calls.find(c => c.fn === 'drawImage')!;
    expect(scaled.src!.calls.map(c => c.fn)).toContain('putImageData');
  });

  it('Show draws the movement, a heat map or the matte; Nothing draws nothing', () => {
    // (Normal blending, so the picture isn't copied under the overlay first.)
    for (const show of ['extract', 'heat', 'mask']) expect(run([watcher({ show, blend: 'normal' })]).main.calls.some(c => c.fn === 'drawImage')).toBe(true);
    expect(run([watcher({ show: 'hidden', blend: 'normal' })]).main.calls.some(c => c.fn === 'drawImage')).toBe(false);
  });

  it('particles born in it are born where it moves', () => {
    const { sensors } = run([watcher({ visible: false }), L('particles', 'p', { emit: 'burst', spawn: 'motion', motionId: 'm', count: 50, seed: 3, speed: 0, field: 'none' })], 3);
    // No births yet: burst one and look where it landed.
    const kit = createLayerKit();
    const layers = [watcher({ visible: false }), L('particles', 'p', { emit: 'burst', spawn: 'motion', motionId: 'm', count: 50, seed: 3, speed: 0, field: 'none' })];
    const got = new Map<string, number>();
    for (let i = 0; i < 4; i++) {
      const x0 = 0.6 + i * 0.05;
      picture = (x, y) => (x >= x0 && x < x0 + 0.12 && y < 0.3 ? 1 : 0);
      if (i === 3) kit.act({ do: 'burst', layerId: 'p', amount: 30 });
      kit.frame(fakeCanvas().getContext() as CanvasRenderingContext2D, rec(layers), {
        gl: fakeCanvas(), W: 160, H: 90, dpr: 1, time: i / 60, dt: 1 / 60, value: num,
        pointer: { x: 0.5, y: 0.5, over: false, down: false }, markers: false, editing: false, hidden: false, backdrop: [0, 0, 0],
        audio: null, camera: null, image: () => null, sensor: (k: string, v: number) => got.set(k, v), override: () => {},
      } as never);
    }
    expect(sensors.get('m::motion')).toBeGreaterThan(0);
    expect(got.get('p::bornX')).toBeGreaterThan(0.55);
    expect(got.get('p::bornY')).toBeGreaterThan(0.6);
  });
});

describe('web pages', () => {
  it('carry the Motion maths, and light the camera for a Motion layer watching it, even hidden', () => {
    const js = kitScript();
    expect(js).toContain('function mtStep');
    expect(js).not.toMatch(/^import /m);
    expect(playUsesCamera(rec([L('motion', 'm', { visible: false })]))).toBe(true);
    expect(playUsesCamera(rec([L('motion', 'm', { readFrom: 'picture' })]))).toBe(false);
  });
});
