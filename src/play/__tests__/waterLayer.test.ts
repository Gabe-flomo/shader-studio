/**
 * The Water layer (docs/water-layer.md): its saved form, its region (placing,
 * soft edge, masking the readings and the matte), its numbers in the region's
 * units, the shared solver's parity with the Finish stack's Water (same
 * settings → same height field; a pond's waves keep the picture's units),
 * determinism, the read-back, the kit's wiring (with a stand-in renderer),
 * Move to a layer, the exported page's copy of the maths, and the example.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The kit's Water renderer is the Finish stack's (WebGL); the tests stand one in that records what it is asked.
const rend = vi.hoisted(() => ({ inputs: [] as Record<string, unknown>[], disposed: 0, field: null as unknown }));
vi.mock('../kit/finish.js', async orig => {
  const m = await orig<typeof import('../kit/finish.js')>();
  return {
    ...m,
    fnCreate: () => ({
      ok: true, canvas: { width: 0, height: 0, getContext: () => null },
      draw(input: Record<string, unknown>) { rend.inputs.push(input); return true; },
      waterField: () => rend.field,
      info: () => null, reset() {}, dispose() { rend.disposed++; },
    }),
  };
});

import { FN_EFFECTS, fnWaterCpu, fnWaterGrid, fnWaterUnpack, type FnWaterField } from '../kit/finish.js';
import { WL_PARAMS, WL_READS, wlEdgeAlpha, wlEffect, wlEffectKey, wlInside, wlLayerKey, wlMatteAlpha, wlReadings, wlRegion, wlToLocal, wlToPicture, wlValue } from '../kit/waterLayer.js';
import { createLayerKit } from '../kit/kit.js';
import { ANCHOR_KINDS, defaultLayer, emptyPlayRecord, parseLayer, parsePlayRecord, sensorReadsFor, type PlayLayer, type PlayRecord, type WaterLayer } from '../../types/play';
import { newFinishEffect } from '../../types/playFinish';
import { moveWaterToLayer, dropWaterRefs } from '../waterLayers';
import { removeLayer } from '../../components/play/layerOps';
import { doChoices, reactionText } from '../../components/play/rules/reactionChoices';
import { SENSOR_HINTS, SENSOR_LABELS } from '../playSources';
import { kitScript } from '../exportHtml';
import { PLAY_EXAMPLE_GRAPHS } from '../../store/playExamples';

const L = (kind: PlayLayer['kind'], id: string, over: Record<string, unknown> = {}) => ({ ...defaultLayer(kind, id, id), ...over } as PlayLayer);
const rec = (layers: PlayLayer[], over: Partial<PlayRecord> = {}): PlayRecord => ({ ...emptyPlayRecord(), layers, ...over });
const water = (over: Record<string, unknown> = {}) => L('water', 'w', over) as WaterLayer;
const num = (l: Record<string, unknown>) => (k: string) => l[k] as number;

describe('saved form', () => {
  it('a new Water layer carries the Water effect’s numbers (Source X/Y as sourceX/sourceY), over the whole picture', () => {
    const w = water();
    for (const p of FN_EFFECTS.water.params) expect((w as unknown as Record<string, number>)[wlLayerKey(p.key)]).toBe(p.value);
    expect(w).toMatchObject({ region: 'all', source: 'pointer', shape: 'point', detail: 'medium', probeX: 0.5, probeY: 0.5, blend: 'normal', toShader: false });
    expect(wlLayerKey('x')).toBe('sourceX'); expect(wlEffectKey('sourceY')).toBe('y'); expect(wlEffectKey('speed')).toBe('speed');
    expect(WL_PARAMS.map(p => p.key)).toContain('sourceX');
  });

  it('round-trips; bad values fall back, numbers clamp to the effect’s ranges', () => {
    const w = water({ region: 'ellipse', x: 0.3, w: 0.7, soft: 0.1, source: 'layer', sourceLayer: 'b', shape: 'layer', shapeLayer: 'b', detail: 'high', rain: 12 });
    expect(parseLayer(JSON.parse(JSON.stringify(w)))).toEqual(w);
    const bad = parseLayer({ ...w, region: 'hexagon', source: 'moon', shape: 'cube', detail: 'ultra', speed: 99, rain: -4 }) as WaterLayer;
    expect(bad).toMatchObject({ region: 'all', source: 'pointer', shape: 'point', detail: 'medium', speed: 2, rain: 0 });
  });

  it('a rule’s Splash into a Water layer survives the file; one into a missing layer is dropped', () => {
    const sig = (layerId: string) => ({ id: 's' + layerId, name: 'x', inputs: [], do: [{ id: 'd', do: 'splash', layerId, amount: 1, enabled: true, key: 'pointer', value: 0.05 }] });
    const p = parsePlayRecord(JSON.parse(JSON.stringify(rec([water(), L('text', 't')], { signals: [sig('w'), sig('t'), sig('gone')] as never }))));
    expect(p.signals!.map(s => s.do?.[0]?.layerId ?? null)).toEqual(['w', null, null]);
    expect(p.signals![0].do![0]).toMatchObject({ do: 'splash', key: 'pointer', value: 0.05 });
  });

  it('readings in the pickers: Wave height, Energy, Area; it is an anchor; its Splash is a Do', () => {
    expect(sensorReadsFor(water())).toEqual(['waveHeight', 'energy', 'area', 'distance']);
    for (const r of WL_READS) { expect(SENSOR_LABELS[r as 'area']).toBeTruthy(); expect(SENSOR_HINTS[r as 'area']).toMatch(/Water layer/); }
    expect(ANCHOR_KINDS).toContain('water');
    const p = rec([water()]);
    const c = doChoices(p).find(x => x.do === 'splash');
    expect(c).toMatchObject({ layerId: 'w', label: 'Splash · w' });
    expect(reactionText({ id: 'r', do: 'splash', layerId: 'w', amount: 1, enabled: true, key: 'random', value: 0.1 }, p)).toBe('Splash somewhere random, size 0.1 · w');
  });
});

describe('the region', () => {
  const W = 400, H = 200;
  it('whole picture: the frame itself, scale 1', () => {
    expect(wlRegion(water(), num(water() as never), W, H)).toEqual({ shape: 'all', x0: 0, y0: 0, w: 400, h: 200, scale: 1 });
  });
  it('a pond: centred on x, y; sized in picture heights; whole pixels; scale its height', () => {
    const l = water({ region: 'rect', x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
    const reg = wlRegion(l, num(l as never), W, H);
    expect(reg).toEqual({ shape: 'rect', x0: 150, y0: 50, w: 100, h: 100, scale: 0.5 });
    // y up on both sides; a pond can reach past the picture (the water is simulated whole).
    expect(wlToLocal(reg, { x: 0.5, y: 0.75 }, W, H)).toEqual({ x: 0.5, y: 1 });
    const p = wlToPicture(reg, { x: 0.25, y: 0.1 }, W, H);
    const back = wlToLocal(reg, p, W, H);
    expect(back.x).toBeCloseTo(0.25); expect(back.y).toBeCloseTo(0.1);
    const off = water({ region: 'ellipse', x: 0, y: 0, w: 0.4, h: 0.4 });
    expect(wlRegion(off, num(off as never), W, H)).toMatchObject({ x0: -40, y0: 160, w: 80, h: 80 });
  });
  it('the soft edge: 1 well inside, 0 outside and on the rim, smooth over Soft edge; an ellipse is round', () => {
    expect(wlEdgeAlpha('all', 0, 0, 100, 100, 200, 0.1)).toBe(1);
    expect(wlEdgeAlpha('rect', 0.5, 0.5, 100, 100, 200, 0.1)).toBe(1);
    expect(wlEdgeAlpha('rect', 0, 0.5, 100, 100, 200, 0.1)).toBe(0);
    const mid = wlEdgeAlpha('rect', 0.1, 0.5, 100, 100, 200, 0.1); // 10 px in = 0.05 picture heights: half way
    expect(mid).toBeCloseTo(0.5, 5);
    expect(wlEdgeAlpha('rect', 0.1, 0.5, 100, 100, 200, 0)).toBe(1);
    expect(wlEdgeAlpha('ellipse', 0.95, 0.95, 100, 100, 200, 0.01)).toBe(0); // a box's corner is outside the ellipse
    expect(wlInside('ellipse', 0.95, 0.95)).toBe(false); expect(wlInside('rect', 0.95, 0.95)).toBe(true);
  });
});

/** A read-back field: heights from a function of the region's 0..1 (y up), waves from their size. */
const fieldOf = (w: number, h: number, fn: (u: number, v: number) => number): FnWaterField => {
  const height = new Float32Array(w * h), waves = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const x = fn((i + 0.5) / w, (j + 0.5) / h); height[j * w + i] = x; waves[j * w + i] = Math.min(1, Math.abs(x) * 2.5); }
  return { w, h, height, waves };
};

describe('readings and the Waves matte', () => {
  it('still water reads Wave height 0.5, Energy 0, Area 0', () => {
    expect(wlReadings(fieldOf(16, 8, () => 0), 'all', { x: 0.5, y: 0.5 })).toEqual({ waveHeight: 0.5, energy: 0, area: 0 });
    expect(wlReadings(null, 'all', null)).toEqual({ waveHeight: 0.5, energy: 0, area: 0 });
  });
  it('Wave height follows the surface under the Probe (a good crest 1, a trough 0); outside the pond it reads still', () => {
    const f = fieldOf(16, 16, u => (u < 0.5 ? 0.4 : -0.4));
    expect(wlReadings(f, 'rect', { x: 0.2, y: 0.5 }).waveHeight).toBeCloseTo(1);
    expect(wlReadings(f, 'rect', { x: 0.8, y: 0.5 }).waveHeight).toBeCloseTo(0);
    expect(wlReadings(f, 'rect', { x: 1.5, y: 0.5 }).waveHeight).toBe(0.5);
  });
  it('Energy and Area count only the pond’s own shape', () => {
    // Waves only in the box's corners, outside the ellipse.
    const corners = fieldOf(20, 20, (u, v) => (wlInside('ellipse', u, v) ? 0 : 0.4));
    expect(wlReadings(corners, 'rect', null).area).toBeGreaterThan(0.15);
    expect(wlReadings(corners, 'ellipse', null)).toMatchObject({ energy: 0, area: 0 });
    const rough = wlReadings(fieldOf(20, 20, () => 0.4), 'all', null);
    expect(rough.area).toBe(1); expect(rough.energy).toBe(1);
  });
  it('the matte: solid on waves, nothing on still water, cut at the pond’s rim, rows flipped for a canvas', () => {
    const f = fieldOf(10, 10, (_u, v) => (v > 0.5 ? 0.4 : 0)); // waves in the top half (y up)
    const a = wlMatteAlpha(f, { shape: 'all', x0: 0, y0: 0, w: 100, h: 100, scale: 1 }, 100, 0, 0);
    expect(a[0]).toBe(1); // canvas row 0 is the top
    expect(a[99]).toBe(0);
    const pond = wlMatteAlpha(fieldOf(10, 10, () => 0.4), { shape: 'ellipse', x0: 0, y0: 0, w: 100, h: 100, scale: 1 }, 100, 0, 0);
    expect(pond[0]).toBe(0); expect(pond[55]).toBe(1);
  });
  it('the read-back packing keeps heights to a few ten-thousandths', () => {
    const px = new Uint8Array(4 * 3);
    [0.3, -0.7, 0].forEach((h, i) => { const q = Math.round(Math.min(1, Math.max(0, h * 0.25 + 0.5)) * 65535); px[i * 4] = q >> 8; px[i * 4 + 1] = q & 255; px[i * 4 + 2] = 128; });
    const f = fnWaterUnpack(px, 3, 1);
    expect(f.height[0]).toBeCloseTo(0.3, 3); expect(f.height[1]).toBeCloseTo(-0.7, 3); expect(f.height[2]).toBeCloseTo(0, 3);
    expect(f.waves[0]).toBeCloseTo(128 / 255);
  });
});

describe('the shared solver', () => {
  it('the effect a layer runs: its Source, Shape (its layer as layerId) and Detail', () => {
    expect(wlEffect(water({ source: 'layer', sourceLayer: 'b', shape: 'layer', shapeLayer: 'c', detail: 'high' }))).toEqual({ id: 'water', kind: 'water', enabled: true, source: 'layer', sourceLayer: 'b', shape: 'layer', layerId: 'c', detail: 'high' });
  });
  it('numbers in the region’s units: Source X/Y and a Splash’s point placed in it, lengths and speed per its height', () => {
    const l = water({ region: 'rect', x: 0.5, y: 0.5, w: 0.5, h: 0.5, sourceX: 0.5, sourceY: 0.625, speed: 0.3, size: 0.04, drop: 0.01, length: 0.2, damping: 0.2 });
    const reg = wlRegion(l, num(l as never), 400, 200);
    const vals: Record<string, number> = { ...(l as unknown as Record<string, number>), splashX: 0.5, splashY: 0.5, splashSize: 0.06 };
    const v = wlValue(reg, k => vals[k], 400, 200);
    expect(v(null, 'x')).toBeCloseTo(0.5); expect(v(null, 'y')).toBeCloseTo(0.75);
    expect(v(null, 'speed')).toBeCloseTo(0.6); expect(v(null, 'size')).toBeCloseTo(0.08); expect(v(null, 'drop')).toBeCloseTo(0.02); expect(v(null, 'length')).toBeCloseTo(0.4);
    expect(v(null, 'damping')).toBe(0.2);
    expect(v(null, 'splashX')).toBeCloseTo(0.5); expect(v(null, 'splashSize')).toBeCloseTo(0.12);
    vals.splashX = -2; expect(v(null, 'splashX')).toBe(-2); // somewhere random stays a code
  });
  it('a pond’s grid has the whole picture’s cells: Detail’s rows scaled by its height', () => {
    expect(fnWaterGrid('medium', 1920, 1080)).toEqual({ w: 480, h: 270 });
    expect(fnWaterGrid('medium', 960, 540, 0.5)).toEqual({ w: 240, h: 135 });
    expect(fnWaterGrid('medium', 960, 540, 1)).toEqual(fnWaterGrid('medium', 960, 540));
  });

  // The renderer and its CPU twin run the same plan (finishWater.test.ts); a layer feeds that plan through wlValue.
  const cpuRun = (w: number, h: number, value: (k: string) => number, frames: Array<{ time: number; point: { x: number; y: number } | null; splash?: { t: number; x: number; y: number; size: number } | null }>) => {
    const c = fnWaterCpu(w, h);
    for (const f of frames) c.frame({ ...f, value, shape: 'point' });
    return c.grid.now;
  };
  const frames = (n: number, path: (i: number) => { x: number; y: number } | null) => Array.from({ length: n }, (_, i) => ({ time: i / 30, first: i === 0, point: path(i) }));

  it('same settings → the same height field as the Finish effect (whole picture)', () => {
    const W = 96, H = 54;
    const settings = { speed: 0.4, damping: 0.1, size: 0.06, strength: 1.2, bob: 0, rain: 20, drop: 0.02, edges: 1, length: 0.2, angle: 0 };
    const effect = { ...newFinishEffect('water', 'water'), ...settings } as unknown as Record<string, number>;
    const l = water({ ...settings });
    const reg = wlRegion(l, num(l as never), W, H);
    const lv = wlValue(reg, k => (l as unknown as Record<string, number>)[k], W, H);
    const path = (i: number) => ({ x: 0.2 + i * 0.02, y: 0.5 });
    const g = fnWaterGrid('medium', W, H, reg.scale);
    const fromEffect = cpuRun(g.w, g.h, k => effect[k], frames(20, path));
    const fromLayer = cpuRun(g.w, g.h, k => lv(null, k) as number, frames(20, p => { const q = path(p); return wlToLocal(reg, q, W, H); }));
    expect(Math.max(...fromEffect.map(Math.abs))).toBeGreaterThan(0.01);
    expect([...fromLayer]).toEqual([...fromEffect]);
  });

  it('a pond’s waves keep the picture’s units: a splash’s ring is as wide on the picture as the whole picture’s', () => {
    const ringRadius = (gw: number, gh: number, value: (k: string) => number, splash: { t: number; x: number; y: number; size: number }) => {
      const now = cpuRun(gw, gh, value, Array.from({ length: 25 }, (_, i) => ({ time: i / 60, point: null, splash: i === 1 ? splash : null })));
      // Along the middle row from the centre: where the biggest crest or trough is.
      const j = Math.floor(gh / 2); let best = 0, at = 0;
      for (let i = Math.floor(gw / 2); i < gw; i++) { const x = Math.abs(now[j * gw + i]); if (x > best) { best = x; at = i - gw / 2 + 0.5; } }
      return at / gh; // in the frame's heights
    };
    const base = { speed: 0.5, damping: 0.05, size: 0.04, strength: 1, bob: 0, rain: 0, drop: 0.012, edges: 1, length: 0.2, angle: 0 } as Record<string, number>;
    // The whole picture, 360 × 360 px at Low detail (180 rows), and a pond half its height in the middle (90 rows).
    const whole = ringRadius(180, 180, k => base[k], { t: 0.01, x: 0.5, y: 0.5, size: 0.06 });
    const l = water({ ...base, region: 'rect', x: 0.5, y: 0.5, w: 0.5, h: 0.5, detail: 'low' });
    const reg = wlRegion(l, num(l as never), 360, 360);
    const g = fnWaterGrid('low', reg.w, reg.h, reg.scale);
    expect(g).toEqual({ w: 90, h: 90 });
    const vals: Record<string, number> = { ...(l as unknown as Record<string, number>), splashT: 0.01, splashX: 0.5, splashY: 0.5, splashSize: 0.06 };
    const v = wlValue(reg, k => vals[k], 360, 360);
    const pond = ringRadius(g.w, g.h, k => v(null, k) as number, { t: 0.01, x: v(null, 'splashX') as number, y: v(null, 'splashY') as number, size: v(null, 'splashSize') as number }) * reg.scale;
    expect(whole).toBeGreaterThan(0.05);
    expect(Math.abs(pond - whole)).toBeLessThan(2 / 180 + 1e-9);
  });

  it('is the same every run (takes, renders and pages repeat it)', () => {
    const l = water({ rain: 30, source: 'xy' });
    const reg = wlRegion(l, num(l as never), 64, 36);
    const v = wlValue(reg, k => (l as unknown as Record<string, number>)[k], 64, 36);
    const run = () => cpuRun(64, 36, k => v(null, k) as number, frames(15, i => ({ x: 0.3 + i * 0.01, y: 0.5 })));
    expect([...run()]).toEqual([...run()]);
  });
});

// ── The kit, with the stand-in renderer ─────────────────────────────────────

type Call = { fn: string; op: string; args: unknown[] };
function fakeCanvas() {
  const calls: Call[] = [];
  const state: Record<string, unknown> = { globalCompositeOperation: 'source-over', globalAlpha: 1 };
  const ctx: unknown = new Proxy(state, {
    get(t, k: string) {
      if (k in t) return t[k];
      if (k === 'getImageData') return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
      if (k === 'createImageData') return (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
      if (k === 'measureText') return () => ({ width: 10 });
      return (...args: unknown[]) => { calls.push({ fn: k, op: String(t.globalCompositeOperation), args }); };
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

  const run = (layers: PlayLayer[], frames = 3, pointer = { x: 0.5, y: 0.5, over: false, down: false }) => {
    rend.inputs = [];
    const kit = createLayerKit();
    kit.reset(1);
    const sensors = new Map<string, number>();
    let main = fakeCanvas();
    for (let i = 0; i < frames; i++) {
      main = fakeCanvas();
      kit.frame(main.getContext() as CanvasRenderingContext2D, rec(layers), {
        gl: fakeCanvas(), W: 400, H: 200, dpr: 1, time: i / 60, dt: 1 / 60, value: (l: PlayLayer, k: string) => (l as unknown as Record<string, number>)[k],
        pointer, markers: false, editing: false, hidden: false, backdrop: [0, 0, 0],
        audio: null, camera: null, image: () => null, sensor: (k: string, v: number) => sensors.set(k, v), override: () => {},
      } as never);
    }
    return { kit, sensors, main };
  };

  it('runs its own Water effect once a frame over what is under it, cut to the pond, in the pond’s units', () => {
    rend.field = fieldOf(8, 8, (u) => (u < 0.5 ? 0.4 : 0));
    const pond = water({ region: 'rect', x: 0.5, y: 0.5, w: 0.5, h: 0.5, source: 'pointer', speed: 0.3, probeX: 0.45, probeY: 0.5 });
    const { sensors } = run([pond], 3, { x: 0.5, y: 0.75, over: true, down: false });
    expect(rend.inputs).toHaveLength(3);
    const inp = rend.inputs[2];
    expect(inp).toMatchObject({ width: 100, height: 100, waterScale: 0.5, first: false, layers: null });
    expect(rend.inputs[0].first).toBe(true);
    expect((inp.finish as { effects: unknown[] }).effects).toEqual([wlEffect(pond)]);
    expect(inp.pointer).toEqual({ x: 0.5, y: 1, over: true });
    expect((inp.value as (e: unknown, k: string) => number)(null, 'speed')).toBeCloseTo(0.6);
    expect(sensors.get('w::waveHeight')).toBeGreaterThan(0.9); // the crest under the Probe
    expect(sensors.get('w::area')).toBeCloseTo(0.5, 1);
  });

  it('a hidden one still runs (readings, matte) and draws nothing; a removed one lets its renderer go', () => {
    rend.field = fieldOf(8, 8, () => 0);
    const before = rend.disposed;
    const { main, kit, sensors } = run([water({ visible: false })], 2);
    expect(rend.inputs).toHaveLength(2);
    expect(sensors.get('w::energy')).toBe(0);
    expect(main.calls.filter(c => c.fn === 'drawImage')).toHaveLength(0);
    kit.frame(fakeCanvas().getContext() as CanvasRenderingContext2D, rec([]), { gl: fakeCanvas(), W: 400, H: 200, dpr: 1, time: 1, dt: 1 / 60, value: () => 0, pointer: { x: 0, y: 0, over: false, down: false }, sensor: () => {}, override: () => {}, image: () => null } as never);
    expect(rend.disposed).toBe(before + 1);
  });

  it('its source can ride a layer above it; a layer whose shape pushes it runs while hidden', () => {
    rend.field = null;
    const boat = L('shape', 'boat', { x: 0.8, y: 0.25, visible: false });
    run([water({ source: 'layer', sourceLayer: 'boat' }), boat], 1);
    expect((rend.inputs[0].layerPoint as (id: string) => unknown)('boat')).toEqual({ x: 0.8, y: 0.25 });
    expect((rend.inputs[0].layerPoint as (id: string) => unknown)('nobody')).toBe(null);
    run([water({ shape: 'layer', shapeLayer: 'boat' }), boat], 1);
    expect((rend.inputs[0].layerAlpha as (id: string) => unknown)('boat')).toBeTruthy();
  });

  it('as a matte: the layer is cut by its waves (destination-in)', () => {
    rend.field = fieldOf(8, 8, () => 0.4);
    const { main } = run([L('shape', 'a', { action: 'none', fillOpacity: 1, strokeWidth: 0, trackMatte: { id: 'w', mode: 'alpha', invert: false } }), water({ visible: false })], 2);
    const blits = main.calls.filter(c => c.fn === 'drawImage');
    expect(blits).toHaveLength(1);
    const own = blits[0].args[0] as ReturnType<typeof fakeCanvas>;
    expect(own.calls.some(c => c.fn === 'drawImage' && c.op === 'destination-in')).toBe(true);
  });
});

describe('record edits', () => {
  const finishWith = (extra: Record<string, unknown> = {}) => ({ on: true, effects: [{ ...newFinishEffect('water', 'fw'), source: 'layer', sourceLayer: 'n', shape: 'twin', detail: 'high', speed: 0.9, x: 0.2, y: 0.7, rain: 7, ...extra }, { ...newFinishEffect('chroma', 'ch'), where: 'waves' }] });
  it('Move to a layer: the same settings at the top of the layers; controls, routes and Splashes follow; the effect goes', () => {
    const p = rec([L('null', 'n')], {
      finish: finishWith() as never,
      controls: [{ id: 'c1', target: 'finish:fw::speed', kind: 'float', label: 'Speed', min: 0, max: 2 }, { id: 'c2', target: 'finish:fw::x', kind: 'float', label: 'X', min: 0, max: 1 }, { id: 'c3', target: 'finish:ch::amount', kind: 'float', label: 'C', min: 0, max: 1 }],
      signals: [{ id: 's', name: 's', inputs: [], do: [{ id: 'd', do: 'splash', layerId: 'finish:fw', amount: 1, enabled: true, key: 'random', value: 0.1 }] }] as never,
    });
    const r = moveWaterToLayer(p, 'fw', 'wl');
    expect(r.id).toBe('wl'); expect(r.wavesLeft).toBe(1);
    const l = r.play.layers.at(-1) as WaterLayer;
    expect(l).toMatchObject({ kind: 'water', id: 'wl', region: 'all', source: 'layer', sourceLayer: 'n', shape: 'twin', detail: 'high', speed: 0.9, sourceX: 0.2, sourceY: 0.7, rain: 7, visible: true });
    expect(r.play.finish!.effects.map(e => e.id)).toEqual(['ch']);
    expect(r.play.controls.map(c => c.target)).toEqual(['layer:wl::speed', 'layer:wl::sourceX', 'finish:ch::amount']);
    expect(r.play.signals![0].do![0].layerId).toBe('wl');
    // It survives the file.
    const back = parsePlayRecord(JSON.parse(JSON.stringify(r.play)));
    expect(back.signals![0].do![0].layerId).toBe('wl');
    expect(back.controls).toHaveLength(3);
    // Nothing to move: nothing changes.
    expect(moveWaterToLayer(p, 'ch', 'x').play).toBe(p);
  });
  it('a stack with only Water is gone after the move; a switched-off effect becomes a hidden layer', () => {
    const p = rec([], { finish: { on: true, effects: [{ ...newFinishEffect('water', 'fw'), enabled: false }] } as never });
    const r = moveWaterToLayer(p, 'fw', 'wl');
    expect(r.play.finish).toBeUndefined();
    expect(r.play.layers[0].visible).toBe(false);
  });
  it('removing a layer it rides or is pushed by lets go of it', () => {
    const layers = [L('null', 'n'), water({ source: 'layer', sourceLayer: 'n', shape: 'layer', shapeLayer: 'n' })];
    expect(dropWaterRefs(layers, 'n')[1]).toMatchObject({ sourceLayer: '', shapeLayer: '' });
    expect(removeLayer(rec(layers), 'n').layers[0]).toMatchObject({ kind: 'water', sourceLayer: '', shapeLayer: '' });
  });
});

describe('web pages', () => {
  it('carry the Water layer’s maths after the Finish stack’s, the same functions as the app', () => {
    const js = kitScript();
    expect(js).toContain('function wlRegion');
    expect(js.indexOf('const FN_EFFECTS')).toBeLessThan(js.indexOf('const WL_PARAMS'));
    // Run the page's kit and ask its own copy of the maths.
    const page = new Function(`${js.replace('return { createLayerKit: createLayerKit,', 'return { wl: { wlRegion, wlValue, wlReadings, WL_PARAMS }, createLayerKit: createLayerKit,')}; return SSKit;`)() as { wl: Record<string, (...a: unknown[]) => unknown> & { WL_PARAMS: unknown } };
    const l = water({ region: 'ellipse', x: 0.4, y: 0.6, w: 0.3, h: 0.2, sourceX: 0.4, speed: 0.5 });
    const reg = wlRegion(l, num(l as never), 640, 360);
    expect(page.wl.wlRegion(l, num(l as never), 640, 360)).toEqual(reg);
    const pv = page.wl.wlValue(reg, (k: string) => (l as unknown as Record<string, number>)[k], 640, 360) as (e: unknown, k: string) => number;
    const av = wlValue(reg, k => (l as unknown as Record<string, number>)[k], 640, 360);
    for (const k of ['x', 'y', 'speed', 'size', 'damping']) expect(pv(null, k)).toBe(av(null, k));
    const f = fieldOf(12, 6, (u, v) => Math.sin(u * 9) * v * 0.5);
    expect(page.wl.wlReadings(f, 'ellipse', { x: 0.3, y: 0.4 })).toEqual(wlReadings(f, 'ellipse', { x: 0.3, y: 0.4 }));
    expect(page.wl.WL_PARAMS).toEqual(WL_PARAMS);
  });
});

describe('the example', () => {
  it('Water layer: a boat and its wake: a drawn boat above the water, riding it, rain, splashes into the layer, every control explained', () => {
    const ex = PLAY_EXAMPLE_GRAPHS.waterLayer;
    expect(ex).toBeDefined();
    const play = parsePlayRecord(JSON.parse(JSON.stringify(ex.play)));
    const ids = play.layers.map(l => l.id);
    expect(ids.indexOf('boat')).toBeGreaterThan(ids.indexOf('water'));
    const w = play.layers.find(l => l.id === 'water') as WaterLayer;
    expect(w).toMatchObject({ kind: 'water', source: 'layer', sourceLayer: 'boat' });
    expect(w.rain).toBeGreaterThan(0);
    expect(play.layers.find(l => l.id === 'boat')!.kind).toBe('shape');
    expect(play.finish).toBeUndefined();
    expect(play.signals!.flatMap(s => s.do ?? []).every(d => d.do === 'splash' && d.layerId === 'water')).toBe(true);
    expect(play.mappings.some(m => m.source.kind === 'sensor' && m.source.layerId === 'water' && m.source.read === 'waveHeight')).toBe(true);
    for (const c of play.controls) expect(play.notes).toContain(`**${c.label}`.replace(/ [xyXY]$/, ''));
    for (const s of play.signals!) expect(play.notes).toContain(`**${s.name}**`);
  });
});
