/**
 * The piano roll window's geometry, positions and key badge
 * (play/pianoRollWindow.ts, docs/piano-roll.md), and its open/close store.
 */
import { describe, expect, it } from 'vitest';
import { WIN_MIN_H, WIN_MIN_W, clampWinRect, defaultWinRect, formatLength, formatPosition, loadWinRect, parsePosition, scaleBadge } from '../pianoRollWindow';
import { usePianoRollWindow } from '../../components/play/engine/pianoRollWindowStore';

describe('the window rectangle', () => {
  it('starts centred and inside the screen', () => {
    const r = defaultWinRect(1440, 900);
    expect(r.w).toBeLessThanOrEqual(1440 - 16);
    expect(r.h).toBeLessThanOrEqual(900 - 16);
    expect(Math.abs(r.x + r.w / 2 - 720)).toBeLessThanOrEqual(1);
    expect(r.y).toBeGreaterThanOrEqual(8);
  });
  it('keeps the minimum size when there is room, and never outgrows the screen', () => {
    expect(clampWinRect({ x: 10, y: 10, w: 100, h: 100 }, 1440, 900)).toMatchObject({ w: WIN_MIN_W, h: WIN_MIN_H });
    expect(clampWinRect({ x: 0, y: 0, w: 5000, h: 5000 }, 800, 600)).toMatchObject({ w: 784, h: 584 });
    expect(clampWinRect({ x: 0, y: 0, w: 900, h: 700 }, 400, 300)).toMatchObject({ w: 384, h: 284 });
  });
  it('keeps the title bar reachable', () => {
    const r = clampWinRect({ x: 5000, y: 5000, w: 700, h: 500 }, 1440, 900);
    expect(r.x).toBeLessThanOrEqual(1440 - 140);
    expect(r.y).toBeLessThanOrEqual(900 - 48);
    const l = clampWinRect({ x: -5000, y: -50, w: 700, h: 500 }, 1440, 900);
    expect(l.x + l.w).toBeGreaterThanOrEqual(140);
    expect(l.y).toBe(8);
  });
  it('loads a remembered rectangle, falling back on anything else', () => {
    expect(loadWinRect(JSON.stringify({ x: 40, y: 50, w: 900, h: 600 }), 1440, 900)).toEqual({ x: 40, y: 50, w: 900, h: 600 });
    const d = defaultWinRect(1440, 900);
    expect(loadWinRect(null, 1440, 900)).toEqual(d);
    expect(loadWinRect('{bad', 1440, 900)).toEqual(d);
    expect(loadWinRect(JSON.stringify({ x: 'a', y: 1, w: 2, h: 3 }), 1440, 900)).toEqual(d);
  });
});

describe('positions in bars.beats.sixteenths', () => {
  // 120 BPM: a beat is 0.5 s, a sixteenth 0.125 s, a bar 2 s.
  it('formats a position from 1.1.1 and a length from 0.0.0', () => {
    expect(formatPosition(0, 120)).toBe('1.1.1');
    expect(formatPosition(2, 120)).toBe('2.1.1');
    expect(formatPosition(2.625, 120)).toBe('2.2.2');
    expect(formatLength(4, 120)).toBe('2.0.0');
    expect(formatLength(0.75, 120)).toBe('0.1.2');
  });
  it('parses what it formats', () => {
    for (const t of [0, 2, 2.625, 7.875]) expect(parsePosition(formatPosition(t, 120), 120)).toBeCloseTo(t, 6);
    for (const d of [4, 0.75, 0.125]) expect(parsePosition(formatLength(d, 120), 120, true)).toBeCloseTo(d, 6);
  });
  it('fills in missing parts and refuses nonsense', () => {
    expect(parsePosition('3', 120)).toBe(4);
    expect(parsePosition('3.2', 120)).toBe(4.5);
    expect(parsePosition('1', 120, true)).toBe(2);
    expect(parsePosition('0.0.0', 120)).toBeNull();
    expect(parsePosition('abc', 120)).toBeNull();
    expect(parsePosition('', 120)).toBeNull();
    expect(parsePosition('1.1.1.1', 120)).toBeNull();
  });
});

describe('the key badge', () => {
  it('is short for major and minor, the scale name otherwise, empty when off', () => {
    expect(scaleBadge({ on: true, root: 0, name: 'major' })).toBe('C maj');
    expect(scaleBadge({ on: true, root: 9, name: 'minor' })).toBe('A min');
    expect(scaleBadge({ on: true, root: 6, name: 'dorian' })).toBe('F# Dorian');
    expect(scaleBadge({ on: false, root: 0, name: 'major' })).toBe('');
    expect(scaleBadge(undefined)).toBe('');
  });
});

describe('the window store', () => {
  it('opens a clip (refitting on each open), follows a trim, and closes', () => {
    const s = usePianoRollWindow.getState();
    s.open('rk1', 2);
    const a = usePianoRollWindow.getState().target!;
    expect(a).toMatchObject({ rack: 'rk1', t: 2 });
    s.open('rk1', 2);
    expect(usePianoRollWindow.getState().target!.key).toBe(a.key + 1);
    s.setAnchor(1.5);
    expect(usePianoRollWindow.getState().target!.t).toBe(1.5);
    s.close();
    expect(usePianoRollWindow.getState().target).toBeNull();
    s.setAnchor(3);
    expect(usePianoRollWindow.getState().target).toBeNull();
  });
});
