/**
 * Path shapes: shapes whose corners are nulls (hand-tracking paths). The
 * geometry (hull, smoothing, circles, webs), what a lost hand does, the
 * readings, the zone, the file format, and a few frames through the kit.
 */
import { describe, it, expect } from 'vitest';
import { geoCatmullRom, geoCompile, geoHull, geoPathBuild, geoPathFade, geoPathNodes, geoPathReadings, geoPolyArea, geoPolyLength, GEO_PATH_FADE_S } from '../kit/geometry.js';
import { createLayerKit, type KitEnv } from '../kit/kit.js';
import { defaultLayer, emptyPlayRecord, parseLayer, sensorReadsFor, parsePlayRecord, type PlayLayer, type PlayRecord, type ShapeLayer } from '../../types/play';
import { addHandPath, HAND_PATH_POINTS, removeLayer } from '../../components/play/layerOps';

const pts = (...xy: number[]) => { const out: { x: number; y: number }[] = []; for (let i = 0; i < xy.length; i += 2) out.push({ x: xy[i], y: xy[i + 1] }); return out; };

describe('path geometry', () => {
  it('wraps round the outside: a bow-tie order becomes a quad, inside points and collinear ones go', () => {
    // Corners given crossed (0,0) → (1,1) → (1,0) → (0,1): the hull goes round them.
    const h = geoHull([[0, 0], [1, 1], [1, 0], [0, 1], [0.5, 0.5]]);
    expect(h).toHaveLength(4);
    expect(geoPolyArea(h.flat())).toBeCloseTo(1, 9);
    // Anticlockwise (y up): positive signed area.
    let s = 0; for (let i = 0, j = h.length - 1; i < h.length; j = i++) s += h[j][0] * h[i][1] - h[i][0] * h[j][1];
    expect(s).toBeGreaterThan(0);
    // A point on an edge is not a corner.
    expect(geoHull([[0, 0], [0.5, 0], [1, 0], [1, 1], [0, 1]])).toHaveLength(4);
    // All in a line: its two ends.
    expect(geoHull([[0, 0], [0.3, 0.3], [1, 1]])).toEqual([[0, 0], [1, 1]]);
    // Without the hull a crossed order makes a bow-tie (two triangles that cancel in the shoelace sum).
    const bow = geoPathBuild(pts(0, 0, 1, 1, 1, 0, 0, 1), 1, { style: 'fill', hull: false });
    expect(bow.area).toBeCloseTo(0, 9);
    const quad = geoPathBuild(pts(0, 0, 1, 1, 1, 0, 0, 1), 1, { style: 'fill', hull: true });
    expect(quad.closed).toBe(true);
    expect(quad.area).toBeCloseTo(1, 9);
    expect(quad.perimeter).toBeCloseTo(4, 9);
  });

  it('smooths with a closed centripetal Catmull-Rom that passes through every point', () => {
    const sq: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const c = geoCatmullRom(sq, 10);
    expect(c).toHaveLength(40);
    for (let i = 0; i < 4; i++) { expect(c[i * 10][0]).toBeCloseTo(sq[i][0], 9); expect(c[i * 10][1]).toBeCloseTo(sq[i][1], 9); }
    // Round, but not wild: it bulges a little past the square and stays close.
    const xs = c.map(p => p[0]);
    expect(Math.max(...xs)).toBeGreaterThan(1);
    expect(Math.max(...xs)).toBeLessThan(1.25);
    // Two points almost on top of each other don't make it loop or blow up (centripetal).
    const near = geoCatmullRom([[0, 0], [1, 0], [1.001, 0.001], [0, 1]], 10);
    for (const p of near) { expect(Math.abs(p[0])).toBeLessThan(1.5); expect(Math.abs(p[1])).toBeLessThan(1.5); }
    const g = geoPathBuild(pts(0.3, 0.3, 0.7, 0.3, 0.7, 0.7, 0.3, 0.7), 1, { style: 'smooth', hull: true });
    expect(g.closed).toBe(true);
    // Between the square's area and its circumscribed circle's.
    expect(g.area).toBeGreaterThan(0.16);
    expect(g.area).toBeLessThan(Math.PI * 0.08);
  });

  it('circles: spread centres on the middle; first centres on point 1 and the others set the radius', () => {
    const spread = geoPathBuild(pts(0.4, 0.5, 0.6, 0.5), 1, { style: 'circle', circleMode: 'spread' });
    expect(spread.cx).toBeCloseTo(0.5, 9); expect(spread.cy).toBeCloseTo(0.5, 9);
    expect(spread.area).toBeCloseTo(Math.PI * 0.01, 9);
    expect(spread.perimeter).toBeCloseTo(2 * Math.PI * 0.1, 9);
    const first = geoPathBuild(pts(0.4, 0.5, 0.6, 0.5), 1, { style: 'circle', circleMode: 'first' });
    expect(first.cx).toBeCloseTo(0.4, 9);
    expect(first.area).toBeCloseTo(Math.PI * 0.04, 9);
    // A wide picture: distances are in picture heights, so the circle stays round.
    const wide = geoPathBuild(pts(0.4, 0.5, 0.6, 0.5), 2, { style: 'circle', circleMode: 'first' });
    expect(wide.perimeter).toBeCloseTo(2 * Math.PI * 0.4, 9);
    expect(wide.cx).toBeCloseTo(0.4, 9);
    // One point: nothing to draw.
    expect(geoPathBuild(pts(0.5, 0.5), 1, { style: 'circle', circleMode: 'spread' }).pts).toEqual([]);
  });

  it('lines stay open, webs join every pair within reach and fade as they stretch', () => {
    const lines = geoPathBuild(pts(0, 0, 1, 0, 1, 1), 1, { style: 'lines', lineR: 0.01 });
    expect(lines.closed).toBe(false);
    expect(lines.perimeter).toBeCloseTo(2, 9);
    expect(lines.segs).toEqual([0, 0, 1, 0, 0.01, 1, 0, 1, 1, 0.01]);
    // Area: what the points span (their hull), for mappings.
    expect(lines.area).toBeCloseTo(0.5, 9);
    const web = geoPathBuild(pts(0, 0, 1, 0, 1, 1, 0, 1), 1, { style: 'web' });
    expect(web.segs.length / 5).toBe(6);
    expect(web.alphas).toEqual([1, 1, 1, 1, 1, 1]);
    const near = geoPathBuild(pts(0, 0, 1, 0, 1, 1, 0, 1), 1, { style: 'web', webReach: 1.2 });
    // The two diagonals (√2) are out of reach; the sides fade to a sixth.
    expect(near.segs.length / 5).toBe(4);
    for (const a of near.alphas) expect(a).toBeCloseTo(1 - 1 / 1.2, 9);
    // Two points with Fill: a line.
    const two = geoPathBuild(pts(0.2, 0.5, 0.8, 0.5), 1, { style: 'fill', hull: true, lineR: 0.02 });
    expect(two.closed).toBe(false);
    expect(two.segs).toHaveLength(5);
  });

  it('reads area, perimeter and spread from 0 to 1', () => {
    // A box a quarter of a 16:9 picture: half its width, half its height.
    const a = 16 / 9;
    const g = geoPathBuild(pts(0.25, 0.25, 0.75, 0.25, 0.75, 0.75, 0.25, 0.75), a, { style: 'fill', hull: true });
    const r = geoPathReadings(g, a);
    expect(r.area).toBeCloseTo(0.25, 9);
    expect(r.perimeter).toBeCloseTo(0.5, 9);
    // Its corners are further than half a picture height from its middle: spread 1.
    expect(r.spread).toBe(1);
    const small = geoPathBuild(pts(0.4, 0.4, 0.6, 0.4, 0.6, 0.6, 0.4, 0.6), a, { style: 'fill', hull: true });
    expect(geoPathReadings(small, a).spread).toBeCloseTo(Math.hypot(a * 0.1, 0.1) / 0.5, 9);
    // Far apart: clamped at 1.
    expect(geoPathReadings(geoPathBuild(pts(0, 0, 1, 1), a, { style: 'fill' }), a).spread).toBe(1);
    expect(geoPathReadings(geoPathBuild([], a, { style: 'fill' }), a)).toEqual({ area: 0, perimeter: 0, spread: 0 });
    expect(geoPolyLength([0, 0, 1, 0, 1, 1], true)).toBeCloseTo(2 + Math.SQRT2, 9);
  });

  it('is a zone: inside a filled path, and near a web’s links', () => {
    const g = geoPathBuild(pts(0.25, 0.25, 0.75, 0.25, 0.75, 0.75, 0.25, 0.75), 2, { style: 'fill', hull: true });
    const z = geoCompile({ id: 'p', shape: 'path', pathGeo: g, x: 0.5, y: 0.5, w: 1, h: 0.5 }, 2);
    expect(z.dist(0.5, 0.5)).toBeLessThan(0);
    expect(z.dist(0.9, 0.5)).toBeGreaterThan(0);
    // Inverted: the other way round.
    expect(geoCompile({ id: 'p', shape: 'path', pathGeo: g, invert: true, x: 0.5, y: 0.5, w: 1, h: 0.5 }, 2).dist(0.5, 0.5)).toBeGreaterThan(0);
    const web = geoPathBuild(pts(0.25, 0.5, 0.75, 0.5), 2, { style: 'web', lineR: 0.02 });
    const w = geoCompile({ id: 'w', shape: 'path', pathGeo: web, x: 0.5, y: 0.5, w: 1, h: 0.04 }, 2);
    expect(w.dist(0.5, 0.51)).toBeLessThan(0);
    expect(w.dist(0.5, 0.6)).toBeGreaterThan(0);
    // No geometry: never inside.
    expect(geoCompile({ id: 'e', shape: 'path', pathGeo: null, x: 0.5, y: 0.5, w: 1, h: 1 }, 1).dist(0.5, 0.5)).toBeGreaterThan(0);
  });
});

describe('a lost hand', () => {
  const nodes = [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2, lost: true }, { x: 0.8, y: 0.8 }, { x: 0.2, y: 0.8 }];
  it('drops its corners, holds them, or fades the shape', () => {
    expect(geoPathNodes(nodes, 'drop')).toEqual({ pts: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }, { x: 0.2, y: 0.8 }], target: 1 });
    expect(geoPathNodes(nodes, 'hold').pts).toHaveLength(4);
    expect(geoPathNodes(nodes, 'hold').target).toBe(1);
    expect(geoPathNodes(nodes, 'fade')).toMatchObject({ target: 0 });
    expect(geoPathNodes(nodes, 'fade').pts).toHaveLength(4);
    expect(geoPathNodes(nodes.map(n => ({ ...n, lost: false })), 'fade').target).toBe(1);
  });
  it('fades over GEO_PATH_FADE_S and comes back', () => {
    expect(geoPathFade(undefined, 1, 0.1)).toBe(1);
    let a = 1;
    a = geoPathFade(a, 0, GEO_PATH_FADE_S / 2);
    expect(a).toBeCloseTo(0.5, 9);
    a = geoPathFade(a, 0, 1);
    expect(a).toBe(0);
    a = geoPathFade(a, 1, GEO_PATH_FADE_S / 4);
    expect(a).toBeCloseTo(0.25, 9);
  });
});

describe('path shapes in a file', () => {
  it('an old shape gets the path settings’ defaults; a path keeps its own, checked', () => {
    const old = parseLayer({ id: 's', kind: 'shape', label: 'Box', shape: 'box', x: 0.3 }) as ShapeLayer;
    expect(old).toMatchObject({ shape: 'box', x: 0.3, pointIds: [], pathStyle: 'fill', hull: true, webReach: 0, circleMode: 'spread', onLost: 'fade' });
    const p = parseLayer({ id: 'p', kind: 'shape', label: 'Path', shape: 'path', pointIds: ['a', 7, '', 'b'], pathStyle: 'web', hull: false, webReach: 99, circleMode: 'first', onLost: 'drop' }) as ShapeLayer;
    expect(p).toMatchObject({ shape: 'path', pointIds: ['a', 'b'], pathStyle: 'web', hull: false, webReach: 4, circleMode: 'first', onLost: 'drop' });
    const bad = parseLayer({ id: 'q', kind: 'shape', label: 'Path', shape: 'path', pointIds: 'a', pathStyle: 'spiral', onLost: 'panic' }) as ShapeLayer;
    expect(bad).toMatchObject({ pointIds: [], pathStyle: 'fill', onLost: 'fade' });
  });

  it('reads area, perimeter and spread as sensors, and keeps them in a file', () => {
    expect(sensorReadsFor({ kind: 'shape', shape: 'path' })).toEqual(expect.arrayContaining(['area', 'perimeter', 'spread', 'fill', 'hover', 'distance']));
    expect(sensorReadsFor({ kind: 'shape', shape: 'box' })).not.toContain('area');
    const r = parsePlayRecord({
      version: 1, layers: [{ id: 'p', kind: 'shape', label: 'P', shape: 'path' }], controls: [{ id: 'c', target: 'layer:p::fillOpacity', kind: 'float', label: 'C', min: 0, max: 1 }],
      mappings: [{ id: 'm', controlId: 'c', source: { kind: 'sensor', layerId: 'p', read: 'perimeter', otherId: '' }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true }],
    });
    expect(r?.mappings[0].source).toMatchObject({ kind: 'sensor', read: 'perimeter' });
  });

  it('Add hand path: four fingertip nulls (reusing ones there) and a filled path with the hull on', () => {
    const tip = { ...defaultLayer('null', 'mine', 'My index'), follow: 'hand', handSide: 'right', handPoint: 8 } as PlayLayer;
    const r = addHandPath({ ...emptyPlayRecord(), layers: [tip] }, 'path');
    const shape = r.play.layers.find(l => l.id === 'path') as ShapeLayer;
    expect(shape).toMatchObject({ kind: 'shape', shape: 'path', pathStyle: 'fill', hull: true, action: 'none' });
    expect(shape.pointIds).toHaveLength(4);
    expect(shape.pointIds[0]).toBe('mine');
    const nulls = shape.pointIds.map(id => r.play.layers.find(l => l.id === id)!);
    expect(nulls.map(n => n.kind === 'null' && [n.handSide, n.handPoint])).toEqual(HAND_PATH_POINTS.map(h => [h.side, h.point]));
    // Again: no more nulls, a second path.
    const again = addHandPath(r.play, 'path2');
    expect(again.play.layers.filter(l => l.kind === 'null')).toHaveLength(4);
    // Removing a null takes it out of the path.
    const gone = removeLayer(again.play, 'mine');
    expect((gone.layers.find(l => l.id === 'path') as ShapeLayer).pointIds).toHaveLength(3);
  });
});

// ── Through the kit ──────────────────────────────────────────────────────────

function fakeCanvas(): HTMLCanvasElement {
  const target: Record<string, unknown> = {
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    measureText: (s: string) => ({ width: String(s).length * 6 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
  };
  const ctx: unknown = new Proxy(target, { get(t, k: string) { return k in t ? t[k] : () => {}; }, set(t, k: string, v) { t[k] = v; return true; } });
  return { width: 160, height: 90, getContext: () => ctx } as unknown as HTMLCanvasElement;
}

function withCanvas(fn: () => void) {
  const g = globalThis as { document?: unknown; Path2D?: unknown };
  const had = [g.document, g.Path2D];
  g.document = { createElement: () => fakeCanvas() };
  g.Path2D = class { moveTo() {} lineTo() {} closePath() {} rect() {} arcTo() {} addPath() {} };
  try { fn(); } finally { [g.document, g.Path2D] = had; }
}

describe('a path shape in the kit', () => {
  it('follows its nulls, reports its readings, and drops or fades when a hand is lost', () => {
    withCanvas(() => {
      const kit = createLayerKit();
      const hand = (id: string, side: 'left' | 'right', point: number, x: number, y: number) => ({ ...defaultLayer('null', id, id), follow: 'hand', handSide: side, handPoint: point, x, y, spring: 1, wobble: 0 }) as PlayLayer;
      const nulls = [hand('a', 'right', 8, 0.25, 0.25), hand('b', 'right', 4, 0.75, 0.25), hand('c', 'left', 4, 0.75, 0.75), hand('d', 'left', 8, 0.25, 0.75)];
      const path = { ...defaultLayer('shape', 'p', 'P'), shape: 'path', pointIds: ['a', 'b', 'c', 'd'], onLost: 'drop', action: 'none' } as PlayLayer;
      let record: PlayRecord = { ...emptyPlayRecord(), layers: [...nulls, path] };
      const at = new Map<string, number>(), sensors = new Map<string, number>();
      let live = false, leftGone = false;
      const env = (): KitEnv => ({
        gl: fakeCanvas(), W: 160, H: 90, dpr: 1, time: 0, dt: 1 / 30,
        value: (l, k) => at.get(`${l.id}::${k}`) ?? (l as unknown as Record<string, number>)[k],
        pointer: { x: 0.5, y: 0.5, over: false, down: false }, markers: false, editing: false, hidden: false, backdrop: [0, 0, 0], audio: null, camera: null, image: () => null,
        sensor: (k, v) => sensors.set(k, v),
        override: (id, k, v) => { if (v === null) at.delete(`${id}::${k}`); else at.set(`${id}::${k}`, v); },
        // Tracking: each null's own resting place stands in for the fingertip; the left hand can leave.
        hand: (side, point) => (!live || (side === 'left' && leftGone) ? null : { x: point === 8 ? (side === 'right' ? 0.2 : 0.8) : side === 'right' ? 0.2 : 0.8, y: point === 8 ? 0.2 : 0.8 }),
        handsLive: live,
      });
      const out = fakeCanvas().getContext('2d')!;
      // No tracking yet: the nulls rest where they were placed, and the path is between them.
      for (let i = 0; i < 5; i++) kit.frame(out, record, env());
      expect(sensors.get('p::area')).toBeCloseTo(0.25, 5);
      expect(sensors.get('p::ax')).toBeCloseTo(0.5, 5);
      // Tracking, both hands: the corners move to the fingertips (0.2…0.8 each way).
      live = true;
      for (let i = 0; i < 60; i++) kit.frame(out, record, env());
      const full = sensors.get('p::area')!;
      expect(full).toBeCloseTo(0.36, 3);
      // The left hand leaves: Drop leaves two corners, a line with no area.
      leftGone = true;
      for (let i = 0; i < 3; i++) kit.frame(out, record, env());
      expect(sensors.get('p::area')).toBe(0);
      expect(sensors.get('p::perimeter')).toBeGreaterThan(0);
      // Fade: the corners stay, and the readings fade out with the shape.
      record = { ...record, layers: record.layers.map(l => (l.id === 'p' ? { ...l, onLost: 'fade' } as PlayLayer : l)) };
      kit.frame(out, record, env());
      const fading = sensors.get('p::area')!;
      expect(fading).toBeGreaterThan(0);
      expect(fading).toBeLessThan(full);
      for (let i = 0; i < 20; i++) kit.frame(out, record, env());
      expect(sensors.get('p::area')).toBe(0);
      // Back: it fades in again.
      leftGone = false;
      for (let i = 0; i < 20; i++) kit.frame(out, record, env());
      expect(sensors.get('p::area')).toBeCloseTo(full, 2);
      // Hold: the lost corners wait where they were.
      record = { ...record, layers: record.layers.map(l => (l.id === 'p' ? { ...l, onLost: 'hold' } as PlayLayer : l)) };
      leftGone = true;
      for (let i = 0; i < 5; i++) kit.frame(out, record, env());
      expect(sensors.get('p::area')).toBeCloseTo(full, 2);
      // Picking on the picture finds it inside and not outside.
      expect(kit.shapeAt(record, 0.5, 0.5, 16 / 9, (l, k) => (l as unknown as Record<string, number>)[k])).toBe('p');
      expect(kit.shapeAt(record, 0.02, 0.5, 16 / 9, (l, k) => (l as unknown as Record<string, number>)[k])).toBe(null);
    });
  });
});
