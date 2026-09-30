/**
 * The picture's brightness as a value (simplification plan, phase 8):
 * `pic:<lum|r|g|b>:<all | anchor>` read from the layer kit's grid of the last
 * frame (Rec. 709 luminance), in the kit, the engine, the file's walker and
 * the export's flag.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { klPictureAt } from '../kit/kit.js';
import { sgParseValueRef } from '../kit/signals.js';
import { readsPicture, valueRange } from '../conditionRange';
import { mapValueRef } from '../playRefs';
import { valueRefLabel } from '../playSources';
import { playBundle } from '../exportHtml';
import { playEngine } from '../../lib/playEngine';
import { defaultLayer, emptyPlayRecord, type PlayLayer, type PlayRecord } from '../../types/play';

afterEach(() => { playEngine.setRecord(emptyPlayRecord()); playEngine.setPictureReader(null); });

/** A W × H grid, white on the left half and black on the right, a red cell at the top left. */
function grid(W = 8, H = 4): Uint8ClampedArray {
  const g = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, v = x < W / 2 ? 255 : 0;
    g[i] = v; g[i + 1] = v; g[i + 2] = v; g[i + 3] = 255;
  }
  g[0] = 255; g[1] = 0; g[2] = 0;
  return g;
}

describe('the kit', () => {
  it('averages the whole picture, or around a point (y up)', () => {
    const g = grid();
    expect(klPictureAt(g, 8, 4, null, null, 0, 'lum')).toBeCloseTo((15 + 0.2126) / 32, 3);
    // The right half is black, the left white (a small patch).
    expect(klPictureAt(g, 8, 4, 0.9, 0.5, 0.1, 'lum')).toBe(0);
    expect(klPictureAt(g, 8, 4, 0.3, 0.4, 0.1, 'lum')).toBeCloseTo(1, 6);
    // The top-left cell is red: y up, so y near 1 is the top row.
    expect(klPictureAt(g, 8, 4, 0.05, 0.95, 0, 'r')).toBe(1);
    expect(klPictureAt(g, 8, 4, 0.05, 0.95, 0, 'g')).toBe(0);
    expect(klPictureAt(g, 8, 4, 0.05, 0.95, 0, 'lum')).toBeCloseTo(0.2126, 4);
  });
});

describe('as a value', () => {
  it('parses, names, ranges and renames', () => {
    expect(sgParseValueRef('pic:lum:all')).toEqual({ kind: 'picture', ch: 'lum', region: 'all' });
    expect(sgParseValueRef('pic:x:all')).toBeNull();
    const play: PlayRecord = { ...emptyPlayRecord(), layers: [defaultLayer('shape', 'box', 'Box')] };
    expect(valueRefLabel('pic:lum:box', { layers: play.layers })).toBe('Brightness under Box');
    expect(valueRefLabel('pic:r:all')).toBe('Red of the picture');
    expect(valueRange(play, 'pic:g:all')).toEqual([0, 1]);
    expect(mapValueRef('pic:lum:box', (_k, id) => `${id}2`)).toBe('pic:lum:box2');
    expect(mapValueRef('pic:lum:all', (_k, id) => `${id}2`)).toBe('pic:lum:all');
  });

  it('the engine reads through the overlay’s reader: the whole picture, or around a layer', () => {
    const box = { ...defaultLayer('shape', 'box', 'Box'), x: 0.25, y: 0.75 } as PlayLayer;
    playEngine.setRecord({ ...emptyPlayRecord(), layers: [box] });
    expect(playEngine.readValue('pic:lum:all')).toBeNull();
    const calls: unknown[] = [];
    playEngine.setPictureReader((x, y, r, ch) => { calls.push([x, y, r, ch]); return x === null ? 0.4 : 0.9; });
    expect(playEngine.readValue('pic:lum:all')).toBe(0.4);
    expect(playEngine.readValue('pic:b:box')).toBe(0.9);
    expect(calls[1]).toEqual([expect.closeTo(0.25), expect.closeTo(0.75), 0.05, 'b']);
  });

  it('a setup that reads it tells the layer kit (and a website) to sample the picture', () => {
    const play: PlayRecord = { ...emptyPlayRecord(), signals: [{ id: 's', name: 'Dark', when: { kind: 'trigger', trigger: { on: 'value', value: 'pic:lum:all', cmp: 'below', threshold: 0.2, hysteresis: 0, tolerance: 0 } } }] };
    // A condition in a signal's own definition counts, like one in an action.
    expect(readsPicture(play)).toBe(true);
    expect(readsPicture({ ...play, actions: [{ id: 'a', trigger: { on: 'value', value: 'pic:lum:all', cmp: 'below', threshold: 0.2, hysteresis: 0, tolerance: 0 }, do: 'show', layerId: 'x', amount: 1, enabled: true }] })).toBe(true);
    expect(readsPicture(emptyPlayRecord())).toBe(false);
    const bundled = playBundle({ play: { ...play, actions: [{ id: 'a', trigger: { on: 'value', value: 'pic:lum:all', cmp: 'below', threshold: 0.2, hysteresis: 0, tolerance: 0 }, do: 'show', layerId: 'x', amount: 1, enabled: true }] }, title: 'T', nodes: [], fragmentShader: '', uniforms: {}, paramBindings: {} } as never);
    expect((bundled.play as { readsPicture?: boolean }).readsPicture).toBe(true);
  });
});
