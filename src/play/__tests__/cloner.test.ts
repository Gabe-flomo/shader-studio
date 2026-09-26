/**
 * The Cloner layer: arrangements put copies where they should be, steps and
 * seeded randomness vary them by index, effectors act within their falloff,
 * and the schema round-trips a saved layer.
 */
import { describe, expect, it } from 'vitest';
import { klClonerLayout, klClonerCopies, klSeeded } from '../kit/layers.js';
import { defaultLayer, parseLayer, LAYER_NUMERIC_PROPS, type ClonerLayer } from '../../types/playLayers';

const cloner = (over: Partial<ClonerLayer> = {}): ClonerLayer => ({ ...(defaultLayer('cloner', 'c1', 'Cloner') as ClonerLayer), ...over });
const v = (l: ClonerLayer) => (k: string) => (l as unknown as Record<string, number>)[k];

describe('cloner', () => {
  it('lays out a grid around the centre, a ring, a line and a path', () => {
    const g = cloner({ arrange: 'grid', cols: 3, rows: 2, x: 0.5, y: 0.5, spacingX: 0.2, spacingY: 0.1 });
    const grid = klClonerLayout(g, v(g), 2, null, null);
    expect(grid).toHaveLength(6);
    expect(grid[0]).toMatchObject({ i: 0, t: 0 });
    expect(grid[0].x).toBeCloseTo(0.5 - 0.1, 6); // one spacing across at aspect 2 = 0.1
    expect(grid[0].y).toBeCloseTo(0.55, 6);
    expect(grid[5].x).toBeCloseTo(0.6, 6);
    expect(grid[5].y).toBeCloseTo(0.45, 6);
    const r = cloner({ arrange: 'ring', count: 4, x: 0.5, y: 0.5, radius: 0.2, startAngle: 0, sweep: 360 });
    const ring = klClonerLayout(r, v(r), 1, null, null);
    expect(ring.map(p => [+p.x.toFixed(3), +p.y.toFixed(3)])).toEqual([[0.7, 0.5], [0.5, 0.7], [0.3, 0.5], [0.5, 0.3]]);
    const ln = cloner({ arrange: 'line', count: 3, x: 0, y: 0, x2: 1, y2: 0.5 });
    expect(klClonerLayout(ln, v(ln), 1, null, null).map(p => [p.x, p.y])).toEqual([[0, 0], [0.5, 0.25], [1, 0.5]]);
    const pa = cloner({ arrange: 'path', count: 3, spread: 1 });
    const path = klClonerLayout(pa, v(pa), 1, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], null);
    expect(path.map(p => [+p.x.toFixed(3), +p.y.toFixed(3)])).toEqual([[0, 0], [1, 0], [1, 1]]);
    const pt = cloner({ arrange: 'points' });
    expect(klClonerLayout(pt, v(pt), 1, null, [{ x: 0.2, y: 0.3 }])).toEqual([{ i: 0, t: 0, x: 0.2, y: 0.3, angle: undefined }]);
  });

  it('steps by index, randomises by seed, and lets an effector act within its falloff', () => {
    const l = cloner({ arrange: 'line', count: 3, x: 0, y: 0.5, x2: 1, y2: 0.5, scale: 1, stepScale: 0.5, stepRotation: 10, stepOpacity: -0.25, stepHue: 30 });
    const copies = klClonerCopies(l, v(l), 1, klClonerLayout(l, v(l), 1, null, null), []);
    expect(copies.map(c => c.scale)).toEqual([1, 1.5, 2]);
    expect(copies.map(c => c.rot)).toEqual([0, 10, 20]);
    expect(copies.map(c => c.alpha)).toEqual([1, 0.75, 0.5]);
    expect(copies.map(c => c.hue)).toEqual([0, 30, 60]);
    // Seeded: the same seed gives the same jitter; a different seed a different one; all within range.
    const j = cloner({ arrange: 'line', count: 5, x: 0, y: 0.5, x2: 1, y2: 0.5, jitter: 0.1, seed: 3 });
    const a = klClonerCopies(j, v(j), 1, klClonerLayout(j, v(j), 1, null, null), []);
    const b = klClonerCopies(j, v(j), 1, klClonerLayout(j, v(j), 1, null, null), []);
    const j2 = { ...j, seed: 4 };
    const c2 = klClonerCopies(j2, v(j2), 1, klClonerLayout(j2, v(j2), 1, null, null), []);
    expect(a.map(c => c.x)).toEqual(b.map(c => c.x));
    expect(a.map(c => c.x)).not.toEqual(c2.map(c => c.x));
    expect(a.every((c, i) => Math.abs(c.x - i / 4) <= 0.1 + 1e-9)).toBe(true);
    expect(klSeeded(1, 2, 3)).toBeGreaterThanOrEqual(0);
    expect(klSeeded(1, 2, 3)).toBeLessThan(1);
    // A null effector at the line's start: the first copy is fully inside, the last is out of reach.
    const e = cloner({ arrange: 'line', count: 3, x: 0, y: 0.5, x2: 1, y2: 0.5, scale: 1, effRadius: 0.3, effSoftness: 0, effScale: 1, effPush: 0.1, effHide: 0 });
    const ec = klClonerCopies(e, v(e), 1, klClonerLayout(e, v(e), 1, null, null), [{ x: 0, y: 0.5, rx: 0, ry: 0 }]);
    expect(ec[0].scale).toBe(2);
    expect(ec[2].scale).toBe(1);
    expect(ec[2].x).toBe(1);
    // Hide at: the copy inside disappears.
    const h = { ...e, effHide: 0.5 };
    const hc = klClonerCopies(h, v(h), 1, klClonerLayout(h, v(h), 1, null, null), [{ x: 0, y: 0.5, rx: 0, ry: 0 }]);
    expect(hc.map(c => c.hidden)).toEqual([true, false, false]);
  });

  it('parses a saved cloner, dropping bad effector ids and clamping counts; every slider is a numeric prop', () => {
    const raw = { id: 'c', kind: 'cloner', label: 'C', sourceId: 's1', arrange: 'ring', count: 9999, effectors: ['n1', 3, ''], effRadius: 0.4 };
    const l = parseLayer(raw) as ClonerLayer;
    expect(l.kind).toBe('cloner');
    expect(l.count).toBe(400);
    expect(l.effectors).toEqual(['n1']);
    expect(l.effRadius).toBe(0.4);
    expect(l.arrange).toBe('ring');
    expect(l.cols).toBe(5);
    const keys = LAYER_NUMERIC_PROPS.cloner.map(p => p.key);
    for (const k of ['count', 'cols', 'rows', 'spacingX', 'radius', 'sweep', 'stepScale', 'randHue', 'effRadius', 'effPush', 'effHide']) expect(keys).toContain(k);
  });
});
