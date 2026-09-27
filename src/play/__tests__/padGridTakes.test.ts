/**
 * The pad grid in the app: hits from MIDI or the on-screen pads land on the
 * graph clock's next frame, the texture follows, and takes record the cells
 * and play them back.
 */
import { describe, it, expect, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { padGrid, padGridUniforms } from '../../lib/padGrid';
import { midiEngine } from '../../lib/midiEngine';
import { TakeCapture, takeApplier } from '../../lib/takes';
import { emptyPlayRecord, parsePlayRecord, type PlayRecord } from '../../types/play';
import { DEFAULT_PAD_GRID } from '../../types/playMidi';
import { playEngine } from '../../lib/playEngine';
import type * as THREE from 'three';

const tick = (t: number) => padGrid.tickInputs(0, t);
const texel = (i: number) => ((padGridUniforms.u_padGrid.value as THREE.DataTexture).image.data as Uint8Array)[i * 4];

describe('pad grid (app)', () => {
  it('stamps hits with the next frame\'s clock, fills the texture and reads as a source', () => {
    const pg = { ...DEFAULT_PAD_GRID, mode: 'hold' as const, release: 1 };
    padGrid.setConfig(pg);
    tick(5);
    midiEngine.handleBytes(0x90, 36 + 8 * 2 + 3, 127, 'Push'); // pad (3, 2)
    expect(padGrid.read('x', 0, 0)).toBeNull(); // not until the frame
    tick(10);
    expect(padGrid.read('x', 0, 0)).toBeCloseTo(3 / 7);
    expect(padGrid.read('y', 0, 0)).toBeCloseTo(2 / 7);
    expect(padGrid.read('cell', 3, 2)).toBe(1);
    expect(texel(2 * 8 + 3)).toBe(255);
    expect(padGridUniforms.u_padGridSize.value.x).toBe(8);
    expect(padGridUniforms.u_padLast.value.toArray()).toEqual([3, 2, 1, 0]);
    midiEngine.handleBytes(0x80, 36 + 8 * 2 + 3, 0, 'Push');
    tick(10.5);
    expect(padGrid.read('cell', 3, 2)).toBeCloseTo(1); // released at 10.5, fading from here
    tick(11);
    expect(padGrid.read('cell', 3, 2)).toBeCloseTo(0.5);
    // A Pad grid mapping source goes through the Play engine.
    expect(playEngine.readSource({ kind: 'pad', read: 'velocity', col: 0, row: 0 })).toBe(1);
    padGrid.clear();
    padGrid.setConfig(undefined);
    tick(12);
    expect(padGridUniforms.u_padGridSize.value.x).toBe(0);
  });

  it('records the cells in a take and plays them back', () => {
    const pg = { ...DEFAULT_PAD_GRID, mode: 'latch' as const, release: 0 };
    const play: PlayRecord = { ...emptyPlayRecord(), padGrid: pg };
    padGrid.setConfig(pg);
    const cap = new TakeCapture(play);
    tick(0); cap.sample(0);
    tick(0.5); cap.sample(0.5);
    padGrid.press(0, 0, 1); padGrid.release(0, 0);
    tick(1); cap.sample(1);
    tick(1.5); cap.sample(1.5);
    const take = cap.toTake('Pads')!;
    cap.dispose();
    const c0 = take.tracks.find(t => t.kind === 'pad' && t.id === 'c0');
    expect(c0).toBeTruthy();
    expect(take.tracks.some(t => t.kind === 'pad' && t.id === 'c1')).toBe(false); // never lit
    const back = parsePlayRecord(JSON.parse(JSON.stringify({ ...play, takes: [take] }))).takes![0];
    expect(back.tracks.find(t => t.kind === 'pad' && t.id === 'c0')).toEqual(c0);

    padGrid.clear();
    const applier = takeApplier(back, { setUniform: () => {}, width: 8, height: 8 });
    applier.apply(0.25);
    expect(padGrid.level(0)).toBe(0);
    expect(texel(0)).toBe(0);
    applier.apply(1.25);
    expect(padGrid.level(0)).toBe(1);
    expect(texel(0)).toBe(255);
    applier.release();
    expect(padGrid.level(0)).toBe(0); // live again, and the live grid was cleared
    padGrid.setConfig(undefined);
  });
});
